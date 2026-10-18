import Link from 'next/link';
import { getLanguage } from '../lib/locale';
import { loadMessages } from '../lib/i18n';
import { navPaths, staffNavigation, type NavKey } from '../lib/navigation';

export async function EmptyPage({ page }: { page: NavKey }) {
  const m = loadMessages(await getLanguage());
  return <><h1 className="page-title">{m.nav[page]}</h1><section className="empty-state"><span className="empty-mark" aria-hidden="true" /><h2>{m.empty.title}</h2><p>{m.empty.body}</p></section>{page === 'more' && <nav className="more-navigation" aria-label={m.common.navigation}>{staffNavigation.slice(2).map(key => <Link href={navPaths[key]} key={key}>{m.nav[key]}</Link>)}</nav>}</>;
}
