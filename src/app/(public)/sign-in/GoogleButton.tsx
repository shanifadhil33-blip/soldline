'use client';
import { signIn } from 'next-auth/react';
export function GoogleButton() {
  return <button className="mt-6 rounded-sm bg-accent px-4 py-3 text-accent-ink" type="button" onClick={() => signIn('google', { redirectTo: '/' })}>Sign in with Google</button>;
}
