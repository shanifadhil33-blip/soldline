import Link from 'next/link';
import { getLanguage } from '../lib/locale';
import { loadMessages } from '../lib/i18n';
import { navPaths, type NavKey } from '../lib/navigation';

export async function EmptyPage({ page }: { page: NavKey }) {
  const m = loadMessages(await getLanguage());
  const moreKeys = ['connections', 'templates', 'team', 'settings', 'recovery', 'audit'] as const;
  return <><h1 className="page-title">{m.nav[page]}</h1>{page === 'more' && <p className="more-lead">{m.shell.moreLead}</p>}<section className="empty-state"><span className="empty-mark" aria-hidden="true" /><h2>{m.empty.title}</h2><p>{m.empty.body}</p></section>{page === 'more' && <nav className="more-navigation" aria-label={m.common.navigation}>{moreKeys.map(key => <Link href={navPaths[key]} prefetch key={key}>{m.nav[key]}</Link>)}</nav>}</>;
}
