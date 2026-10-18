import Link from 'next/link';
import { DemoPicker } from '../../../components/demo-picker';
import { LanguageLink } from '../../../components/language-link';
import { getLanguage } from '../../../lib/locale';
import { loadMessages } from '../../../lib/i18n';
export default async function DemoPage() {
  const locale = await getLanguage(); const m = loadMessages(locale);
  return <main className="public-page demo-page"><header className="public-header"><Link className="brand" href="/">{m.common.brand}</Link><div className="header-actions"><LanguageLink locale={locale} path="/demo" /><Link href="/sign-in">{m.landing.signIn}</Link></div></header><section className="demo-content"><span className="sample-badge">{m.shell.sample}</span><h1>{m.demo.title}</h1><p>{m.demo.intro}</p><DemoPicker locale={locale} /><p className="muted">{m.demo.fictional}</p></section></main>;
}
