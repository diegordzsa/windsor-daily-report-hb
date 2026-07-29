// TEMPORAL — Fase 1 de diagnostico. Solo lee y loguea. NUNCA escribe a Slack.
// Borrar al terminar la medicion.

const AD_ACCOUNT_ID = '2217973965310655';
const GRAPH_API_VERSION = 'v21.0';
const SHOPIFY_STORE = 'ex9fk2-1i.myshopify.com';
const SHOPIFY_API_VERSION = '2024-10';

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

console.log(`[Probe] Ejecutado en UTC: ${new Date().toISOString()}`);
console.log('');

// ---------- 1.1 Cuenta de Meta: zona horaria y moneda ----------
async function metaAccount() {
  const params = new URLSearchParams({
    access_token: META_ACCESS_TOKEN,
    fields: 'name,timezone_name,timezone_offset_hours_utc,currency,account_status,business_country_code',
  });
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${AD_ACCOUNT_ID}?${params}`;
  const res = await fetch(url);
  const json = await res.json();
  console.log('===== 1.1 META ACCOUNT =====');
  console.log(JSON.stringify(json, null, 2));
  console.log('');
  return json;
}

// ---------- 1.2 Shopify: zona horaria y moneda ----------
async function shopifyShop() {
  const tokRes = await fetch(`https://${SHOPIFY_STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  if (!tokRes.ok) {
    console.log('===== 1.2 SHOPIFY SHOP =====');
    console.log(`ERROR token: ${tokRes.status} ${await tokRes.text()}`);
    return null;
  }
  const { access_token } = await tokRes.json();

  const res = await fetch(
    `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/shop.json`,
    { headers: { 'X-Shopify-Access-Token': access_token } }
  );
  const json = await res.json();
  const s = json.shop || {};
  console.log('===== 1.2 SHOPIFY SHOP =====');
  console.log(JSON.stringify({
    name: s.name,
    domain: s.domain,
    myshopify_domain: s.myshopify_domain,
    iana_timezone: s.iana_timezone,
    timezone: s.timezone,
    currency: s.currency,
    money_format: s.money_format,
    money_with_currency_format: s.money_with_currency_format,
    country_code: s.country_code,
    primary_locale: s.primary_locale,
    weight_unit: s.weight_unit,
  }, null, 2));
  console.log('');
  return s;
}

// ---------- 1.4 Deriva de consolidacion: gasto consolidado ultimos 8 dias ----------
async function metaConsolidated(accountTz) {
  // Calcula "hoy" en la zona de la cuenta de Meta, no en UTC.
  const tz = accountTz || 'UTC';
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const todayInTz = fmt.format(new Date()); // YYYY-MM-DD
  const d = new Date(`${todayInTz}T00:00:00Z`);

  const until = new Date(d); until.setUTCDate(until.getUTCDate() - 1);
  const since = new Date(d); since.setUTCDate(since.getUTCDate() - 26);
  const iso = x => x.toISOString().slice(0, 10);

  console.log('===== 1.4 META CONSOLIDATED SPEND =====');
  console.log(`Zona de la cuenta: ${tz} | hoy en esa zona: ${todayInTz}`);
  console.log(`Rango: ${iso(since)} .. ${iso(until)}`);

  const params = new URLSearchParams({
    access_token: META_ACCESS_TOKEN,
    time_range: JSON.stringify({ since: iso(since), until: iso(until) }),
    time_increment: '1',
    level: 'account',
    fields: 'spend,impressions,clicks,account_currency',
  });
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${AD_ACCOUNT_ID}/insights?${params}`;
  const res = await fetch(url);
  const json = await res.json();

  if (json.error) {
    console.log(`ERROR: ${JSON.stringify(json.error)}`);
    return;
  }
  for (const row of json.data || []) {
    console.log(
      `CONSOLIDADO ${row.date_start} | spend=${row.spend} ${row.account_currency || ''} ` +
      `| impressions=${row.impressions} | clicks=${row.clicks}`
    );
  }
  console.log('');
}

// ---------- Extra: que devuelve date_preset=yesterday AHORA MISMO ----------
async function metaYesterdayNow() {
  const params = new URLSearchParams({
    access_token: META_ACCESS_TOKEN,
    date_preset: 'yesterday',
    level: 'account',
    fields: 'spend,impressions,clicks,account_currency',
  });
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${AD_ACCOUNT_ID}/insights?${params}`;
  const res = await fetch(url);
  const json = await res.json();
  console.log('===== EXTRA: date_preset=yesterday AHORA =====');
  console.log(JSON.stringify(json.data || json, null, 2));
  console.log('');
}

const acct = await metaAccount();
await shopifyShop();
await metaConsolidated(acct?.timezone_name);
await metaYesterdayNow();
