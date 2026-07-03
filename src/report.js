import { fetchShopifyOrders, getYesterday } from './shopify.js';
import { fetchMetaAds } from './meta.js';
import { generateDiagnosis } from './claude.js';
import { sendToSlack, formatReport } from './slack.js';

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET || !META_ACCESS_TOKEN || !ANTHROPIC_API_KEY || !SLACK_WEBHOOK_URL) {
  console.error('Missing required env vars: SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, META_ACCESS_TOKEN, ANTHROPIC_API_KEY, SLACK_WEBHOOK_URL');
  process.exit(1);
}

async function run() {
  let metaData, shopifyData;

  try {
    [metaData, shopifyData] = await Promise.all([
      fetchMetaAds(META_ACCESS_TOKEN),
      fetchShopifyOrders(SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET),
    ]);
  } catch (err) {
    console.error('API fetch failed:', err.message);
    await sendToSlack(SLACK_WEBHOOK_URL,
      `:warning: *Hair Biolabs ES — Reporte Diario FALLIDO*\nNo se pudieron obtener datos.\nError: ${err.message}`
    );
    process.exit(1);
  }

  const yesterday = getYesterday();

  console.log(`[Debug] Yesterday: ${yesterday}`);
  console.log(`[Debug] Meta rows: ${metaData.length}, Shopify rows: ${shopifyData.length}`);

  if (metaData.length === 0 && shopifyData.length === 0) {
    console.warn('Both APIs returned 0 rows — sending warning to Slack');
    await sendToSlack(SLACK_WEBHOOK_URL,
      `:warning: *Hair Biolabs ES — Reporte Diario*\n${yesterday}\n\nNo se obtuvieron datos de Meta ni de Shopify. Verifica que los tokens de acceso siguen activos.`
    );
    process.exit(1);
  }

  const metrics = calculateMetrics(metaData, shopifyData);
  console.log(`[Debug] Orders: ${metrics.shopifyOrders}, Net Sales: ${metrics.shopifyRevenue.toFixed(2)}, 1st Sub: ${metrics.firstSubOrders}, Recurring: ${metrics.recurringOrders}`);

  let diagnosis;
  try {
    diagnosis = await generateDiagnosis(metrics);
  } catch (err) {
    console.error('Claude diagnosis failed:', err.message, err.status ?? '', err.error ?? '');
    diagnosis = 'Diagnostico no disponible — error al generar analisis.';
  }

  const reportText = formatReport({
    date: yesterday,
    metrics,
    diagnosis,
  });

  try {
    await sendToSlack(SLACK_WEBHOOK_URL, reportText);
    console.log('Report sent to Slack successfully.');
  } catch (err) {
    console.error('Failed to send to Slack:', err.message);
    process.exit(1);
  }
}

function sum(rows, field) {
  return rows.reduce((acc, row) => acc + (Number(row[field]) || 0), 0);
}

function hasTag(row, tag) {
  const tags = row.order_tags || '';
  return tags.includes(tag);
}

function calculateMetrics(metaRows, shopifyRows) {
  const adSpend = sum(metaRows, 'spend');
  const impressions = sum(metaRows, 'impressions');
  const clicks = sum(metaRows, 'clicks');
  const linkClicks = sum(metaRows, 'actions_link_click');
  const addToCarts = sum(metaRows, 'actions_offsite_conversion_fb_pixel_add_to_cart');
  const checkoutsInitiated = sum(metaRows, 'actions_offsite_conversion_fb_pixel_initiate_checkout');
  const metaOrders = sum(metaRows, 'actions_offsite_conversion_fb_pixel_purchase');
  const metaAttributedRevenue = sum(metaRows, 'action_values_offsite_conversion_fb_pixel_purchase');

  const metaROAS = adSpend > 0 ? metaAttributedRevenue / adSpend : 0;
  const cpo = metaOrders > 0 ? adSpend / metaOrders : 0;
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const addToCartRate = linkClicks > 0 ? (addToCarts / linkClicks) * 100 : 0;
  const checkoutRate = addToCarts > 0 ? (checkoutsInitiated / addToCarts) * 100 : 0;
  const purchaseRate = checkoutsInitiated > 0 ? (metaOrders / checkoutsInitiated) * 100 : 0;

  const shopifyRevenue = sum(shopifyRows, 'order_net_sales');
  const shopifyOrders = sum(shopifyRows, 'order_count');
  const shopifyAOV = shopifyOrders > 0 ? shopifyRevenue / shopifyOrders : 0;

  const orderRows = shopifyRows.filter(r => Number(r.order_count) > 0);
  const firstSubOrders = orderRows.filter(r => hasTag(r, 'Kaching Subscription First Order')).length;
  const recurringOrders = orderRows.filter(r => hasTag(r, 'appstle_subscription_recurring_order')).length;

  return {
    adSpend, impressions, clicks, linkClicks, addToCarts,
    checkoutsInitiated, metaOrders, metaAttributedRevenue,
    metaROAS, cpo, ctr, addToCartRate, checkoutRate, purchaseRate,
    shopifyRevenue, shopifyOrders, shopifyAOV,
    firstSubOrders, recurringOrders,
  };
}

run();
