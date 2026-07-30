import Anthropic from '@anthropic-ai/sdk';
import { money } from './format.js';
import { STORE_NAME, STORE_CURRENCY, META_CURRENCY } from './config.js';

export async function generateDiagnosis(metrics) {
  const client = new Anthropic();

  // Todas las cifras monetarias van en STORE_CURRENCY y con su simbolo correcto.
  // Etiquetar el gasto nativo de Meta con el simbolo de la tienda le haria
  // razonar con un gasto inflado por el tipo de cambio.
  const m = n => money(n, STORE_CURRENCY);

  const prompt = `Eres un analista de ecommerce DTC. Tienes los siguientes datos de ayer para ${STORE_NAME}.
Todas las cifras monetarias estan en ${STORE_CURRENCY}. La cuenta de Meta factura en ${META_CURRENCY} y ya se han convertido.

METRICAS PAID (Meta Ads):
- Gasto: ${m(metrics.adSpend)} (${money(metrics.adSpendNative, META_CURRENCY)} nativos)
- Impresiones: ${metrics.impressions}
- Link Clicks: ${metrics.linkClicks}
- Add to Carts: ${metrics.addToCarts}
- Checkouts Iniciados: ${metrics.checkoutsInitiated}
- Compras (atribuidas Meta): ${metrics.metaOrders}
- Revenue atribuido por Meta: ${m(metrics.metaAttributedRevenue)}
- ROAS Meta (atribuido): ${metrics.metaROAS.toFixed(2)}x
- MER-ROAS (Shopify revenue / ad spend): ${metrics.merROAS.toFixed(2)}x
- CPO: ${m(metrics.cpo)}
- CTR: ${metrics.ctr.toFixed(2)}%
- Add to Cart Rate: ${metrics.addToCartRate.toFixed(2)}%
- Checkout Rate: ${metrics.checkoutRate.toFixed(2)}%
- Purchase Rate: ${metrics.purchaseRate.toFixed(2)}%

METRICAS SHOPIFY (fuente de verdad):
- Revenue neto: ${m(metrics.shopifyRevenue)}
- Ordenes reales: ${metrics.shopifyOrders}
- AOV: ${m(metrics.shopifyAOV)}
- 1ª Suscripcion (Appstle): ${metrics.firstSubOrders}
- Recurrentes (Appstle): ${metrics.recurringOrders}

Identifica en 3-4 lineas:
1. Cual es el punto mas debil del funnel hoy y por que
2. Compara el ROAS Meta vs MER-ROAS — si la diferencia es grande, que significa para la atribucion
3. Una accion concreta que se deberia tomar hoy

Responde en espanol, directo, sin introducciones.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content[0].text;
}
