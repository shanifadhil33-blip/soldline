'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadMessages, type Language } from '../lib/i18n';
import { startDemo } from '../lib/demo-personas';

export function OpenDemo({ locale }: { locale: Language }) {
  const m = loadMessages(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function open() {
    setBusy(true);
    setError(false);
    try {
      await startDemo('imran');
      router.refresh();
      router.push('/welcome');
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return <div className="open-demo">
    <button className="button primary" disabled={busy} onClick={() => void open()}>{m.landing.openDemo}</button>
    <p className="muted">{error ? m.shell.error : m.landing.openHint}</p>
  </div>;
}
