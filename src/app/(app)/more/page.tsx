import Link from 'next/link';
import { getLanguage } from '../../../lib/locale';
import { loadMessages } from '../../../lib/i18n';
import { navPaths } from '../../../lib/navigation';

const icons = {
  connections: 'M9.5 14.5l5-5M8 11l-2 2a3.5 3.5 0 005 5l2-2M16 13l2-2a3.5 3.5 0 00-5-5l-2 2',
  templates: 'M6 4.5h12v15H6zM9 9h6M9 12.5h6M9 16h3.5',
  team: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3.5 19a5.5 5.5 0 0111 0M16 11a2.5 2.5 0 100-5M17 14.2a5 5 0 013.5 4.8',
  settings: 'M5 8h9M18 8h1M5 16h1M10 16h9M16 6v4M8 14v4',
  feedback: 'M5 6h14v9H10l-4 3.5V15H5z',
} as const;

export default async function Page() {
  const m = loadMessages(await getLanguage());
  const keys = ['connections', 'templates', 'team', 'settings', 'feedback'] as const;
  return <section className="screen">
    <h1>{m.nav.more}</h1>
    <ul className="record-list more-list">{keys.map(key => <li key={key}><Link className="row-link" href={navPaths[key]} prefetch>
      <svg className="row-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={icons[key]} /></svg>
      <span className="row-text"><strong>{m.nav[key]}</strong><span className="muted">{m.shell.moreHints[key]}</span></span>
      <svg className="chevron go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
    </Link></li>)}</ul>
  </section>;
}
