// TEMPORAL — verificacion del guard de frescura contra las APIs reales.
// Solo lee y loguea. NUNCA escribe a Slack. Borrar al terminar.

import { fetchMetaAccount } from '../../src/meta.js';
import { getAccessToken, fetchShopInfo } from '../../src/shopify.js';
import {
  yesterdayInTimezone, dayCloseInstant, hoursSinceClose,
} from '../../src/freshness.js';
import {
  META_ACCOUNT_TIMEZONE, MIN_HOURS_AFTER_CLOSE,
  META_CURRENCY, STORE_CURRENCY,
} from '../../src/config.js';

console.log(`[Probe] Ahora UTC: ${new Date().toISOString()}`);
console.log('');

// ---------- Cuenta de Meta ----------
const account = await fetchMetaAccount(process.env.META_ACCESS_TOKEN);
console.log(`  config META_CURRENCY=${META_CURRENCY} -> ${account.currency === META_CURRENCY ? 'COINCIDE' : 'DISCREPA'}`);
console.log(`  config META_ACCOUNT_TIMEZONE=${META_ACCOUNT_TIMEZONE} -> ${account.timezone === META_ACCOUNT_TIMEZONE ? 'COINCIDE' : 'DISCREPA'}`);
console.log('');

// ---------- Shopify ----------
const token = await getAccessToken(process.env.SHOPIFY_CLIENT_ID, process.env.SHOPIFY_CLIENT_SECRET);
const shop = await fetchShopInfo(token);
console.log(`  config STORE_CURRENCY=${STORE_CURRENCY} -> ${shop.currency === STORE_CURRENCY ? 'COINCIDE' : 'DISCREPA'}`);
console.log(`  Shopify tz vs Meta tz -> ${shop.timezone === account.timezone ? 'MISMA ZONA' : 'ZONAS DISTINTAS'}`);
console.log('');

// ---------- Decision del guard AHORA ----------
const tz = account.timezone || META_ACCOUNT_TIMEZONE;
const reportDate = yesterdayInTimezone(tz);
const close = dayCloseInstant(reportDate, tz);
const elapsed = hoursSinceClose(reportDate, tz);

console.log('===== DECISION DEL GUARD (ahora) =====');
console.log(`  dia del reporte : ${reportDate} (${tz})`);
console.log(`  cierre del dia  : ${close.toISOString()}`);
console.log(`  h post-cierre   : ${elapsed.toFixed(2)}  (minimo ${MIN_HOURS_AFTER_CLOSE})`);
console.log(`  veredicto       : ${elapsed < MIN_HOURS_AFTER_CLOSE ? 'BLOQUEA (exit 1)' : 'PUBLICA'}`);
console.log('');

// ---------- Decision del guard a la hora de entrega, todo el anio ----------
console.log('===== DECISION DEL GUARD A LAS 09:00 Europe/Madrid =====');
for (const [etiqueta, iso] of [
  ['verano  (28-jul)', '2026-07-29T07:00:00Z'],
  ['invierno (15-ene)', '2026-01-16T08:00:00Z'],
  ['salto primavera (29-mar)', '2026-03-30T07:00:00Z'],
  ['salto otonio (25-oct)', '2026-10-26T08:00:00Z'],
]) {
  const at = new Date(iso);
  const d = yesterdayInTimezone(tz, at);
  const h = hoursSinceClose(d, tz, at);
  console.log(`  ${etiqueta.padEnd(26)} dia=${d}  h=${h.toFixed(2)}  ${h < MIN_HOURS_AFTER_CLOSE ? 'BLOQUEA' : 'PUBLICA'}`);
}
console.log('');

// ---------- Deriva: reportado a 9 h frente a consolidado ----------
console.log('===== CONSOLIDADO ULTIMOS 10 DIAS =====');
const params = new URLSearchParams({
  access_token: process.env.META_ACCESS_TOKEN,
  time_range: JSON.stringify({
    since: yesterdayInTimezone(tz, new Date(Date.now() - 9 * 86400000)),
    until: reportDate,
  }),
  time_increment: '1',
  level: 'account',
  fields: 'spend,impressions,clicks,account_currency',
});
const res = await fetch(`https://graph.facebook.com/v21.0/act_2217973965310655/insights?${params}`);
const json = await res.json();
for (const row of json.data || []) {
  console.log(`  CONSOLIDADO ${row.date_start} | spend=${row.spend} ${row.account_currency}`);
}
