import NextAuth, { type NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import { cookies } from 'next/headers';
import { getOwnerServices } from './server/db/runtime';
import { cookieName } from './server/demo/cookie';
export async function clearDemoOnSignIn() {
  const jar = await cookies();
  jar.set(cookieName, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 });
}
export function authConfig(): NextAuthConfig {
  return {
    adapter: getOwnerServices().authAdapter,
    session: { strategy: 'database' },
    providers: [Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET, authorization: { params: { prompt: 'select_account' } } })],
    pages: { signIn: '/sign-in', error: '/auth/error' },
    events: { signIn: clearDemoOnSignIn },
  };
}
export const { handlers, auth, signIn, signOut } = NextAuth(() => authConfig());
