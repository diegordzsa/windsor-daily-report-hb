import { money, int, num, pct, ratio } from './format.js';
import {
  STORE_NAME, STORE_CURRENCY, META_CURRENCY,
  STORE_LOCALE, REPORT_TIME_LABEL,
} from './config.js';

export async function sendToSlack(webhookUrl, reportText) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: reportText },
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook error: ${res.status} ${res.statusText}`);
  }
}

export function formatReport({ date, metrics, diagnosis, hoursElapsed, accountTz, fx }) {
  const dateStr = new Date(`${date}T12:00:00Z`).toLocaleDateString(STORE_LOCALE, {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  // El gasto se muestra en la moneda de la tienda con el nativo al lado, para
  // que la cifra sea comparable con el AOV y trazable contra el panel de Meta.
  const spendLine = META_CURRENCY === STORE_CURRENCY
    ? `  Gasto: ${money(metrics.adSpend, STORE_CURRENCY)}`
    : `  Gasto: ${money(metrics.adSpend, STORE_CURRENCY)} (${money(metrics.adSpendNative, META_CURRENCY)})`;

  const lines = [
    `:bar_chart: *${STORE_NAME} — Reporte Diario*`,
    dateStr,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `:moneybag: *REVENUE*`,
    `  Net Sales (Shopify): ${money(metrics.shopifyRevenue, STORE_CURRENCY)}`,
    `  Ordenes: ${metrics.shopifyOrders} | AOV: ${money(metrics.shopifyAOV, STORE_CURRENCY)}`,
    `  1ª Susc: ${metrics.firstSubOrders} | Recurrentes: ${metrics.recurringOrders}`,
    ``,
    `:loudspeaker: *PAID ADS (Meta)*`,
    spendLine,
    `  ROAS (Meta): ${ratio(metrics.metaROAS)} | MER: ${ratio(metrics.merROAS)}`,
    `  CPO: ${money(metrics.cpo, STORE_CURRENCY)}`,
    `  Revenue atribuido: ${money(metrics.metaAttributedRevenue, STORE_CURRENCY)}`,
    ``,
    `:mag: *FUNNEL*`,
    `  Impresiones: ${int(metrics.impressions)}`,
    `  Link Clicks: ${int(metrics.linkClicks)} (CTR: ${pct(metrics.ctr)})`,
    `  Add to Cart: ${metrics.addToCarts} (${pct(metrics.addToCartRate)})`,
    `  Checkout: ${metrics.checkoutsInitiated} (${pct(metrics.checkoutRate)})`,
    `  Compras: ${metrics.metaOrders} (${pct(metrics.purchaseRate)})`,
    ``,
    `:robot_face: *DIAGNOSTICO (Claude)*`,
    ...diagnosis.split('\n').map(line => `  ${line}`),
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ...footer({ date, hoursElapsed, accountTz, fx }),
  ];

  return lines.join('\n');
}

function footer({ date, hoursElapsed, accountTz, fx }) {
  const out = [];

  if (Number.isFinite(hoursElapsed)) {
    out.push(
      `_Gasto de Meta con ${num(hoursElapsed, 1)} h de consolidacion: ` +
      `el ${date} cerro a las 00:00 ${accountTz}._`
    );
  }

  if (META_CURRENCY !== STORE_CURRENCY) {
    out.push(
      fx?.exact
        ? `_Meta factura en ${META_CURRENCY}; convertido a ${STORE_CURRENCY} a ${fx.rate} (frankfurter.app)._`
        : `_:warning: Tasa ${META_CURRENCY}→${STORE_CURRENCY} no disponible: cifras sin convertir (1:1)._`
    );
  }

  out.push(`_Envio programado: ${REPORT_TIME_LABEL}._`);
  return out;
}
