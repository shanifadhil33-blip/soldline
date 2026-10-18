import en from '../../messages/en.json';
import ar from '../../messages/ar.json';

export type Language = 'en' | 'ar';
export type Messages = typeof en;
export function language(value?: string): Language { return value === 'ar' ? 'ar' : 'en'; }
export function loadMessages(locale: Language): Messages { return locale === 'ar' ? ar : en; }
export function asciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) - (digit <= '٩' ? 0x660 : 0x6f0)));
}
export function formatNumber(value: number, locale: Language, options?: Intl.NumberFormatOptions): string {
  return asciiDigits(new Intl.NumberFormat(`${locale}-u-nu-latn`, options).format(value));
}
