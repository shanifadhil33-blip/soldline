import Link from 'next/link';
import { getLanguage } from '../../lib/locale';
import { loadMessages, formatNumber } from '../../lib/i18n';
import { LanguageLink } from '../../components/language-link';
import { OpenDemo } from '../../components/open-demo';

export default async function Home() {
  const locale = await getLanguage();
  const m = loadMessages(locale);
  const headline = m.landing.headline;
  const word = m.landing.accentWord;
  const at = headline.indexOf(word);
  const tasks = ['Brand style refresh', 'Website landing page', 'Four blog posts a month', 'Monthly SEO report'];
  return <main className="public-page" id="content">
    <header className="public-header"><Link className="brand" href="/">{m.common.brand}</Link><div className="header-actions"><LanguageLink locale={locale} path="/" /><Link href="/sign-in">{m.landing.signIn}</Link></div></header>
    <section className="landing-hero">
      <div>
        <h1>{at < 0 ? headline : <>{headline.slice(0, at)}<em className="clay">{word}</em>{headline.slice(at + word.length)}</>}</h1>
        <p className="landing-subline">{m.landing.subline}</p>
        <div className="hero-actions"><OpenDemo locale={locale} /><Link className="button" href="/demo">{m.landing.demo}</Link></div>
      </div>
      <aside className="product-frame" aria-label={m.landing.preview}>
        <div>
          <h2>{m.landing.soldHeading}</h2>
          <p>{m.landing.productTitle}</p>
          <ol>{[m.landing.scope, m.landing.check, m.landing.approve, m.landing.deliver].map((label, index) => <li key={label}><span>{formatNumber(index + 1, locale)}</span> {label}</li>)}</ol>
        </div>
        <div>
          <h2>{m.landing.planHeading}</h2>
          <ol>{tasks.map(task => <li key={task}>{task}</li>)}</ol>
          <p>{m.landing.productNote}</p>
        </div>
      </aside>
    </section>
    <section className="landing-sections">{m.landing.sections.map((title, i) => <article key={title}><span className="section-number">{formatNumber(i + 1, locale)}</span><h2>{title}</h2><p>{m.landing.details[i]}</p></article>)}</section>
    <footer className="public-footer"><p>{m.landing.footer}</p><p className="stack-line">{m.landing.stack}</p><p className="legal-links"><Link href="/privacy">{m.legal.privacyLink}</Link><Link href="/terms">{m.legal.termsLink}</Link></p></footer>
  </main>;
}
