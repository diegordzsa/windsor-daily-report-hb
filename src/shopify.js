import { SHOPIFY_STORE, SHOPIFY_API_VERSION, SUBSCRIPTION_TIMEZONE } from './config.js';
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
