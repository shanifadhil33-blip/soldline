'use client';
import { crashCopy } from '../lib/error-copy';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const copy = crashCopy('en');
  return <html lang="en"><body>
    <main style={{ maxWidth: 420, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif', fontSize: 16, lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600 }}>{copy.title}</h1>
      <p>{copy.body}</p>
      <button type="button" onClick={() => reset()} style={{ minHeight: 44, padding: '0 16px', fontSize: 16 }}>{copy.retry}</button>
      <p><a href={copy.home.href}>{copy.home.label}</a></p>
    </main>
  </body></html>;
}
