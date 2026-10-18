import { NextRequest, NextResponse } from 'next/server';
import { language } from './lib/i18n';

export function proxy(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get('lang');
  const locale = language(requested ?? request.cookies.get('soldline_language')?.value);
  const headers = new Headers(request.headers);
  headers.set('x-soldline-language', locale);
  const response = NextResponse.next({ request: { headers } });
  if (requested === 'en' || requested === 'ar') response.cookies.set('soldline_language', locale, { path: '/', sameSite: 'lax', maxAge: 31536000 });
  return response;
}
export const config = { matcher: ['/((?!api|_next|favicon.ico).*)'] };
