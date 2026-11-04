'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadMessages, type Language } from '../lib/i18n';
import { useToast } from './toast';

/** A specialist marks one of their tasks done. The client is then asked to review it. */
export function TaskDone({ id, title, locale }: { id: string; title: string; locale: Language }) {
  const m = loadMessages(locale).flow;
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function done() {
    setBusy(true);
    try {
      const response = await fetch(`/api/deliverables/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'review' }) });
      if (!response.ok) throw new Error();
      toast(m.today.doneToast.replace('{title}', title));
      router.refresh();
    } catch { toast(m.failed, true); } finally { setBusy(false); }
  }
  return <button type="button" className="button primary" disabled={busy} onClick={() => void done()}>{m.today.done}</button>;
}
