import Link from 'next/link';
import { getLanguage } from '../../lib/locale';
import { loadMessages, formatNumber } from '../../lib/i18n';
import { LanguageLink } from '../../components/language-link';

export default async function Home() {
  const locale = await getLanguage();
  const m = loadMessages(locale);
  return <main className="public-page" id="content">
    <header className="public-header"><Link className="brand" href="/">{m.common.brand}</Link><div className="header-actions"><LanguageLink locale={locale} path="/" /><Link href="/sign-in">{m.landing.signIn}</Link></div></header>
    <section className="landing-hero">
      <div><h1>{m.landing.headline}</h1><p className="landing-subline">{m.landing.subline}</p><div className="hero-actions"><Link className="button primary" href="/demo">{m.landing.demo}</Link><Link className="button" href="/sign-in">{m.landing.signIn}</Link></div></div>
      <aside className="handover" aria-label={m.landing.preview}><p>{m.landing.promise}</p><ol>{[m.landing.scope, m.landing.check, m.landing.approve, m.landing.deliver].map((label, i) => <li key={label}><span className="step-number">{formatNumber(i + 1, locale)}</span><span>{label}</span></li>)}</ol></aside>
    </section>
    <section className="landing-sections">{m.landing.sections.map((title, i) => <article key={title}><span className="section-number">{formatNumber(i + 1, locale)}</span><h2>{title}</h2><p>{m.landing.details[i]}</p></article>)}</section>
    <footer className="public-footer"><p>{m.landing.footer}</p><p className="stack-line">{m.landing.stack}</p></footer>
  </main>;
}
