import { expect, it } from 'vitest';
import { authErrorCopy, crashCopy } from '../src/lib/error-copy';
const hasDash = (text: string) => / - |\u2013|\u2014/.test(text);

it('Maps every Auth.js error code to a plain title, sentence and one action', () => {
  for (const code of ['Configuration', 'AccessDenied', 'Verification', 'OAuthSignin', 'OAuthCallback', 'OAuthAccountNotLinked', 'Default']) {
    for (const locale of ['en', 'ar'] as const) {
      const copy = authErrorCopy(code, locale);
      expect(copy.code).toBe(code); expect(copy.title).toBeTruthy(); expect(copy.body).toBeTruthy(); expect(copy.action.href).toMatch(/^\/(sign-in|demo)$/);
      expect(hasDash(copy.title + copy.body)).toBe(false);
    }
  }
});

it('Falls back to the default copy for unknown or missing codes', () => {
  expect(authErrorCopy('<script>', 'en').code).toBe('Default');
  expect(authErrorCopy(undefined, 'en').code).toBe('Default');
  expect(authErrorCopy(['AccessDenied', 'x'], 'en').code).toBe('AccessDenied');
  expect(authErrorCopy('Configuration', 'en').action.href).toBe('/demo');
});

it('Gives the crash page a retry and a way home', () => {
  const copy = crashCopy('en');
  expect(copy.title).toBe('Something went wrong'); expect(copy.retry).toBe('Try again'); expect(copy.home.href).toBe('/');
});
