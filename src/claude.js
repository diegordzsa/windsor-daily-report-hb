import Anthropic from '@anthropic-ai/sdk';

export async function generateDiagnosis(metrics) {
  const client = new Anthropic();

  const prompt = `Eres un analista de ecommerce DTC. Tienes los siguientes datos de ayer para Hair Biolabs Spain:

METRICAS PAID (Meta Ads):
- Gasto: €${metrics.adSpend.toFixed(2)}
- Impresiones: ${metrics.impressions}
- Link Clicks: ${metrics.linkClicks}
- Add to Carts: ${metrics.addToCarts}
- Checkouts Iniciados: ${metrics.checkoutsInitiated}
- Compras (atribuidas Meta): ${metrics.metaOrders}
- ROAS Meta: ${metrics.metaROAS.toFixed(2)}x
- CTR: ${metrics.ctr.toFixed(2)}%
- Add to Cart Rate: ${metrics.addToCartRate.toFixed(2)}%
- Checkout Rate: ${metrics.checkoutRate.toFixed(2)}%
- Purchase Rate: ${metrics.purchaseRate.toFixed(2)}%

METRICAS SHOPIFY (fuente de verdad):
- Revenue neto: €${metrics.shopifyRevenue.toFixed(2)}
- Ordenes reales: ${metrics.shopifyOrders}
- AOV: €${metrics.shopifyAOV.toFixed(2)}

Identifica en 3-4 lineas:
1. Cual es el punto mas debil del funnel hoy y por que
2. Si el ROAS es bueno, malo o normal para un DTC de hair care (benchmark: 2.0x-3.5x)
3. Una accion concreta que se deberia tomar hoy

Responde en espanol, directo, sin introducciones.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content[0].text;
}
