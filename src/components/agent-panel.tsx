'use client';
import { useState } from 'react';
import { loadMessages, type Language } from '../lib/i18n';

export function AgentPanel({ locale }: { locale: Language }) {
  const m = loadMessages(locale).screens;
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState('');
  const [rows, setRows] = useState<{ label: string; count: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch('/api/agent/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text.trim() }) });
      if (!response.ok) throw new Error();
      const body = await response.json() as { intro?: string; rows?: { label: string; count: number }[] };
      setAnswer(body.intro ?? '');
      setRows(Array.isArray(body.rows) ? body.rows : []);
      setText('');
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return <form className="agent-panel" onSubmit={event => void ask(event)}>
    <h2>{m.ask}</h2>
    <label>{m.askHint}<textarea value={text} maxLength={2000} onChange={event => setText(event.target.value)} /></label>
    <button className="button primary" disabled={busy || !text.trim()}>{m.askSend}</button>
    {error && <p role="alert">{m.error}</p>}
    {answer && <p role="status">{answer}</p>}
    {rows.length > 0 && <ul>{rows.map(row => <li key={row.label}>{row.label}: {row.count}</li>)}</ul>}
  </form>;
}
