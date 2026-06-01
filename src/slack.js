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

export function formatReport({ date, metrics, diagnosis }) {
  const d = new Date(date);
  const dateStr = d.toLocaleDateString('es-ES', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return [
    `:bar_chart: *Hair Biolabs ES — Reporte Diario*`,
    dateStr,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `:moneybag: *REVENUE*`,
    `  Net Sales (Shopify): €${fmt(metrics.shopifyRevenue)}`,
    `  Ordenes: ${metrics.shopifyOrders} | AOV: €${fmt(metrics.shopifyAOV)}`,
    `  Nuevos: ${metrics.newCustomerOrders} | Recurrentes: ${metrics.returningCustomerOrders}`,
    ``,
    `:loudspeaker: *PAID ADS (Meta)*`,
    `  Gasto: €${fmt(metrics.adSpend)}`,
    `  ROAS: ${metrics.metaROAS.toFixed(2)}x | CPO: €${fmt(metrics.cpo)}`,
    `  Revenue atribuido: €${fmt(metrics.metaAttributedRevenue)}`,
    ``,
    `:mag: *FUNNEL*`,
    `  Impresiones: ${fmtInt(metrics.impressions)}`,
    `  Link Clicks: ${fmtInt(metrics.linkClicks)} (CTR: ${metrics.ctr.toFixed(1)}%)`,
    `  Add to Cart: ${metrics.addToCarts} (${metrics.addToCartRate.toFixed(1)}%)`,
    `  Checkout: ${metrics.checkoutsInitiated} (${metrics.checkoutRate.toFixed(1)}%)`,
    `  Compras: ${metrics.metaOrders} (${metrics.purchaseRate.toFixed(1)}%)`,
    ``,
    `:robot_face: *DIAGNOSTICO (Claude)*`,
    ...diagnosis.split('\n').map(line => `  ${line}`),
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `_Generado automaticamente a las 5:00 AM_`,
  ].join('\n');
}

function fmt(n) {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(n) {
  return n.toLocaleString('es-ES');
}
