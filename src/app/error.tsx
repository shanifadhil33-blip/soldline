'use client';
import { crashCopy } from '../lib/error-copy';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const locale = typeof document !== 'undefined' && document.documentElement.lang === 'ar' ? 'ar' : 'en';
  const copy = crashCopy(locale);
  return <main className="mx-auto max-w-sm p-6" id="content">
    <h1 className="text-2xl font-semibold">{copy.title}</h1>
    <p className="mt-4">{copy.body}</p>
    <button type="button" className="button primary mt-6" onClick={() => reset()}>{copy.retry}</button>
    <a className="mt-4 block underline" href={copy.home.href}>{copy.home.label}</a>
  </main>;
}
