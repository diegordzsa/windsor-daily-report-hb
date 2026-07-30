// Configuracion por tienda. Los valores de zona horaria y moneda estan MEDIDOS
// contra las APIs de Meta y Shopify (ver SETUP.md), no copiados de otro repo.
//
//   Cuenta Meta  HAIR_BIO_01  timezone_name=Europe/Madrid  currency=USD
//   Shopify      Hair Biolabs iana_timezone=Europe/Madrid  currency=EUR

export const STORE_NAME = 'Hair Biolabs ES';

export const SHOPIFY_STORE = 'ex9fk2-1i.myshopify.com';
export const SHOPIFY_API_VERSION = '2024-10';

export const META_AD_ACCOUNT_ID = '2217973965310655';
export const GRAPH_API_VERSION = 'v21.0';

// Moneda en la que Shopify factura. Meta gasta en otra: no son intercambiables.
export const STORE_CURRENCY = process.env.STORE_CURRENCY || 'EUR';
export const META_CURRENCY = process.env.META_CURRENCY || 'USD';

export const STORE_LOCALE = process.env.STORE_LOCALE || 'es-ES';

// Zona horaria de la cuenta de Meta: gobierna cuando cierra el dia y por tanto
// cuando puede existir un reporte fiable. Es solo el fallback — report.js lee
// timezone_name de la API en cada ejecucion.
export const META_ACCOUNT_TIMEZONE = process.env.META_ACCOUNT_TIMEZONE || 'Europe/Madrid';

// Horas minimas tras el cierre del dia antes de publicar. Por debajo de esto el
// gasto de Meta no esta consolidado y el reporte NO sale.
export const MIN_HOURS_AFTER_CLOSE = Number(process.env.MIN_HOURS_AFTER_CLOSE ?? 3);

// Hora real de envio, para el pie del reporte. Que diga la verdad.
export const REPORT_TIME_LABEL = process.env.REPORT_TIME_LABEL || '09:00 Europe/Madrid';
export const REPORT_TIMEZONE = process.env.REPORT_TIMEZONE || 'Europe/Madrid';
