# Setup — Reporte diario Hair Biolabs ES

Reporte diario a Slack con datos de Shopify y Meta Ads, más un diagnóstico
generado por Claude. Se ejecuta en GitHub Actions, disparado desde
**cron-job.org**, no desde el cron de GitHub.

## Por qué NO hay `schedule:` en el workflow

El cron de GitHub Actions no garantiza la hora. Medido **en este repo**, sobre
las 7 ejecuciones que hubo con `cron: '0 7 * * *'`:

| Fecha | Arranque real (UTC) | Retraso |
|---|---|---|
| 2026-07-23 | 09:20 | +2 h 20 |
| 2026-07-24 | 09:15 | +2 h 15 |
| 2026-07-25 | 08:56 | +1 h 56 |
| 2026-07-26 | 09:08 | +2 h 08 |
| 2026-07-27 | 10:34 | +3 h 34 |
| 2026-07-28 | 09:31 | +2 h 31 |
| 2026-07-29 | 09:33 | +2 h 33 |

**1 h 38 min de deriva, sin patrón.** Para una hora de entrega fija no sirve.
El workflow deja solo `workflow_dispatch:` y lo dispara un cronjob externo.

## Zonas horarias y monedas (MEDIDAS, no supuestas)

Medido el 2026-07-29/30 con un workflow temporal de solo lectura.

`GET /v21.0/act_2217973965310655?fields=name,timezone_name,timezone_offset_hours_utc,currency`

```json
{
  "name": "HAIR_BIO_01",
  "timezone_name": "Europe/Madrid",
  "timezone_offset_hours_utc": 2,
  "currency": "USD"
}
```

`GET /admin/api/2024-10/shop.json`

```json
{
  "name": "Hair Biolabs",
  "iana_timezone": "Europe/Madrid",
  "currency": "EUR",
  "money_format": "€{{amount_with_comma_separator}}"
}
```

**Meta gasta en USD; Shopify factura en EUR.** No son intercambiables:
`report.js` convierte con la tasa diaria de frankfurter.app y `format.js` exige
un código de moneda explícito en cada cifra. Los ratios (ROAS de Meta) se
calculan en moneda nativa, así que el tipo de cambio no les afecta.

Si Meta o Shopify cambian de divisa, el guard **aborta** en vez de publicar
cifras falsas. Hay que actualizar `META_CURRENCY` / `STORE_CURRENCY`.

## Cuándo cierra el día

La zona de la cuenta de Meta (`timezone_name`) es la que manda: define cuándo
cierra el día para Meta y por tanto la hora más temprana a la que puede existir
un reporte fiable.

| | |
|---|---|
| Cierre del día D | 00:00 del día D+1 en `Europe/Madrid` |
| En UTC, verano (CEST) | 22:00 UTC del día D |
| En UTC, invierno (CET) | 23:00 UTC del día D |

Cuenta de Meta, tienda y lector están **los tres en `Europe/Madrid`**, así que
el día cierra a medianoche de la hora del lector y las horas post-cierre se
mantienen constantes todo el año.

## Por qué la entrega es a las 09:00 Europe/Madrid

1. **Cierre del día:** 00:00 Europe/Madrid.
2. **Más temprana defendible:** cierre + `MIN_HOURS_AFTER_CLOSE` (3 h) =
   **03:00** Europe/Madrid.
3. **Entrega elegida: 09:00 Europe/Madrid = 9 h post-cierre**, 3× el mínimo.

### Deriva de consolidación de Meta — medida

Se cruzó el gasto que reportó cada ejecución (`[Meta] Raw spend for <fecha>`)
contra el consolidado pedido días después:

| Fecha | Reportado | Hora UTC del fetch | h post-cierre | Consolidado | Error |
|---|---|---|---|---|---|
| 2026-07-22 | 2013,63 | 23-jul 09:20:32 | 11,34 | 2015,40 | −0,088 % |
| 2026-07-23 | 1834,07 | 24-jul 09:15:48 | 11,26 | 1835,03 | −0,052 % |
| 2026-07-24 | 1608,44 | 25-jul 08:59:22 | 10,99 | 1609,61 | −0,073 % |
| 2026-07-25 | 2056,19 | 26-jul 09:08:13 | 11,14 | 2057,37 | −0,057 % |
| 2026-07-26 | 2125,46 | 27-jul 10:34:23 | 12,57 | 2126,53 | −0,050 % |
| 2026-07-27 | 2026,13 | 28-jul 09:31:50 | 11,53 | 2028,52 | −0,118 % |
| 2026-07-28 | 1881,86 | 29-jul 09:33:23 | 11,56 | 1883,18 | −0,070 % |

