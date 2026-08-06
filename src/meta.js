import { META_AD_ACCOUNTS, GRAPH_API_VERSION } from './config.js';

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
export async function fetchMetaAccount(accessToken, accountId) {
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: 'name,timezone_name,timezone_offset_hours_utc,currency',
  });
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${accountId}?${params}`;

  const res = await fetch(url);
  const json = await res.json();

  if (!res.ok || json.error) {
    throw new Error(
      `Meta account API error en act_${accountId}: ${res.status} — ${json.error?.message ?? 'sin detalle'}`
    );
  }

  console.log(
    `[Meta] Cuenta ${json.name} (act_${accountId}) | timezone_name=${json.timezone_name} ` +
    `(UTC${json.timezone_offset_hours_utc >= 0 ? '+' : ''}${json.timezone_offset_hours_utc}) ` +
    `| currency=${json.currency}`
  );

  return {
    id: accountId,
    name: json.name,
    timezone: json.timezone_name,
    offsetHours: json.timezone_offset_hours_utc,
    currency: json.currency,
  };
}

// Todas las cuentas configuradas. Si una falla, falla la lectura entera: con un
// gasto parcial el reporte saldria con ROAS y MER inflados.
export async function fetchAllMetaAccounts(accessToken) {
  return Promise.all(META_AD_ACCOUNTS.map(id => fetchMetaAccount(accessToken, id)));
}

// Filas de todas las cuentas, concatenadas. Cada fila lleva su accountId, que es
// lo que permite desglosar el gasto sin volver a pedir nada.
export async function fetchAllMetaAds(accessToken, reportDate) {
  const perAccount = await Promise.all(
    META_AD_ACCOUNTS.map(id => fetchMetaAds(accessToken, id, reportDate))
  );
  return perAccount.flat();
}

export async function fetchMetaAds(accessToken, accountId, reportDate) {
  const fields = 'spend,impressions,clicks,actions,action_values,cpc,cpm,ctr,frequency,account_currency';
  const params = new URLSearchParams({
    access_token: accessToken,
    time_range: JSON.stringify({ since: reportDate, until: reportDate }),
    time_increment: '1',
    level: 'account',
    fields,
  });

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${accountId}/insights?${params}`;

  console.log(`[Meta] Fetching ad insights for ${reportDate} (act_${accountId})...`);
  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Meta API error en act_${accountId}: ${res.status} ${res.statusText} — ${body.substring(0, 200)}`
    );
  }

  const json = await res.json();

  if (json.error) {
    throw new Error(`Meta API error en act_${accountId}: ${json.error.message}`);
  }

  const data = json.data || [];
  console.log(`[Meta] Got ${data.length} rows (act_${accountId})`);
  for (const row of data) {
    // Linea de auditoria: permite cruzar lo reportado contra el consolidado.
    // Lleva el id porque es la unica traza historica de gasto que existe y sin
    // el las cuentas serian indistinguibles en el log.
    console.log(
      `[Meta] Raw spend for ${row.date_start} (act_${accountId}): ${row.spend} ${row.account_currency || ''}`
    );
  }

  if (data.length === 0) return [];

  return data.map(row => ({
    accountId,
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
