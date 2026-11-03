'use client';
import { useEffect, useState } from 'react';
import { loadMessages, type Language } from '../lib/i18n';
import { clockFace } from '../lib/plain';

type Personal = { preferredName?: string; language?: 'en' | 'ar'; digestTime?: string; agentName?: string };

export function SettingsForm({ locale }: { locale: Language }) {
  const m = loadMessages(locale).preferences;
  const common = loadMessages(locale).screens;
  const [form, setForm] = useState<Personal>({ language: locale, digestTime: '08:00' });
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    void fetch('/api/settings', { cache: 'no-store' }).then(async response => {
      if (!response.ok) return;
      const body = await response.json() as Personal;
      setForm(current => ({ ...current, ...body, language: locale, digestTime: clockFace(body.digestTime) ?? current.digestTime }));
    }).catch(() => setError(true));
  }, [locale]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(false);
    const payload = Object.fromEntries(Object.entries(form).filter(([, value]) => value !== '' && value != null));
    const response = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    setStatus(response.ok ? m.saved : '');
    setError(!response.ok);
  }
  async function sendNote(event: React.FormEvent) {
    event.preventDefault();
    setError(false);
    const response = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: note, pagePath: '/settings' }) });
    if (response.ok) { setNote(''); setStatus(m.saved); } else setError(true);
  }
  return <div className="screen">
    <form className="settings-card" onSubmit={event => void save(event)}>
      <label>{m.name}<input value={form.preferredName ?? ''} onChange={event => setForm({ ...form, preferredName: event.target.value })} /></label>
      <label>{m.language}<select value={form.language ?? 'en'} onChange={event => setForm({ ...form, language: event.target.value as 'en' | 'ar' })}><option value="en">{m.english}</option><option value="ar">{m.arabic}</option></select></label>
      <label>{m.digest}<input value={form.digestTime ?? ''} onChange={event => setForm({ ...form, digestTime: event.target.value })} /></label>
      <label>{m.replyName}<input value={form.agentName ?? ''} onChange={event => setForm({ ...form, agentName: event.target.value })} /></label>
      <button className="button primary">{m.save}</button>
    </form>
    <form className="settings-card" onSubmit={event => void sendNote(event)}>
      <h2>{m.feedback}</h2>
      <label>{m.feedbackHint}<textarea value={note} maxLength={2000} onChange={event => setNote(event.target.value)} /></label>
      <button className="button" disabled={!note.trim()}>{m.feedbackSend}</button>
    </form>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{common.error}</p>}
  </div>;
}