**Rango −0,050 % a −0,118 %**, siempre por debajo del consolidado, plano dentro
de la franja.

El gasto del 2026-07-28 se midió tres veces: `1883,12` (29-jul 19:04 UTC),
`1883,17` (30-jul ~19:0x UTC), `1883,18` (30-jul 03:52 UTC). Repta
indefinidamente en el orden de ±0,003 %: esperar más no aporta nada.

### Primer punto en la franja temprana

El 2026-07-30 el gasto del 29-jul se leyó dos veces el mismo día:

| Lectura | h post-cierre | Gasto | Error |
|---|---|---|---|
| dry run, 03:56 UTC | 5,94 | 2471,51 | **−0,150 %** |
| envío real, 21:23 UTC | 23,39 | 2475,23 | referencia |

La deriva encoge conforme pasan las horas: **−0,150 % a 6 h** frente a
**−0,050 / −0,118 % a 11–12,6 h**. Las 09:00 (9 h) caen entre medias, así que
cabe esperar del orden de −0,12 / −0,13 %.

### Limitación conocida

**No hay ninguna medición exactamente a 9 h.** La línea de log
`[Meta] Raw spend` se añadió el 2026-07-22, así que las ejecuciones anteriores
(que sí arrancaban entre 05:15 y 07:01 UTC, es decir 7–9 h post-cierre) no la
registran y esa franja **no es recuperable hacia atrás**.

Las 09:00 se apoyan en el umbral por defecto de 3 h y en la interpolación entre
los puntos de 6 h y 11 h, no en una medición directa a 9 h. Como el reporte imprime las horas de consolidación en el pie y registra
`[Meta] Raw spend for <fecha>`, la propia entrega diaria mide la deriva a 9 h:
si sube por encima del rango de arriba, hay que subir la entrega a 11:00 (o
`MIN_HOURS_AFTER_CLOSE` a 11) y volver a medir.

**Nunca bajar de 3 h por corazonada.** Para bajar hace falta un probe
`workflow_dispatch` de solo lectura, ~5 días de muestras y comparar contra el
consolidado.

## El guard de frescura

En `src/report.js`, **antes de cualquier fetch de datos**:

1. Lee `timezone_name` y `currency` de la API de Meta en cada ejecución
   (fallback: `META_ACCOUNT_TIMEZONE`).
2. Calcula el día del reporte y las horas desde el cierre con
   `src/freshness.js`.
3. Si `horas < MIN_HOURS_AFTER_CLOSE`: avisa a Slack y `process.exit(1)`, para
   que se vea en rojo en Actions.
4. Aborta también si la moneda de Meta o de Shopify no coincide con la config.

`src/freshness.js` calcula el instante de cierre con `Intl.DateTimeFormat`
(doble pasada para los cambios de horario). Verificado con 31 casos: verano,
invierno, los dos saltos de horario de 2026 (29-mar y 25-oct, incluyendo que
esos días duran 23 h y 25 h), fin de mes, fin de año y 29 de febrero.

## Cómo se cuenta «Recurrentes»

La línea `Recurrentes` del bloque REVENUE es **el número de cobros automáticos
de suscripción con éxito de ese día**. Nada más: ni altas, ni pedidos con
producto de suscripción dentro.

**Fuente.** REST Admin API, `GET /admin/api/{version}/orders.json`, paginando
por el header `Link rel="next"` hasta agotarlo. Campos:
`id,name,created_at,tags,total_price,checkout_id`.

