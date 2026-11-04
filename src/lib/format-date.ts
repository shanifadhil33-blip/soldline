import type { Language } from './i18n';

export const displayTimeZone = 'Asia/Dubai';

/** Deterministic date formatting: fixed time zone and Latin digits, identical on server and client. */
export function formatDate(value: string | number | Date, locale: Language, style: 'day' | 'short' | 'medium' = 'day'): string {
  const options: Intl.DateTimeFormatOptions = style === 'day' ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: style };
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { ...options, timeZone: displayTimeZone }).format(new Date(value));
}
