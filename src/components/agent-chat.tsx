'use client';
import { useEffect, useRef, useState } from 'react';
import { loadMessages, type Language } from '../lib/i18n';

type Row = { label: string; count: number };
type Card = { id: string; label: string; choices: { yes: string; change: string } };
type Message = { id: number; from: 'you' | 'agent'; text: string; rows?: Row[]; card?: Card; decided?: string };

/** Agent chat. A side panel on a laptop and a full screen sheet on a phone. Typing, Stop and Close always work. */
export function AgentChat({ locale, open, onClose, firstName }: { locale: Language; open: boolean; onClose: () => void; firstName: string }) {
  const m = loadMessages(locale).screens;
  const c = loadMessages(locale).agentChat;
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const thread = useRef<string | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);
  const counter = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const next = () => ++counter.current;
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [messages, busy]);
  useEffect(() => { if (!open) return; const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key); }, [open, onClose]);
  useEffect(() => () => abort.current?.abort(), []);
  function stop() { abort.current?.abort(); abort.current = null; setBusy(false); }
  function close() { stop(); onClose(); }
  async function send(question: string) {
    const message = question.trim();
    if (!message || busy) return;
    setText('');
    setMessages(list => [...list, { id: next(), from: 'you', text: message }]);
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    const limit = setTimeout(() => controller.abort(), 48000);
    try {
      const response = await fetch('/api/agent/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ message, language: locale, threadId: thread.current }) });
      if (!response.ok) throw new Error();
      const body = await response.json() as { threadId?: string; agentName?: string; intro?: string; rows?: Row[]; card?: Card | null };
      thread.current = body.threadId ?? thread.current;
      if (body.agentName) setName(body.agentName);
      setMessages(list => [...list, { id: next(), from: 'agent', text: body.intro ?? '', rows: Array.isArray(body.rows) ? body.rows.filter(row => row.count > 0) : [], card: body.card ?? undefined }]);
    } catch {
      if (!controller.signal.aborted || abort.current === controller) setMessages(list => [...list, { id: next(), from: 'agent', text: m.error }]);
    } finally {
      clearTimeout(limit);
      if (abort.current === controller) { abort.current = null; setBusy(false); }
    }
  }
  async function decide(id: number, card: Card, choice: 'yes' | 'change') {
    setMessages(list => list.map(item => item.id === id ? { ...item, decided: choice } : item));
    try {
      const response = await fetch(`/api/agent/cards/${card.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice }) });
      if (!response.ok) throw new Error();
      setMessages(list => [...list, { id: next(), from: 'agent', text: choice === 'yes' ? c.done : c.changed }]);
    } catch {
      setMessages(list => [...list.map(item => item.id === id ? { ...item, decided: undefined } : item), { id: next(), from: 'agent', text: m.error }]);
    }
  }
  return <aside className="agent" data-open={open ? 'true' : undefined} aria-label={m.agent} role={open ? 'dialog' : undefined}>
    <header className="agent-head"><strong>{name || m.agent}</strong><button type="button" className="icon-button agent-close" onClick={close} aria-label={c.close}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button></header>
    <div className="agent-log" aria-live="polite">
      <p className="agent-bubble" data-from="agent">{c.hello.replace('{name}', firstName)}</p>
      {messages.map(message => <div className="agent-bubble" data-from={message.from} key={message.id}>
        <p>{message.text}</p>
        {message.rows && message.rows.length > 0 && <ul>{message.rows.map(row => <li key={row.label}><span>{row.label}</span><bdi>{row.count}</bdi></li>)}</ul>}
        {message.card && <div className="agent-card"><strong>{message.card.label}</strong><div className="agent-choices"><button type="button" className="button primary" disabled={!!message.decided} onClick={() => void decide(message.id, message.card!, 'yes')}>{message.card.choices.yes || m.yes}</button><button type="button" className="button" disabled={!!message.decided} onClick={() => void decide(message.id, message.card!, 'change')}>{message.card.choices.change}</button></div></div>}
      </div>)}
      {busy && <p className="agent-bubble agent-typing" data-from="agent" role="status"><span className="dots" aria-hidden="true"><i /><i /><i /></span><span className="visually-hidden">{c.typing}</span></p>}
      <div ref={end} />
    </div>
    {messages.length === 0 && <div className="agent-quick">{c.quick.map(question => <button type="button" className="chip-button" key={question} onClick={() => void send(question)}>{question}</button>)}</div>}
    <form className="agent-compose" onSubmit={event => { event.preventDefault(); void send(text); }}>
      <textarea value={text} rows={1} maxLength={2000} placeholder={c.placeholder} aria-label={m.askHint} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(text); } }} />
      {busy
        ? <button type="button" className="icon-button send stop" onClick={stop} aria-label={c.stop}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /></svg></button>
        : <button type="submit" className="icon-button send" disabled={!text.trim()} aria-label={m.askSend}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6.5 11.5L12 6l5.5 5.5" /></svg></button>}
    </form>
  </aside>;
}
