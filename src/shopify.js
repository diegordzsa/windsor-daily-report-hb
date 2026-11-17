import {
  SHOPIFY_STORE, SHOPIFY_API_VERSION, SHOPIFY_ANALYTICS_API_VERSION, SUBSCRIPTION_TIMEZONE,
} from './config.js';
import { addDays, utcOffsetLabel } from './freshness.js';

export async function getAccessToken(clientId, clientSecret) {
  const res = await fetch(`https://${SHOPIFY_STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Shopify token exchange failed: ${res.status} ${res.statusText} — ${body.substring(0, 200)}`);
  }

  const json = await res.json();
  // Los permisos reales del token, no los que creemos haber configurado: si
  // falta uno, aqui se ve sin tener que adivinar.
  console.log(`[Shopify] Scopes del token: ${json.scope ?? '(no informados)'}`);
  return json.access_token;
}

// Zona horaria y moneda de la tienda, para verificar que la config sigue valida.
export async function fetchShopInfo(accessToken) {
  const res = await fetch(
    `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/shop.json`,
    { headers: { 'X-Shopify-Access-Token': accessToken } }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Shopify shop.json error: ${res.status} ${res.statusText} — ${body.substring(0, 200)}`);
  }

  const shop = (await res.json()).shop || {};
  console.log(
    `[Shopify] Tienda ${shop.name} | iana_timezone=${shop.iana_timezone} | currency=${shop.currency}`
  );

  return {
    name: shop.name,
    timezone: shop.iana_timezone,
    currency: shop.currency,
  };
}

// Paginacion por el header Link rel="next" hasta agotarlo. Con limit=250 un dia
// normal cabe en una pagina, pero un pico de cobros no puede truncar la cifra.
async function fetchAllPages(accessToken, params, label) {
  const orders = [];
  let url = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${params}`;
  let pages = 0;

  while (url) {
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': accessToken } });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Shopify API error (${label}): ${res.status} ${res.statusText} — ${body.substring(0, 200)}`);
    }

    orders.push(...((await res.json()).orders || []));
    pages++;

    const next = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }

  console.log(`[Shopify] ${label}: ${orders.length} pedidos en ${pages} pagina(s)`);
  return orders;
}

// Un cobro automatico de suscripcion con exito, y solo eso.
//
// El discriminante es `checkout_id`. Un intento de cobro con exito siempre crea
// un pedido, y Shopify lo crea sin sesion de checkout porque nadie paso por la
// caja. Toda compra de escaparate lleva `checkout_id`. Un intento fallido no
// llega a crear pedido, asi que lo que pasa el filtro ya es un exito: no hay que
// mirar `financial_status` ni `cancelled_at`.
//
// Lo que NO funciona, medido contra la pagina de eventos de Kaching:
//   - Filtrar solo por el tag "Recurring Order" deja fuera las primeras cuotas
//     cobradas automaticamente, que tambien son cobros con exito. El 2026-07-27
//     eso contaba 11 donde habia 17.
//   - Contar todos los "First Order" mete dentro las altas de escaparate, que
//     no son cobros automaticos.
//   - La query GraphQL subscriptionBillingAttempts no vale: pide
//     read_own_subscription_contracts, que solo expone los contratos creados por
//     la propia app, asi que una app a medida recibe 0 filas y ningun error.
export function isSubscriptionCharge(order) {
  const tagged = (order.tags || '').toLowerCase().includes('kaching subscription');
  const noCheckout = order.checkout_id === null || order.checkout_id === undefined;
  return tagged && noCheckout;
}

export async function fetchSubscriptionChargeOrders(accessToken, date) {
  // Desplazamiento real de ese dia (+01:00 invierno, +02:00 verano). Se manda
  // explicito en la ventana en vez de fiarlo a la zona por defecto del runtime.
  const offset = utcOffsetLabel(date, SUBSCRIPTION_TIMEZONE);

  const params = new URLSearchParams({
    status: 'any',
    created_at_min: `${date}T00:00:00${offset}`,
    created_at_max: `${date}T23:59:59${offset}`,
    limit: '250',
    fields: 'id,name,created_at,tags,total_price,checkout_id',
  });

  console.log(`[Shopify] Cobros de suscripcion del ${date} (${SUBSCRIPTION_TIMEZONE}, UTC${offset})`);
  const orders = await fetchAllPages(accessToken, params, 'cobros de suscripcion');

  const charges = orders.filter(isSubscriptionCharge);

  console.log(`[Shopify] ${charges.length} cobros automaticos con exito el ${date}`);
  return charges;
}

