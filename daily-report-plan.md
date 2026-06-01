# Plan: Sistema de Reporte Diario Automatizado
**Hair Biolabs Spain — Windsor + Claude + Slack**
**Ultima actualizacion: Junio 2026**

---

## Resumen del sistema

Un script Node.js corre cada dia a las 5:00 AM via GitHub Actions. Extrae metricas de Meta Ads y Shopify a traves de la API de Windsor, las procesa, llama a Claude para generar un diagnostico del funnel, y envia un reporte formateado a Slack.

---

## 1. Stack tecnico

| Componente | Herramienta | Notas |
|---|---|---|
| Trigger (cron) | GitHub Actions | `cron: '0 3 * * *'` (3 AM UTC = 5 AM CEST) |
| Lenguaje | Node.js 20 | Script unico `report.js` |
| Datos de ads | Windsor API | Connector: `facebook` |
| Datos de tienda | Windsor API | Connector: `shopify` |
| Inteligencia | Claude API (Sonnet) | Analisis del funnel |
| Destino | Slack Webhook | Block Kit formatting |
| Secretos | GitHub Secrets | Ver seccion 5 |

---

## 2. Metricas que se extraen

### 2a. Meta Ads (connector: `facebook`, account: `2217973965310655`)

Fecha: `yesterday` (dia anterior completo)

| Campo Windsor | Descripcion |
|---|---|
| `date` | Fecha |
| `campaign` | Nombre de la campana |
| `spend` | Gasto total en euros |
| `impressions` | Impresiones |
| `clicks` | Clicks totales |
| `actions_link_click` | Link clicks (clicks que llevan al sitio) |
| `actions_offsite_conversion_fb_pixel_add_to_cart` | Add to cart eventos (pixel) |
| `actions_offsite_conversion_fb_pixel_initiate_checkout` | Checkouts iniciados (pixel) |
| `actions_offsite_conversion_fb_pixel_purchase` | Compras atribuidas (pixel) |
| `action_values_offsite_conversion_fb_pixel_purchase` | Valor de compras atribuidas (EUR) |
| `purchase_roas_omni_purchase` | ROAS calculado por Meta |
| `cpc` | Costo por click |
| `cpm` | Costo por 1,000 impresiones |
| `ctr` | CTR (porcentaje de clicks) |
| `frequency` | Frecuencia promedio |

**Agrupado por:** dia (sin breakdown por campana en primera version)

### 2b. Shopify (connector: `shopify`, account: `ex9fk2-1i.myshopify.com`)

Fecha: `yesterday`

| Campo Windsor | Descripcion |
|---|---|
| `date` | Fecha de la orden |
| `order_count` | Numero de ordenes |
| `order_total_price` | Revenue total (incluye impuestos y descuentos) |
| `order_net_sales` | Net sales (gross - descuentos - devoluciones) |
| `order_gross_sales` | Gross sales |
| `order_total_discounts` | Total de descuentos aplicados |
| `order_refunds_subtotal` | Total de reembolsos |
| `order_quantity` | Unidades vendidas |
| `customer_is_returning` | Para separar clientes nuevos vs recurrentes |

**Agrupado por:** dia

---

## 3. Calculos del script

Todos estos calculos se hacen en JavaScript puro, sin Claude:

```
// Metricas de Meta
adSpend = suma de spend
metaAttributedRevenue = suma de action_values_offsite_conversion_fb_pixel_purchase
metaROAS = metaAttributedRevenue / adSpend
metaOrders = suma de actions_offsite_conversion_fb_pixel_purchase
cpo = adSpend / metaOrders              // Costo por orden
ctr = clicks / impressions * 100
addToCartRate = addToCarts / linkClicks * 100
checkoutRate = checkoutsInitiated / addToCarts * 100
purchaseRate = purchases / checkoutsInitiated * 100

// Metricas de Shopify (fuente de verdad para revenue)
shopifyRevenue = suma de order_net_sales
shopifyOrders = suma de order_count
shopifyAOV = shopifyRevenue / shopifyOrders

// Funnel completo (estimado)
impressions -> linkClicks -> addToCarts -> checkoutsInitiated -> purchases
```

---

## 4. Prompt de Claude para el diagnostico del funnel

El script manda a Claude los numeros crudos ya calculados. Claude responde con maximo 4-5 lineas de diagnostico en espanol.

**Prompt que se manda a Claude:**

```
Eres un analista de ecommerce DTC. Tienes los siguientes datos de ayer para Hair Biolabs Spain:

METRICAS PAID (Meta Ads):
- Gasto: €{adSpend}
- Impresiones: {impressions}
- Link Clicks: {linkClicks}
- Add to Carts: {addToCarts}
- Checkouts Iniciados: {checkoutsInitiated}
- Compras (atribuidas Meta): {metaOrders}
- ROAS Meta: {metaROAS}x
- CTR: {ctr}%
- Add to Cart Rate: {addToCartRate}%
- Checkout Rate: {checkoutRate}%
- Purchase Rate: {purchaseRate}%

METRICAS SHOPIFY (fuente de verdad):
- Revenue neto: €{shopifyRevenue}
- Ordenes reales: {shopifyOrders}
- AOV: €{shopifyAOV}

Identifica en 3-4 lineas:
1. Cual es el punto mas debil del funnel hoy y por que
2. Si el ROAS es bueno, malo o normal para un DTC de hair care (benchmark: 2.0x-3.5x)
3. Una accion concreta que se deberia tomar hoy

Responde en espanol, directo, sin introducciones.
```

