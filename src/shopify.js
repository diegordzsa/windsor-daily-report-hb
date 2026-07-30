import { SHOPIFY_STORE, SHOPIFY_API_VERSION } from './config.js';
import { addDays } from './freshness.js';

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

  const allOrders = [];
  let url = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${params}`;

  while (url) {
    console.log(`[Shopify] Fetching orders...`);
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Shopify API error: ${res.status} ${res.statusText} — ${body.substring(0, 200)}`);
    }

    const json = await res.json();
    allOrders.push(...(json.orders || []));

    const link = res.headers.get('link');
    const next = link?.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }

  console.log(`[Shopify] Got ${allOrders.length} total orders`);

  const dayOrders = allOrders.filter(o => o.created_at?.slice(0, 10) === reportDate);
  console.log(`[Shopify] ${dayOrders.length} orders for ${reportDate}`);

  return dayOrders.map(order => ({
    date: reportDate,
    order_count: 1,
    order_net_sales: parseFloat(order.subtotal_price) || 0,
    order_tags: order.tags || '',
  }));
}
