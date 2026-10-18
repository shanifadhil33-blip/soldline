import { loadMessages, type Language } from './i18n';

export type AuthErrorCode = 'Configuration' | 'AccessDenied' | 'Verification' | 'OAuthSignin' | 'OAuthCallback' | 'OAuthAccountNotLinked' | 'Default';
const codes: readonly AuthErrorCode[] = ['Configuration', 'AccessDenied', 'Verification', 'OAuthSignin', 'OAuthCallback', 'OAuthAccountNotLinked', 'Default'];

/** Maps any Auth.js error value to plain copy with one action. Unknown values get the default. */
export function authErrorCopy(value: string | string[] | undefined, locale: Language) {
  const raw = Array.isArray(value) ? value[0] : value;
  const code = codes.find(item => item === raw) ?? 'Default';
  const m = loadMessages(locale).errors;
  const action = code === 'Configuration' ? { label: loadMessages(locale).landing.demo, href: '/demo' } : { label: m.signIn, href: '/sign-in' };
  return { code, ...m.auth[code], action, home: { label: m.home, href: '/' } };
}

export function crashCopy(locale: Language) {
  const m = loadMessages(locale).errors;
  return { ...m.crash, retry: m.tryAgain, home: { label: m.home, href: '/' } };
}
