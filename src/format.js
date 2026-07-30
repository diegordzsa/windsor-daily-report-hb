// Formateo de dinero y numeros. Ningun simbolo de moneda escrito a mano en el
// resto del codigo: todo pasa por aqui con su codigo de moneda explicito.

import { STORE_LOCALE } from './config.js';

const SYMBOLS = {
  EUR: '€',
  USD: 'US$',
  MXN: 'MX$',
  GBP: '£',
};

export function money(n, currency, locale = STORE_LOCALE) {
  const amount = Number(n || 0).toLocaleString(locale, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  return `${symbol}${amount}`;
}

export function int(n, locale = STORE_LOCALE) {
  return Number(n || 0).toLocaleString(locale);
}

// Decimal en la convencion del locale: en es-ES es coma, igual que el dinero.
export function num(n, digits = 2, locale = STORE_LOCALE) {
  return Number(n || 0).toLocaleString(locale, {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

export function pct(n, digits = 1, locale = STORE_LOCALE) {
  return `${num(n, digits, locale)}%`;
}

export function ratio(n, digits = 2, locale = STORE_LOCALE) {
  return `${num(n, digits, locale)}x`;
}
