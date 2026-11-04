'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadMessages, formatNumber, type Language } from '../lib/i18n';
import { noteText } from '../lib/plain';
import { formatDate } from '../lib/format-date';

type Note = { id: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

/** The bell: how many things are new, the list when opened, and everything is marked as read once seen. */
export function NotificationBell({ locale }: { locale: Language }) {
  const m = loadMessages(locale).flow.bell;
  const [notes, setNotes] = useState<Note[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications', { cache: 'no-store' });
      if (!response.ok) return;
      const body = await response.json() as { notifications: Note[]; unread: number };
      setNotes(body.notifications.slice(0, 12)); setUnread(body.unread);
    } catch { /* The bell stays as it was. */ }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 20000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [load]);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    function key(event: KeyboardEvent) { if (event.key === 'Escape') setOpen(false); }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); };
  }, [open]);
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      await load();
      if (unread > 0) {
        await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) }).catch(() => undefined);
        setUnread(0);
      }
    }
  }
  const day = (value: string) => formatDate(value, locale, 'short');
  return <div className="bell" ref={root}>
    <button type="button" className="bell-button" aria-haspopup="dialog" aria-expanded={open} aria-label={unread > 0 ? m.labelNew.replace('{n}', String(unread)) : m.label} onClick={() => void toggle()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17h12l-1.5-2v-4a4.5 4.5 0 00-9 0v4zM10 20h4" /></svg>
      {unread > 0 && <span className="bell-count">{formatNumber(unread, locale)}</span>}
    </button>
    {open && <div className="bell-panel" role="dialog" aria-label={m.label}>
      <h2>{m.title}</h2>
      {notes.length === 0 ? <p className="muted" style={{ padding: '8px 12px' }}>{m.empty}</p> : <ul>{notes.map(note => <li key={note.id} data-unread={note.read_at ? undefined : 'true'}>
        <Link href={note.link ?? '/today'} prefetch={false} onClick={() => setOpen(false)}><strong>{noteText(note.body, locale)}</strong><span className="muted">{day(note.created_at)}</span></Link>
      </li>)}</ul>}
    </div>}
  </div>;
}
