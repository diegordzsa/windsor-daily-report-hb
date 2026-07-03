const STORE = 'ex9fk2-1i.myshopify.com';
const API_VERSION = '2024-10';

export function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function fetchShopifyOrders(clientId, clientSecret) {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const yesterday = getYesterday();
  const twoDaysAgo = new Date(yesterday);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 1);
  const minDate = twoDaysAgo.toISOString().slice(0, 10);

  const params = new URLSearchParams({
    status: 'any',
    created_at_min: `${minDate}T00:00:00Z`,
    created_at_max: `${yesterday}T23:59:59Z`,
    limit: '250',
    fields: 'id,created_at,subtotal_price,total_discounts,tags,line_items',
  });

  const allOrders = [];
  let url = `https://${STORE}/admin/api/${API_VERSION}/orders.json?${params}`;

  while (url) {
    console.log(`[Shopify] Fetching orders...`);
    const res = await fetch(url, {
      headers: { 'Authorization': `Basic ${credentials}` },
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

  const yesterdayOrders = allOrders.filter(o => o.created_at?.slice(0, 10) === yesterday);
  console.log(`[Shopify] ${yesterdayOrders.length} orders for ${yesterday}`);

  return yesterdayOrders.map(order => ({
    date: yesterday,
    order_count: 1,
    order_net_sales: parseFloat(order.subtotal_price) || 0,
    order_tags: order.tags || '',
  }));
}