export async function fetchShopifyOrders(accessToken, reportDate) {
  // Ventana holgada en UTC: created_at viene con el desplazamiento local de la
  // tienda, asi que se pide un dia de mas por cada lado y se filtra despues por
  // la fecha local exacta.
  const params = new URLSearchParams({
    status: 'any',
    created_at_min: `${addDays(reportDate, -1)}T00:00:00Z`,
    created_at_max: `${addDays(reportDate, 1)}T00:00:00Z`,
    limit: '250',
    fields: 'id,created_at,subtotal_price,total_discounts,tags,line_items',
  });

  const allOrders = await fetchAllPages(accessToken, params, 'ventana de ventas');

  const dayOrders = allOrders.filter(o => o.created_at?.slice(0, 10) === reportDate);
  console.log(`[Shopify] ${dayOrders.length} orders for ${reportDate}`);

  return dayOrders.map(order => ({
    date: reportDate,
    order_count: 1,
    order_net_sales: parseFloat(order.subtotal_price) || 0,
    order_tags: order.tags || '',
  }));
}

// Funnel de la tienda "como en Shopify" (Analytics > Tasa de conversion):
// sesiones con carrito, que llegaron al checkout y que compraron, cada una
// sobre el TOTAL de sesiones. No es el funnel de Meta: este cuenta todo el
// trafico de la tienda, no solo los clicks del pixel.
//
// Requiere el scope read_reports en la app. Sin el, Shopify devuelve un error
// de acceso y el reporte sigue saliendo con el bloque en n/d.
const FUNNEL_COLUMNS = {
  sessions: 'sessions',
  cartSessions: 'sessions_with_cart_additions',
  checkoutSessions: 'sessions_that_reached_checkout',
  completedSessions: 'sessions_that_completed_checkout',
};

export async function fetchShopifyFunnel(accessToken, reportDate) {
  const shopifyql = `FROM sessions SHOW ${Object.values(FUNNEL_COLUMNS).join(', ')} `
    + `SINCE ${reportDate} UNTIL ${reportDate}`;

  const query = `query Funnel($q: String!) {
    shopifyqlQuery(query: $q) {
      tableData { columns { name } rows }
      parseErrors
    }
  }`;

  console.log(`[Shopify] Funnel: ${shopifyql}`);
  const res = await fetch(
    `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_ANALYTICS_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { q: shopifyql } }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Shopify GraphQL ${res.status} ${res.statusText} — ${body.substring(0, 200)}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    const msg = json.errors.map(e => e.message).join('; ');
    // El caso esperado mientras la app no tenga el scope nuevo.
    // El texto completo va al log; a Slack solo el motivo, en una linea.
    if (/access denied|read_reports|scope/i.test(msg)) {
      console.error(`[Shopify] ${msg}`);
      throw new Error('falta el permiso read_reports en la app de Shopify');
    }
    throw new Error(msg);
  }

  const result = json.data?.shopifyqlQuery;
  const parseErrors = result?.parseErrors;
  if (Array.isArray(parseErrors) ? parseErrors.length : parseErrors) {
    throw new Error(`ShopifyQL: ${JSON.stringify(parseErrors).substring(0, 200)}`);
  }

  const table = result?.tableData;
  if (!table) throw new Error('shopifyqlQuery sin tableData');

  // Las filas pueden venir como objetos {columna: valor} o como arrays en el
  // orden de `columns`; se lee por nombre en ambos casos.
  const names = (table.columns ?? []).map(c => c.name);
  const rows = Array.isArray(table.rows) ? table.rows : JSON.parse(table.rows || '[]');
  const read = (row, col) => {
    const v = Array.isArray(row) ? row[names.indexOf(col)] : row?.[col];
    return Number(v) || 0;
  };

  const totals = {};
  for (const [key, col] of Object.entries(FUNNEL_COLUMNS)) {
    // Una columna ausente leida como 0 seria un "0 % de conversion" falso.
    if (!names.includes(col)) {
      throw new Error(`ShopifyQL no devolvio la columna ${col} (columnas: ${names.join(', ')})`);
    }
    totals[key] = rows.reduce((acc, row) => acc + read(row, col), 0);
  }

  const rate = n => (totals.sessions > 0 ? (n / totals.sessions) * 100 : null);
  const funnel = {
    ...totals,
    cartRate: rate(totals.cartSessions),
    checkoutRate: rate(totals.checkoutSessions),
    conversionRate: rate(totals.completedSessions),
  };
  console.log(`[Shopify] Funnel ${reportDate}: ${JSON.stringify(funnel)}`);
  return funnel;
}
