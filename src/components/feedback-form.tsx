'use client';
import { useState } from 'react';
import { loadMessages, type Language } from '../lib/i18n';

export function FeedbackForm({ locale }: { locale: Language }) {
  const m = loadMessages(locale).preferences;
  const common = loadMessages(locale).screens;
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!note.trim() || busy) return;
    setError(false); setBusy(true);
    try {
      const response = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: note, pagePath: '/feedback' }) });
      if (response.ok) { setNote(''); setStatus(m.feedbackThanks); } else { setStatus(''); setError(true); }
    } catch { setStatus(''); setError(true); } finally { setBusy(false); }
  }
  return <form className="settings-card" onSubmit={event => void send(event)}>
    <label>{m.feedbackHint}<textarea value={note} maxLength={2000} rows={5} onChange={event => { setStatus(''); setNote(event.target.value); }} /></label>
    <button className="button primary" disabled={!note.trim() || busy}>{m.feedbackSend}</button>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{common.error}</p>}
  </form>;
}
