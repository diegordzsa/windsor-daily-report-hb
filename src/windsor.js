const META_FIELDS = [
  'date', 'spend', 'impressions', 'clicks', 'actions_link_click',
  'actions_offsite_conversion_fb_pixel_add_to_cart',
  'actions_offsite_conversion_fb_pixel_initiate_checkout',
  'actions_offsite_conversion_fb_pixel_purchase',
  'action_values_offsite_conversion_fb_pixel_purchase',
  'purchase_roas_omni_purchase', 'cpc', 'cpm', 'ctr', 'frequency',
].join(',');

const SHOPIFY_ORDER_FIELDS = [
  'date', 'order_count', 'order_total_price', 'order_net_sales',
  'order_gross_sales', 'order_total_discounts', 'order_refunds_subtotal',
  'order_quantity',
].join(',');

const SHOPIFY_CUSTOMER_FIELDS = [
  'date', 'order_count', 'customer_is_returning',
].join(',');

const BASE_URL = 'https://connectors.windsor.ai';

function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function fetchConnector(connector, apiKey, fields) {
  const yesterday = getYesterday();
  const url = `${BASE_URL}/${connector}?` + new URLSearchParams({
    api_key: apiKey,
    date_from: yesterday,
    date_to: yesterday,
    fields,
  });

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Windsor ${connector} error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  return json.data ?? json;
}

export async function fetchMetaAds(apiKey) {
  return fetchConnector('facebook', apiKey, META_FIELDS);
}

export async function fetchShopifyOrders(apiKey) {
  return fetchConnector('shopify', apiKey, SHOPIFY_ORDER_FIELDS);
}

export async function fetchShopifyCustomers(apiKey) {
  return fetchConnector('shopify', apiKey, SHOPIFY_CUSTOMER_FIELDS);
}
