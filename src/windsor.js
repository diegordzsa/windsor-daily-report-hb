const META_FIELDS = [
  'date', 'spend', 'impressions', 'clicks', 'actions_link_click',
  'actions_offsite_conversion_fb_pixel_add_to_cart',
  'actions_offsite_conversion_fb_pixel_initiate_checkout',
  'actions_offsite_conversion_fb_pixel_purchase',
  'action_values_offsite_conversion_fb_pixel_purchase',
  'purchase_roas_omni_purchase', 'cpc', 'cpm', 'ctr', 'frequency',
].join(',');

const SHOPIFY_FIELDS = [
  'date', 'order_count', 'order_total_price', 'order_net_sales',
  'order_gross_sales', 'order_total_discounts', 'order_refunds_subtotal',
  'order_quantity', 'order_tags',
].join(',');

const BASE_URL = 'https://connectors.windsor.ai';
const SHOPIFY_ACCOUNT = 'ex9fk2-1i.myshopify.com';

export function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function fetchWindsor(connector, apiKey, fields, extraParams) {
  const params = {
    api_key: apiKey,
    ...extraParams,
    fields,
  };

  const url = `${BASE_URL}/${connector}?` + new URLSearchParams(params);

  console.log(`[Windsor ${connector}] Fetching with params:`, JSON.stringify({ ...extraParams, fields: fields.substring(0, 60) + '...' }));

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Windsor ${connector} error: ${res.status} ${res.statusText} — ${body.substring(0, 200)}`);
  }

  const json = await res.json();
  const rows = json.data ?? json.result ?? json;
  const result = Array.isArray(rows) ? rows : [];

  console.log(`[Windsor ${connector}] Got ${result.length} rows`);
  return result;
}

export async function fetchMetaAds(apiKey) {
  const yesterday = getYesterday();
  return fetchWindsor('facebook', apiKey, META_FIELDS, {
    date_from: yesterday,
    date_to: yesterday,
  });
}

export async function fetchShopifyOrders(apiKey) {
  return fetchWindsor('shopify', apiKey, SHOPIFY_FIELDS, {
    date_preset: 'last_3d',
    account_id: SHOPIFY_ACCOUNT,
  });
}
