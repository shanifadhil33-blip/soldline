import { cookies } from 'next/headers';
import { SettingsForm } from '../../../components/settings-form';
import { getLanguage } from '../../../lib/locale';
import { loadMessages } from '../../../lib/i18n';
import { getMember } from '../../../server/session';
import { getAppDriver } from '../../../server/db/runtime';
import { withMember } from '../../../server/db/withMember';
import { settings } from '../../../server/backend-a5';

export default async function Page() {
  const locale = await getLanguage();
  const m = loadMessages(locale);
  const member = await getMember(await cookies());
  const initial = member ? await withMember(getAppDriver(), member.id, db => settings(db, member, false)) : null;
  return <section className="screen"><h1>{m.nav.settings}</h1><SettingsForm locale={locale} initial={initial as { preferredName?: string; language?: 'en' | 'ar'; digestTime?: string; agentName?: string } | null} /></section>;
}
