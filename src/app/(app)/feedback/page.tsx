import { FeedbackForm } from '../../../components/feedback-form';
import { getLanguage } from '../../../lib/locale';
import { loadMessages } from '../../../lib/i18n';

export default async function Page() {
  const locale = await getLanguage();
  const m = loadMessages(locale);
  return <section className="screen"><h1>{m.preferences.feedback}</h1><p className="muted lead">{m.preferences.feedbackLead}</p><FeedbackForm locale={locale} /></section>;
}
