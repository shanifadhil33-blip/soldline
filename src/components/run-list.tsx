import Link from 'next/link';
import type { RunRow } from '../server/screens';
import { loadMessages, type Language } from '../lib/i18n';
import { demoPhrase, personName, statusWord } from '../lib/plain';
export function RunList({ runs, locale }: { runs: RunRow[]; locale: Language }) {
  const m = loadMessages(locale).screens;
  const date = (value: string | null) => value ? new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: 'medium' }).format(new Date(value)) : m.none;
  const owner = (run: RunRow) => run.owner ? personName(run.owner, locale) : m.unassigned;
  const text = (value: string, demo: boolean) => demo ? demoPhrase(value, locale) : value;
  const status = (run: RunRow) => run.status ? statusWord(run.status, locale) : m.none;
  const cells = (run: RunRow) => [text(run.client, run.is_demo), text(run.deal, run.is_demo), status(run), date(run.won), date(run.ready), owner(run)];
  const phone = <ul className="record-list runs-phone">{runs.map(run => <li key={run.id}><Link className="row-link" href={`/runs/${run.id}`} prefetch>
    <span className="row-text"><strong>{text(run.deal, run.is_demo)}</strong><span className="muted">{owner(run)}</span></span>
    <span className="status-chip">{status(run)}</span>
    <svg className="chevron go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
  </Link></li>)}</ul>;
  const table = <table className="runs-table"><thead><tr>{m.columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{runs.map(run => <tr key={run.id}>{cells(run).map((cell, i) => <td key={i}>{i === 1 ? <Link href={`/runs/${run.id}`} prefetch>{cell}</Link> : i === 2 ? <span className="status-chip">{cell}</span> : cell}</td>)}</tr>)}</tbody></table>;
  return <>{phone}{table}{!runs.length && <p>{m.noRuns}</p>}</>;
}
