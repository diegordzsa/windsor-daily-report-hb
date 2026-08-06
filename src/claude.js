import Anthropic from '@anthropic-ai/sdk';
import { money } from './format.js';
import { STORE_NAME, STORE_CURRENCY, META_CURRENCY } from './config.js';

export async function generateDiagnosis(metrics) {
  const client = new Anthropic();

  // Todas las cifras monetarias van en STORE_CURRENCY y con su simbolo correcto.
  // Etiquetar el gasto nativo de Meta con el simbolo de la tienda le haria
  // razonar con un gasto inflado por el tipo de cambio.
  const m = n => money(n, STORE_CURRENCY);

  // Con varias cuentas hay que decirselo: si no, razona como si el gasto viniera
  // de una sola y propone acciones que no encajan con como esta repartido.
  const accounts = metrics.perAccount ?? [];
  const breakdownLine = accounts.length > 1
    ? `\n- Desglose del gasto por cuenta: ${accounts.map(a => `${a.label} ${m(a.spend)}`).join(' · ')}`
    : '';

  const prompt = `Eres un analista de ecommerce DTC. Tienes los siguientes datos de ayer para ${STORE_NAME}.
Todas las cifras monetarias estan en ${STORE_CURRENCY}. Las cuentas de Meta facturan en ${META_CURRENCY} y ya se han convertido.

METRICAS PAID (Meta Ads):
- Gasto: ${m(metrics.adSpend)} (${money(metrics.adSpendNative, META_CURRENCY)} nativos)${breakdownLine}
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
- 1ª Suscripcion (altas con tag Kaching First Order): ${metrics.firstSubOrders}
- Recurrentes (cobros automaticos de suscripcion con exito): ${metrics.recurringOrders}

Responde exactamente tres lineas, una por punto, sin numerarlas ni titularlas:
1. El punto mas debil del funnel hoy y por que.
2. ROAS Meta vs MER-ROAS: si la diferencia es grande, que significa para la atribucion.
3. Una accion concreta para hoy.

Formato obligatorio:
- Espanol, directo, sin introducciones ni cierres.
- Maximo 35 palabras por linea.
- Texto plano. Nada de markdown: ni **negrita**, ni ##, ni vinietas. Esto se
  publica en Slack, donde ** no es negrita y se ve como asteriscos sueltos.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    // Holgado a proposito: con 300 la respuesta se cortaba a media frase.
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content[0].text;
}
