import { SettingsForm } from '../../../components/settings-form';
import { getLanguage } from '../../../lib/locale';
import { loadMessages } from '../../../lib/i18n';

export default async function Page() {
  const locale = await getLanguage();
  const m = loadMessages(locale);
  return <section className="screen"><h1>{m.nav.settings}</h1><SettingsForm locale={locale} /></section>;
}