**Ventana del día.** Europe/Madrid (`SUBSCRIPTION_TIMEZONE`), de `00:00:00` a
`23:59:59`, con el desplazamiento UTC real de ese día escrito explícitamente en
la query (`+01:00` invierno, `+02:00` verano). El desplazamiento se obtiene
sondeando las **12:00 UTC** de ese día: los cambios de horario ocurren de
madrugada, así que a mediodía nunca se cae del lado equivocado de la
transición. No se usa la zona por defecto del runtime — Actions corre en UTC y
en verano eso movería dos horas de cobros al día siguiente.

**Filtro.** Las dos condiciones a la vez:

1. `tags` contiene `Kaching Subscription` (subcadena, sin distinguir mayúsculas)
2. `checkout_id` es `null` o no viene

La segunda es el truco entero. Un intento de cobro con éxito siempre crea
pedido, y Shopify lo crea **sin sesión de checkout** porque nadie pasó por la
caja. Toda compra de escaparate lleva `checkout_id`. Y como un intento fallido
no llega a crear pedido, lo que pasa el filtro ya es un éxito: no hay que mirar
`financial_status` ni `cancelled_at`.

**Lo que no funciona, y por qué:**

| Criterio | Por qué no |
|---|---|
| Solo el tag `Recurring Order` | Deja fuera las primeras cuotas cobradas automáticamente, que también son cobros con éxito. El 2026-07-27 contaba **11** donde había **17** |
| Todos los `First Order` | La mayoría entró por checkout: son altas, no cobros automáticos |
| `financial_status` / `cancelled_at` | Ruido: el filtro ya solo deja éxitos |
| GraphQL `subscriptionBillingAttempts` | Pide `read_own_subscription_contracts`, que solo expone los contratos creados por la propia app. Una app a medida recibe **0 filas y ningún error** |
| Leer la UI de Kaching | Es un iframe con scroll propio y paginación engañosa |

**Medición del 2026-07-31** (10 días, datos reales). La columna «antes» es el
tag de Appstle que quedó en el código tras migrar a Kaching el 9-jun: la app ya
no existía en la tienda, así que `Recurrentes` publicó **0 todos los días desde
entonces**.

| Día | Pedidos | Antes | Ahora | Solo tag `Recurring Order` |
|---|---|---|---|---|
| 2026-07-30 | 75 | 0 | 19 | 8 |
| 2026-07-29 | 97 | 0 | 15 | 10 |
| 2026-07-28 | 90 | 0 | 19 | 12 |
| 2026-07-27 | 83 | 0 | 17 | 11 |
| 2026-07-26 | 55 | 0 | 16 | 15 |
| 2026-07-25 | 55 | 0 | 10 | 9 |
| 2026-07-24 | 51 | 0 | 14 | 10 |
| 2026-07-23 | 48 | 0 | 10 | 6 |
| 2026-07-22 | 72 | 0 | 22 | 14 |
| 2026-07-21 | 74 | 0 | 18 | 12 |

**Validación — hecha.** El **2026-07-30** el filtro da **19** y la página de
eventos de Kaching da 19. Contrastado a mano, cuadra exacto.

Para repetirlo con otro día, hay que ampliar la altura del iframe o solo se ven
5 filas:

```
/apps/kaching-subscriptions/app/subscriptions/events?savedView=Billing
  &eventType=BILLING_ATTEMPT_SUCCESS&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
```

Merece la pena rehacer el contraste si Kaching cambia de versión o si aparece
otra app que también etiquete pedidos con `Kaching Subscription`.

**Limitación conocida.** Los dos días de cambio de horario (29-mar y 25-oct)
duran 23 h y 25 h, pero la ventana usa un solo desplazamiento en los dos
extremos. El 29-mar entra de más la última hora del día anterior; el 25-oct se
queda fuera la primera hora del día. Es consecuencia directa de sondear a
mediodía, que es lo que evita el error mucho peor de partir la ventana por la
mitad de la transición. Los cobros salen en tanda a hora fija, así que en la
práctica no cae nada en esa hora — pero conviene no comparar a ciegas esos dos
días contra Kaching.

## Variables de entorno

Definidas en `.github/workflows/daily-report.yml`. Valores **medidos**, no
copiados de otro repo.