---

## 5. Secretos en GitHub

Ir a: `Settings > Secrets and variables > Actions > New repository secret`

| Nombre del secret | Valor |
|---|---|
| `WINDSOR_API_KEY` | Tu API key de Windsor |
| `ANTHROPIC_API_KEY` | Tu API key de Claude |
| `SLACK_WEBHOOK_URL` | La URL del webhook de tu canal Slack |

---

## 6. Estructura del reporte en Slack

```
📊 Hair Biolabs ES — Reporte Diario
31 de Mayo, 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 REVENUE
  Net Sales (Shopify): €X,XXX
  Ordenes: XX | AOV: €XX.XX

📣 PAID ADS (Meta)
  Gasto: €XXX.XX
  ROAS: X.Xx | CPO: €XX.XX
  Revenue atribuido: €X,XXX

🔍 FUNNEL
  Impresiones: X,XXX
  Link Clicks: XXX (CTR: X.X%)
  Add to Cart: XX (X.X%)
  Checkout: XX (X.X%)
  Compras: X (X.X%)

🤖 DIAGNOSTICO (Claude)
  [3-4 lineas de analisis]

━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generado automaticamente a las 5:00 AM
```

---

## 7. Estructura del repositorio

```
daily-report/
├── .github/
│   └── workflows/
│       └── daily-report.yml      # Cron job GitHub Actions
├── src/
│   ├── report.js                 # Script principal (orquestador)
│   ├── windsor.js                # Funciones para llamar Windsor API
│   ├── claude.js                 # Funcion para llamar Claude API
│   └── slack.js                  # Funcion para enviar a Slack
├── package.json
└── README.md
```

---

## 8. GitHub Actions YAML (logica del cron)

```yaml
name: Daily Report

on:
  schedule:
    - cron: '0 3 * * *'   # 3 AM UTC = 5 AM hora de Madrid (CEST)
  workflow_dispatch:        # Permite correrlo manualmente

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Run daily report
        env:
          WINDSOR_API_KEY: ${{ secrets.WINDSOR_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        run: node src/report.js
```

---

## 9. Logica de Windsor API

La API de Windsor es REST. El endpoint principal:

```
GET https://connectors.windsor.ai/facebook?api_key={KEY}&date_preset=yesterday&fields=date,spend,impressions,...
GET https://connectors.windsor.ai/shopify?api_key={KEY}&date_preset=yesterday&fields=date,order_count,...
```

Los campos se pasan como lista separada por comas en el query param `fields`.

**Campos confirmados disponibles para Meta:**
`date, spend, impressions, clicks, actions_link_click, actions_offsite_conversion_fb_pixel_add_to_cart, actions_offsite_conversion_fb_pixel_initiate_checkout, actions_offsite_conversion_fb_pixel_purchase, action_values_offsite_conversion_fb_pixel_purchase, purchase_roas_omni_purchase, cpc, cpm, ctr, frequency`

**Campos confirmados disponibles para Shopify:**
`date, order_count, order_total_price, order_net_sales, order_gross_sales, order_total_discounts, order_refunds_subtotal, order_quantity`

---

## 10. Manejo de errores

El script debe manejar estos casos:

- **Windsor no responde:** Enviar a Slack un mensaje de error indicando que el reporte fallo
- **Sin datos de ayer:** Puede pasar si no hubo campanas activas. Enviar "Sin actividad de ads ayer"
- **Claude falla:** El reporte se envia igual, pero sin la seccion de diagnostico
- **Slack falla:** Loggear el error en GitHub Actions (queda visible en los logs del workflow)

---

## 11. Orden de construccion

Cuando llegue el momento de construir, el orden es:

1. Crear el repo en GitHub (privado)
2. Configurar los 3 GitHub Secrets
3. Crear `package.json` con dependencias: `node-fetch` (o `axios`)
4. Construir `windsor.js` — testear que los datos llegan correctos
5. Construir `claude.js` — testear el diagnostico con datos dummy
6. Construir `slack.js` — testear el formato del mensaje
7. Construir `report.js` — integrar todo
8. Crear el workflow YAML
9. Hacer un `workflow_dispatch` manual para validar el end-to-end
10. Confirmar que llega el mensaje a Slack correctamente

---

## 12. Notas importantes

- **Zona horaria:** El cron en GitHub Actions corre en UTC. 5 AM Madrid (CEST = UTC+2) = 3 AM UTC. En invierno (CET = UTC+1), seria `0 4 * * *`.
- **Claude API key:** Puedes usar tu propia key. El modelo a usar es `claude-sonnet-4-20250514`.
- **Data lag de Meta:** Meta a veces tiene lag de 1-3 horas en reportar datos. El reporte de las 5 AM incluira datos del dia anterior con ~99% de completitud.
- **ROAS discrepancia:** El ROAS de Meta (atribucion) siempre sera diferente al ROAS real (Shopify revenue / ad spend). El reporte muestra ambos para que tengas los dos puntos de vista.
