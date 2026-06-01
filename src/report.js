import { fetchMetaAds, fetchShopifyOrders, fetchShopifyCustomers } from './windsor.js';
import { generateDiagnosis } from './claude.js';
import { sendToSlack, formatReport } from './slack.js';

const WINDSOR_API_KEY = process.env.WINDSOR_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

if (!WINDSOR_API_KEY || !ANTHROPIC_API_KEY || !SLACK_WEBHOOK_URL) {
  console.error('Missing required env vars: WINDSOR_API_KEY, ANTHROPIC_API_KEY, SLACK_WEBHOOK_URL');
  process.exit(1);
}

async function run() {
  let metaData, shopifyOrderData, shopifyCustomerData;

  try {
    [metaData, shopifyOrderData, shopifyCustomerData] = await Promise.all([
      fetchMetaAds(WINDSOR_API_KEY),
      fetchShopifyOrders(WINDSOR_API_KEY),
      fetchShopifyCustomers(WINDSOR_API_KEY),
    ]);
  } catch (err) {
    console.error('Windsor API failed:', err.message);
    await sendToSlack(SLACK_WEBHOOK_URL,
      `:warning: *Hair Biolabs ES — Reporte Diario FALLIDO*\nNo se pudieron obtener datos de Windsor.\nError: ${err.message}`
    );
    process.exit(1);
  }

  const metrics = calculateMetrics(metaData, shopifyOrderData, shopifyCustomerData);

  let diagnosis;
  try {
    diagnosis = await generateDiagnosis(metrics);
  } catch (err) {
    console.error('Claude diagnosis failed:', err.message, err.status ?? '', err.error ?? '');
    diagnosis = 'Diagnostico no disponible — error al generar analisis.';
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const reportText = formatReport({
    date: yesterday.toISOString(),
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

function calculateMetrics(metaRows, shopifyOrderRows, shopifyCustomerRows) {
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

  const shopifyRevenue = sum(shopifyOrderRows, 'order_net_sales');
  const shopifyOrders = sum(shopifyOrderRows, 'order_count');
  const shopifyAOV = shopifyOrders > 0 ? shopifyRevenue / shopifyOrders : 0;

  const returningRows = shopifyCustomerRows.filter(r => String(r.customer_is_returning) === 'true');
  const newRows = shopifyCustomerRows.filter(r => String(r.customer_is_returning) === 'false');
  const returningCustomerOrders = sum(returningRows, 'order_count');
  const newCustomerOrders = sum(newRows, 'order_count');

  return {
    adSpend, impressions, clicks, linkClicks, addToCarts,
    checkoutsInitiated, metaOrders, metaAttributedRevenue,
    metaROAS, cpo, ctr, addToCartRate, checkoutRate, purchaseRate,
    shopifyRevenue, shopifyOrders, shopifyAOV,
    newCustomerOrders, returningCustomerOrders,
  };
}

run();