| Variable | Valor | Origen |
|---|---|---|
| `META_ACCOUNT_TIMEZONE` | `Europe/Madrid` | `act_…/timezone_name` |
| `META_CURRENCY` | `USD` | `act_…/currency` |
| `STORE_CURRENCY` | `EUR` | `shop.json/currency` |
| `STORE_LOCALE` | `es-ES` | `shop.json/primary_locale` |
| `MIN_HOURS_AFTER_CLOSE` | `3` | por defecto |
| `REPORT_TIME_LABEL` | `09:00 Europe/Madrid` | decidido en Fase 2 |
| `REPORT_TIMEZONE` | `Europe/Madrid` | zona del lector |
| `SUBSCRIPTION_TIMEZONE` | `Europe/Madrid` | zona del día de cobros |

## Secrets de GitHub

Los cinco están cargados:

`SHOPIFY_CLIENT_ID` · `SHOPIFY_CLIENT_SECRET` · `META_ACCESS_TOKEN` ·
`ANTHROPIC_API_KEY` · `SLACK_WEBHOOK_URL`

`WINDSOR_API_KEY` sigue cargado pero **no se usa**: el código llama a las APIs
de Meta y Shopify directamente.

Shopify usa el grant `client_credentials` contra
`/admin/oauth/access_token` (apps del Dev Dashboard), no un token estático
`shpat_`.

## Cron externo (cron-job.org)

Un cronjob por tienda. Entre tiendas solo cambian la URL y la hora.

| Campo | Valor |
|---|---|
| Título | `Hair Biolabs ES reporte diario` |
| URL | `https://api.github.com/repos/diegordzsa/windsor-daily-report-hb/actions/workflows/daily-report.yml/dispatches` |
| Method | `POST` |
| Body | `{"ref":"main"}` |
| Schedule | Custom · Crontab: `0 9 * * *` |
| **Timezone** | **`Europe/Madrid`** |
| Aviso por email al fallar | Activado |

Headers:

```
Accept: application/vnd.github+json
Authorization: Bearer <PAT existente, el que ya tiene acceso a todos los repos>
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json
```

**La respuesta correcta es `204 No Content`.** `401` = token mal copiado ·
`403` = falta el permiso *Actions: Read and write* · `404` = errata en la URL.

**El timezone va en `Europe/Madrid`, no en UTC.** La cuenta de Meta y el lector
están en la misma zona y cambian de horario juntos, así que fijándolo en la zona
del lector las 09:00 locales (y las 9 h post-cierre) se mantienen todo el año.
En UTC habría que cambiarlo dos veces al año.

En el formulario de *Schedule*, **MINUTES tiene que quedar con un solo valor**.
Si se queda en *every*, dispara 120 veces al día. Las listas son multiselección:
`Ctrl`+clic, o escribir la expresión en *Crontab expression*.

Sin cron de GitHub no hay red de seguridad: si el cronjob externo falla, no sale
reporte. Por eso el aviso por email es obligatorio.

## Inventario multi-tienda

| Tienda | Repo | TZ cuenta Meta | Cierre UTC | Entrega | Moneda Shopify / Meta |
|---|---|---|---|---|---|
| Hair Biolabs ES | `diegordzsa/windsor-daily-report-hb` | `Europe/Madrid` | 22:00 (v) / 23:00 (i) | 09:00 Europe/Madrid | EUR / USD |
| Zendi MX | `diegordzsa/daily-report-zendi` | `America/Mexico_City` | 06:00 | 11:00 Europe/Madrid | MXN / EUR |

## Ejecución manual

```
gh workflow run daily-report.yml -R diegordzsa/windsor-daily-report-hb --ref main
```

Publica en Slack si el guard lo permite.

## Validar la autenticación del cronjob sin enviar reporte

`.github/workflows/dispatch-probe.yml` existe solo para eso: mismo token, misma
URL de dispatches, mismas cabeceras, pero no lee datos ni escribe en Slack (no
recibe ningún secret).

```
POST https://api.github.com/repos/diegordzsa/windsor-daily-report-hb/actions/workflows/dispatch-probe.yml/dispatches
```

Se apunta el cronjob ahí primero, se comprueba que devuelve `204` y que aparece
la ejecución en Actions, y solo entonces se cambia la URL a `daily-report.yml`.
Así se valida la autenticación sin mandar un reporte duplicado.
