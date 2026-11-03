'use client';
import { useEffect, useState } from 'react';
import { loadMessages, type Language } from '../lib/i18n';
import { capitalise, clockFace } from '../lib/plain';
import { Select } from './select';

type Personal = { preferredName?: string; language?: 'en' | 'ar'; digestTime?: string; agentName?: string };

function savedLanguage(value: string | undefined, locale: Language): 'en' | 'ar' {
  return value === 'ar' || value === 'en' ? value : locale;
}
function tidy(body: Personal, locale: Language, fallbackTime = '09:00'): Personal {
  return { ...body, preferredName: capitalise(body.preferredName), language: savedLanguage(body.language, locale), digestTime: clockFace(body.digestTime) ?? fallbackTime };
}

export function SettingsForm({ locale, initial = null }: { locale: Language; initial?: Personal | null }) {
  const m = loadMessages(locale).preferences;
  const common = loadMessages(locale).screens;
  const [form, setForm] = useState<Personal>(tidy(initial ?? {}, locale));
  const [saved, setSaved] = useState<Personal>(form);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void fetch('/api/settings', { cache: 'no-store' }).then(async response => {
      if (!response.ok) return;
      const body = tidy(await response.json() as Personal, locale);
      setForm(body); setSaved(body);
    }).catch(() => setError(true));
  }, [locale]);
  const changed = JSON.stringify(form) !== JSON.stringify(saved);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!changed || busy) return;
    setError(false); setBusy(true);
    const clean = { ...form, preferredName: capitalise(form.preferredName) };
    const payload = Object.fromEntries(Object.entries(clean).filter(([, value]) => value !== '' && value != null));
    try {
      const response = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (response.ok) {
        const body = tidy(await response.json() as Personal, locale, form.digestTime);
        setForm(body); setSaved(body);
        if (body.language === 'en' || body.language === 'ar') document.cookie = `soldline_language=${body.language};path=/;max-age=31536000;samesite=lax`;
        setStatus(m.saved);
        if (body.language && body.language !== locale) location.reload();
      } else { setStatus(''); setError(true); }
    } catch { setStatus(''); setError(true); } finally { setBusy(false); }
  }
  return <div className="screen">
    <form className="settings-card" onSubmit={event => void save(event)}>
      <label>{m.name}<input value={form.preferredName ?? ''} autoComplete="given-name" onChange={event => { setStatus(''); setForm({ ...form, preferredName: event.target.value }); }} onBlur={() => setForm(current => ({ ...current, preferredName: capitalise(current.preferredName) }))} /></label>
      <div className="field"><span id="language-label">{m.language}</span><Select label={m.language} value={form.language ?? 'en'} options={[{ value: 'en', label: m.english }, { value: 'ar', label: m.arabic }]} onChange={value => { setStatus(''); setForm({ ...form, language: value as 'en' | 'ar' }); }} /></div>
      <label>{m.digest}<input value={form.digestTime ?? ''} inputMode="numeric" onChange={event => { setStatus(''); setForm({ ...form, digestTime: event.target.value }); }} /></label>
      <label>{m.replyName}<input value={form.agentName ?? ''} onChange={event => { setStatus(''); setForm({ ...form, agentName: event.target.value }); }} /></label>
      <button className="button primary" disabled={!changed || busy}>{m.save}</button>
    </form>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{common.error}</p>}
  </div>;
}
