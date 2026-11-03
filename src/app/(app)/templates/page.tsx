import { getLanguage } from '../../../lib/locale';
import { loadMessages } from '../../../lib/i18n';
import { demoPhrase } from '../../../lib/plain';

const checklist = ['Brand guide files', 'Meta ad account access', 'Google Ads access', 'Analytics access', 'Name of the client approver', 'Launch date'];
const steps = [
  { list: 'Setup', items: ['Brand style refresh', 'Website landing page'] },
  { list: 'Content', items: ['Four blog posts a month', 'Monthly SEO report'] },
  { list: 'Ads', items: ['Meta ads setup', 'Google Ads setup'] },
  { list: 'Reporting', items: ['Email newsletter template', 'Monthly results dashboard'] },
];

export default async function Page() {
  const locale = await getLanguage(), m = loadMessages(locale), t = m.templates;
  const say = (text: string) => demoPhrase(text, locale);
  return <section className="screen">
    <h1>{m.nav.templates}</h1>
    <p className="muted lead">{t.lead}</p>
    <section className="list-group"><h2 className="list-title">{t.checklist}</h2><p className="muted">{t.checklistHint}</p>
      <ul className="record-list">{checklist.map(item => <li key={item}><span className="row-text"><strong>{say(item)}</strong></span></li>)}</ul></section>
    <section className="list-group"><h2 className="list-title">{t.steps}</h2><p className="muted">{t.stepsHint}</p>
      {steps.map(step => <div key={step.list}><h3>{say(step.list)}</h3><ul className="record-list">{step.items.map(item => <li key={item}><span className="row-text"><strong>{say(item)}</strong></span></li>)}</ul></div>)}</section>
  </section>;
}
