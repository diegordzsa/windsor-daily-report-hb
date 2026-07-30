import { fetchShopifyOrders, getAccessToken, fetchShopInfo } from './shopify.js';
import { fetchMetaAds, fetchMetaAccount } from './meta.js';
import { generateDiagnosis } from './claude.js';
import { sendToSlack, formatReport } from './slack.js';
import { hoursSinceClose, yesterdayInTimezone, dayCloseInstant } from './freshness.js';
import {
  STORE_NAME, STORE_CURRENCY, META_CURRENCY,
  META_ACCOUNT_TIMEZONE, MIN_HOURS_AFTER_CLOSE,
} from './config.js';

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
  // ---------------------------------------------------------------------------
  // GUARD DE FRESCURA. Antes de cualquier fetch de datos.
  // Un gasto de Meta sin consolidar infla ROAS y MER: antes no publicar que
  // publicar mal.
  // ---------------------------------------------------------------------------
  let account;
  try {
    account = await fetchMetaAccount(META_ACCESS_TOKEN);
  } catch (err) {
    console.error(`[Guard] No se pudo leer la cuenta de Meta: ${err.message}`);
    await sendToSlack(SLACK_WEBHOOK_URL,
      `:warning: *${STORE_NAME} — Reporte Diario ABORTADO*\n` +
      `No se pudo leer la configuracion de la cuenta de Meta.\nError: ${err.message}`
    ).catch(() => {});
    process.exit(1);
  }

  const accountTz = account.timezone || META_ACCOUNT_TIMEZONE;
  if (!account.timezone) {
    console.warn(`[Guard] La API no devolvio timezone_name; usando fallback ${META_ACCOUNT_TIMEZONE}`);
  }

  const reportDate = yesterdayInTimezone(accountTz);
  const closeInstant = dayCloseInstant(reportDate, accountTz);
  const hoursElapsed = hoursSinceClose(reportDate, accountTz);

  console.log(`[Guard] Dia del reporte: ${reportDate} (${accountTz})`);
  console.log(`[Guard] Cierre del dia: ${closeInstant.toISOString()}`);
  console.log(`[Guard] Ahora: ${new Date().toISOString()}`);
  console.log(`[Guard] Horas desde el cierre: ${hoursElapsed.toFixed(2)} (minimo ${MIN_HOURS_AFTER_CLOSE})`);

  if (hoursElapsed < MIN_HOURS_AFTER_CLOSE) {
    const msg =
      `:no_entry: *${STORE_NAME} — Reporte Diario NO ENVIADO*\n` +
      `Datos de Meta sin consolidar: solo han pasado *${hoursElapsed.toFixed(2)} h* ` +
      `desde el cierre del ${reportDate} (minimo ${MIN_HOURS_AFTER_CLOSE} h).\n` +
      `El dia cerro a las ${closeInstant.toISOString()} — zona de la cuenta: ${accountTz}.\n` +
      `Un gasto subestimado inflaria ROAS y MER, asi que no se publica.`;
    console.error(`[Guard] BLOQUEADO — ${hoursElapsed.toFixed(2)} h < ${MIN_HOURS_AFTER_CLOSE} h`);
    await sendToSlack(SLACK_WEBHOOK_URL, msg).catch(err =>
      console.error(`[Guard] Aviso a Slack fallido: ${err.message}`)
    );
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Verificacion de moneda: si Shopify o Meta cambian de divisa, las
  // conversiones dejan de ser validas sin fallar. Mejor enterarse.
  // ---------------------------------------------------------------------------
  if (account.currency !== META_CURRENCY) {
    console.error(`[Guard] La cuenta de Meta factura en ${account.currency}, la config dice ${META_CURRENCY}`);
    await sendToSlack(SLACK_WEBHOOK_URL,
      `:no_entry: *${STORE_NAME} — Reporte Diario NO ENVIADO*\n` +
      `La cuenta de Meta cambio de moneda: la API dice *${account.currency}* y la config *${META_CURRENCY}*.\n` +
      `Las conversiones darian cifras falsas. Actualiza \`META_CURRENCY\` antes de volver a ejecutar.`
    ).catch(() => {});
    process.exit(1);
  }

  let metaData, shopifyData;

  try {
    const shopifyToken = await getAccessToken(SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET);
    console.log(`[Shopify] Access token obtained`);

    const shop = await fetchShopInfo(shopifyToken);

    if (shop.currency !== STORE_CURRENCY) {
      console.error(`[Guard] Shopify factura en ${shop.currency}, la config dice ${STORE_CURRENCY}`);
      await sendToSlack(SLACK_WEBHOOK_URL,
        `:no_entry: *${STORE_NAME} — Reporte Diario NO ENVIADO*\n` +
        `Shopify cambio de moneda: la API dice *${shop.currency}* y la config *${STORE_CURRENCY}*.\n` +
        `Actualiza \`STORE_CURRENCY\` antes de volver a ejecutar.`
      ).catch(() => {});
      process.exit(1);
    }

    if (shop.timezone && shop.timezone !== accountTz) {
      console.warn(
        `[Guard] Shopify (${shop.timezone}) y Meta (${accountTz}) estan en zonas distintas. ` +
        `El dia del reporte se calcula con la de Meta.`
      );
    }

    [metaData, shopifyData] = await Promise.all([
      fetchMetaAds(META_ACCESS_TOKEN, reportDate),
      fetchShopifyOrders(shopifyToken, reportDate),
    ]);
  } catch (err) {
    console.error('API fetch failed:', err.message);
    await sendToSlack(SLACK_WEBHOOK_URL,
      `:warning: *${STORE_NAME} — Reporte Diario FALLIDO*\nNo se pudieron obtener datos.\nError: ${err.message}`
    );
    process.exit(1);
  }

  console.log(`[Debug] Meta rows: ${metaData.length}, Shopify rows: ${shopifyData.length}`);

  if (metaData.length === 0 && shopifyData.length === 0) {
    console.warn('Both APIs returned 0 rows — sending warning to Slack');
    await sendToSlack(SLACK_WEBHOOK_URL,
      `:warning: *${STORE_NAME} — Reporte Diario*\n${reportDate}\n\nNo se obtuvieron datos de Meta ni de Shopify. Verifica que los tokens de acceso siguen activos.`
    );
    process.exit(1);
  }

  // Meta gasta en META_CURRENCY, la tienda factura en STORE_CURRENCY.
  const fx = await fetchFxRate(META_CURRENCY, STORE_CURRENCY);

  const metrics = calculateMetrics(metaData, shopifyData, fx.rate);
  console.log(`[Debug] Orders: ${metrics.shopifyOrders}, Net Sales: ${metrics.shopifyRevenue.toFixed(2)}, 1st Sub: ${metrics.firstSubOrders}, Recurring: ${metrics.recurringOrders}`);

  let diagnosis;
  try {
    diagnosis = await generateDiagnosis(metrics);
  } catch (err) {
    console.error('Claude diagnosis failed:', err.message, err.status ?? '', err.error ?? '');
    diagnosis = 'Diagnostico no disponible — error al generar analisis.';
  }

  const reportText = formatReport({
    date: reportDate,
    metrics,
    diagnosis,
    hoursElapsed,
    accountTz,
    fx,
  });

  try {
    await sendToSlack(SLACK_WEBHOOK_URL, reportText);
    console.log('Report sent to Slack successfully.');
  } catch (err) {
    console.error('Failed to send to Slack:', err.message);
    process.exit(1);
  }
}

