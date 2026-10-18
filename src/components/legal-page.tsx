import Link from 'next/link';
import type { Language } from '../lib/i18n';
import { loadMessages } from '../lib/i18n';
import { LanguageLink } from './language-link';

export function LegalPage({ locale, kind }: { locale: Language; kind: 'privacy' | 'terms' }) {
  const m = loadMessages(locale);
  const page = m.legal[kind];
  return <main className="public-page legal-page" id="content">
    <header className="public-header"><Link className="brand" href="/">{m.common.brand}</Link><div className="header-actions"><LanguageLink locale={locale} path={`/${kind}`} /><Link href="/sign-in">{m.landing.signIn}</Link></div></header>
    <article className="legal-body">
      <h1>{page.title}</h1>
      <p>{page.intro}</p>
      {page.sections.map(section => <section key={section.heading}><h2>{section.heading}</h2><p>{section.body}</p></section>)}
      <p className="muted">{m.legal.updated}</p>
      <p><Link href="/">{m.legal.back}</Link></p>
    </article>
  </main>;
}
