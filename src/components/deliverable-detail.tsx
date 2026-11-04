'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadMessages, type Language } from '../lib/i18n';
import { demoPhrase, personName, statusWord } from '../lib/plain';
import { useToast } from './toast';
import { formatDate } from '../lib/format-date';

export type DeliverableData = {
  id: string; run_id: string; title: string | null; status: string; due: string | null; project: string; client: string;
  quantity: number | null; cadence: string | null; page: number | null; quote: string | null; makers: string[];
  rounds: { id: string; asked_by: string | null; note: string | null; asked_at: string; fixed_note: string | null; status: string; fixed_at: string | null }[];
  again: boolean; canDecide: boolean; isClient: boolean;
};

/** One piece of work: what was made, who made it, what happened so far, and the client's two choices. */
export function DeliverableDetail({ data, locale }: { data: DeliverableData; locale: Language }) {
  const m = loadMessages(locale).flow.deliverable;
  const router = useRouter();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const title = demoPhrase(data.title ?? '', locale) || m.untitled;
  const day = (value: string) => formatDate(value, locale);
  const state = data.status.toLowerCase();
  const stateText = state === 'approved' ? m.stateApproved : state === 'client review' ? (data.again ? m.readyAgain : m.ready) : state === 'changes requested' ? m.stateChanges : state === 'complete' ? m.stateApproved : statusWord(data.status, locale);
  const cadence = data.cadence === 'monthly' ? m.monthly : data.cadence === 'weekly' ? m.weekly : m.once;
  async function send(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch(`/api/deliverables/${encodeURIComponent(data.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error();
      toast((body.action === 'changes' ? m.changesToast : m.approvedToast).replace('{title}', title));
      setAsking(false); setNote('');
      router.refresh();
    } catch { toast(m.failed, true); } finally { setBusy(false); }
  }
  function submitNote(event: React.FormEvent) {
    event.preventDefault();
    if (!note.trim()) { setInvalid(true); return; }
    void send({ action: 'changes', note });
  }
  const waiting = !data.isClient && state === 'client review';
  return <section className="screen deliverable">
    <p><Link href={data.isClient ? '/home' : '/today'}>{data.isClient ? m.backClient : m.backStaff}</Link></p>
    <div className="page-head"><h1>{title}</h1><span className="status-chip">{stateText}</span></div>
    <p className="muted">{demoPhrase(data.client, locale)}{data.due ? `, ${m.due.replace('{date}', day(data.due))}` : ''}</p>
    <div className="deliverable-grid">
      <div className="run-lead">
        <section className="preview-card" aria-label={m.preview}>
          <h2>{m.whatWasMade}</h2>
          <div className="preview-sheet"><div><strong>{title}</strong><p className="muted">{m.amount.replace('{n}', String(data.quantity ?? 1)).replace('{cadence}', cadence)}</p></div></div>
          <dl>
            <div><dt>{m.project}</dt><dd>{demoPhrase(data.project, locale)}</dd></div>
            {data.makers.length > 0 && <div><dt>{m.madeBy}</dt><dd>{data.makers.map(name => personName(name, locale)).join(', ')}</dd></div>}
            {data.quote && <div><dt>{m.agreed}</dt><dd>{demoPhrase(data.quote, locale)}</dd></div>}
          </dl>
        </section>
        {data.rounds.length > 0 && <section><h2>{m.history}</h2>
          <ul className="rounds">{data.rounds.map(round => <li key={round.id}>
            <strong>{m.asked.replace('{name}', personName(round.asked_by ?? '', locale))}</strong>
            <span>{round.note}</span><span className="muted">{day(round.asked_at)}</span>
            {round.status === 'resolved' ? <span><strong>{m.fixed}</strong>{round.fixed_note ? `: ${round.fixed_note}` : ''}</span> : <span className="muted">{m.beingFixed}</span>}
          </li>)}</ul></section>}
      </div>
      <aside className="decision-panel" aria-label={m.decision}>
        {data.canDecide && <>
          <h2>{data.again ? m.readyAgain : m.ready}</h2>
          <p className="muted">{m.askHelp}</p>
          {!asking && <div className="trust-actions">
            <button type="button" className="button primary" disabled={busy} onClick={() => void send({ action: 'approve' })}>{m.approve}</button>
            <button type="button" className="button" disabled={busy} onClick={() => setAsking(true)}>{m.askChanges}</button>
          </div>}
          {asking && <form onSubmit={submitNote}>
            <label htmlFor="change-note">{m.noteLabel}<textarea id="change-note" value={note} aria-invalid={invalid} onChange={event => { setNote(event.target.value); setInvalid(false); }} /></label>
            {invalid && <p role="alert">{m.noteRequired}</p>}
            <div className="trust-actions"><button className="button primary" disabled={busy}>{m.sendNote}</button><button type="button" className="button" disabled={busy} onClick={() => { setAsking(false); setInvalid(false); }}>{loadMessages(locale).common.cancel}</button></div>
          </form>}
        </>}
        {!data.canDecide && state === 'approved' && <><h2>{m.complete}</h2><p>{data.isClient ? m.completeClient : m.completeAgency.replace('{name}', personName(data.client, locale))}</p></>}
        {waiting && <><h2>{m.waitingTitle}</h2><p>{m.waitingFor.replace('{name}', demoPhrase(data.client, locale))}</p></>}
        {!data.canDecide && state === 'changes requested' && <><h2>{m.stateChanges}</h2><p>{data.isClient ? m.beingFixedClient : m.beingFixedAgency}</p></>}
        {!data.canDecide && !waiting && state !== 'approved' && state !== 'changes requested' && <><h2>{m.inProgress}</h2><p>{data.isClient ? m.inProgressClient : m.inProgressAgency}</p></>}
      </aside>
    </div>
  </section>;
}