async function fetchFxRate(from, to) {
  if (from === to) return { rate: 1, exact: true };
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`);
    const json = await res.json();
    const rate = json.rates?.[to];
    if (!rate) throw new Error(`respuesta sin tasa ${from}->${to}`);
    console.log(`[FX] ${from}→${to} rate: ${rate}`);
    return { rate, exact: true };
  } catch (err) {
    console.error(`[FX] Exchange rate fetch failed, falling back to 1:1 — ${err.message}`);
    return { rate: 1, exact: false };
  }
}

function sum(rows, field) {
  return rows.reduce((acc, row) => acc + (Number(row[field]) || 0), 0);
}

function hasTag(row, tag) {
  const tags = row.order_tags || '';
  return tags.includes(tag);
}

function calculateMetrics(metaRows, shopifyRows, fxRate) {
  // --- Cifras nativas de Meta, en META_CURRENCY ---
  const adSpendNative = sum(metaRows, 'spend');
  const metaAttributedRevenueNative = sum(metaRows, 'action_values_offsite_conversion_fb_pixel_purchase');

  const impressions = sum(metaRows, 'impressions');
  const clicks = sum(metaRows, 'clicks');
  const linkClicks = sum(metaRows, 'actions_link_click');
  const addToCarts = sum(metaRows, 'actions_offsite_conversion_fb_pixel_add_to_cart');
  const checkoutsInitiated = sum(metaRows, 'actions_offsite_conversion_fb_pixel_initiate_checkout');
  const metaOrders = sum(metaRows, 'actions_offsite_conversion_fb_pixel_purchase');

  // Ratio adimensional: nativa / nativa, la conversion no le afecta.
  const metaROAS = adSpendNative > 0 ? metaAttributedRevenueNative / adSpendNative : 0;

  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const addToCartRate = linkClicks > 0 ? (addToCarts / linkClicks) * 100 : 0;
  const checkoutRate = addToCarts > 0 ? (checkoutsInitiated / addToCarts) * 100 : 0;
  const purchaseRate = checkoutsInitiated > 0 ? (metaOrders / checkoutsInitiated) * 100 : 0;

  // --- Todo lo monetario expresado en STORE_CURRENCY ---
  const adSpend = adSpendNative * fxRate;
  const metaAttributedRevenue = metaAttributedRevenueNative * fxRate;
  const cpo = metaOrders > 0 ? adSpend / metaOrders : 0;

  const shopifyRevenue = sum(shopifyRows, 'order_net_sales');
  const shopifyOrders = sum(shopifyRows, 'order_count');
  const shopifyAOV = shopifyOrders > 0 ? shopifyRevenue / shopifyOrders : 0;
  const merROAS = adSpend > 0 ? shopifyRevenue / adSpend : 0;

  const orderRows = shopifyRows.filter(r => Number(r.order_count) > 0);
  const firstSubOrders = orderRows.filter(r => hasTag(r, 'Kaching Subscription First Order')).length;
  const recurringOrders = orderRows.filter(r => hasTag(r, 'appstle_subscription_recurring_order')).length;

  return {
    adSpendNative, metaAttributedRevenueNative,
    adSpend, metaAttributedRevenue, cpo,
    impressions, clicks, linkClicks, addToCarts, checkoutsInitiated, metaOrders,
    metaROAS, merROAS, ctr, addToCartRate, checkoutRate, purchaseRate,
    shopifyRevenue, shopifyOrders, shopifyAOV,
    firstSubOrders, recurringOrders,
  };
}

export { calculateMetrics };

if (process.env.NODE_ENV !== 'test') {
  run();
}
