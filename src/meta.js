import { META_AD_ACCOUNT_ID, GRAPH_API_VERSION } from './config.js';

const ACTION_MAP = {
  'link_click': 'actions_link_click',
  'offsite_conversion.fb_pixel_add_to_cart': 'actions_offsite_conversion_fb_pixel_add_to_cart',
  'offsite_conversion.fb_pixel_initiate_checkout': 'actions_offsite_conversion_fb_pixel_initiate_checkout',
  'offsite_conversion.fb_pixel_purchase': 'actions_offsite_conversion_fb_pixel_purchase',
};

const ACTION_VALUE_MAP = {
  'offsite_conversion.fb_pixel_purchase': 'action_values_offsite_conversion_fb_pixel_purchase',
};

function extractActions(actionsArray, map) {
  const result = {};
  for (const key of Object.values(map)) {
    result[key] = 0;
  }
  if (!Array.isArray(actionsArray)) return result;

  for (const entry of actionsArray) {
    const mapped = map[entry.action_type];
    if (mapped) {
      result[mapped] = parseFloat(entry.value) || 0;
    }
  }
  return result;
}

// Zona horaria y moneda de la cuenta. La zona gobierna cuando cierra el dia,
// asi que se lee en cada ejecucion en vez de confiar en la config.
export async function fetchMetaAccount(accessToken) {
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: 'name,timezone_name,timezone_offset_hours_utc,currency',
  });
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${META_AD_ACCOUNT_ID}?${params}`;

  const res = await fetch(url);
  const json = await res.json();

  if (!res.ok || json.error) {
    throw new Error(`Meta account API error: ${res.status} — ${json.error?.message ?? 'sin detalle'}`);
  }

  console.log(
    `[Meta] Cuenta ${json.name} | timezone_name=${json.timezone_name} ` +
    `(UTC${json.timezone_offset_hours_utc >= 0 ? '+' : ''}${json.timezone_offset_hours_utc}) ` +
    `| currency=${json.currency}`
  );

  return {
    name: json.name,
    timezone: json.timezone_name,
    offsetHours: json.timezone_offset_hours_utc,
    currency: json.currency,
  };
}

export async function fetchMetaAds(accessToken, reportDate) {
  const fields = 'spend,impressions,clicks,actions,action_values,cpc,cpm,ctr,frequency,account_currency';
  const params = new URLSearchParams({
    access_token: accessToken,
    time_range: JSON.stringify({ since: reportDate, until: reportDate }),
    time_increment: '1',
    level: 'account',
    fields,
  });

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${META_AD_ACCOUNT_ID}/insights?${params}`;

  console.log(`[Meta] Fetching ad insights for ${reportDate}...`);
  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Meta API error: ${res.status} ${res.statusText} — ${body.substring(0, 200)}`);
  }

  const json = await res.json();

  if (json.error) {
    throw new Error(`Meta API error: ${json.error.message}`);
  }

  const data = json.data || [];
  console.log(`[Meta] Got ${data.length} rows`);
  for (const row of data) {
    // Linea de auditoria: permite cruzar lo reportado contra el consolidado.
    console.log(`[Meta] Raw spend for ${row.date_start}: ${row.spend} ${row.account_currency || ''}`);
  }

  if (data.length === 0) return [];

  return data.map(row => ({
    date: row.date_start,
    spend: parseFloat(row.spend) || 0,
    impressions: parseInt(row.impressions) || 0,
    clicks: parseInt(row.clicks) || 0,
    cpc: parseFloat(row.cpc) || 0,
    cpm: parseFloat(row.cpm) || 0,
    ctr: parseFloat(row.ctr) || 0,
    frequency: parseFloat(row.frequency) || 0,
    ...extractActions(row.actions, ACTION_MAP),
    ...extractActions(row.action_values, ACTION_VALUE_MAP),
  }));
}
