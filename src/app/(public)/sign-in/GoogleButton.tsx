'use client';
import { signIn } from 'next-auth/react';
export function GoogleButton() {
  return <button className="button primary" type="button" onClick={() => signIn('google', { redirectTo: '/' })}>Sign in with Google</button>;
}
