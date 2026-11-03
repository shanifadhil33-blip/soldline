import Link from 'next/link';
import { AppShell } from '../components/app-shell';
import { LanguageLink } from '../components/language-link';
import { getLanguage } from '../lib/locale';
import { loadMessages } from '../lib/i18n';
import { loadShell } from '../server/shell';

export default async function NotFound() {
  const shell = await loadShell();
  const locale = shell?.locale ?? await getLanguage();
  const m = loadMessages(locale);
  const t = m.trust;
  const home = shell?.reviewer ? '/home' : '/today';
  const body = <section className="screen not-found">
    <h1>{t.notFound}</h1>
    <p className="muted">{t.notFoundBody}</p>
    <Link className="button primary" href={shell ? home : '/'} prefetch={false}>{shell ? (shell.reviewer ? t.homeLinkClient : t.homeLink) : t.startLink}</Link>
  </section>;
  if (shell) return <AppShell {...shell}>{body}</AppShell>;
  return <main className="public-page"><header className="public-header"><Link className="brand" href="/">{m.common.brand}</Link><div className="header-actions"><LanguageLink locale={locale} path="/" /></div></header><div className="not-found-public">{body}</div></main>;
}
