import { getLanguage } from '../../../lib/locale';
import { loadMessages } from '../../../lib/i18n';
import { demoPhrase, personName } from '../../../lib/plain';
import { demoPeople } from '../../../lib/demo-personas';
import { readTeam, screenData, staffOnly } from '../../../server/screens';

export default async function Page() {
  await staffOnly(false);
  const locale = await getLanguage(), m = loadMessages(locale);
  const english = loadMessages('en').demo.people;
  const rows = await screenData(readTeam, 'team');
  const role = (roles: string[]) => (m.demo.roles as Record<string, string>)[roles[0]] ?? roles[0];
  const photo = (name: string) => demoPeople.find(person => english[person.id] === name)?.id;
  const agency = rows.filter(row => !row.roles.includes('client_reviewer'));
  const clients = rows.filter(row => row.roles.includes('client_reviewer'));
  const list = (people: typeof rows) => <ul className="record-list">{people.map(row => {
    const id = photo(row.name);
    return <li key={row.name}><span className="row-link person">
      {id ? <img src={`/people/${id}.svg`} alt="" width={40} height={40} /> : <span className="initial" aria-hidden="true">{row.name.charAt(0)}</span>}
      <span className="row-text"><strong>{personName(row.name, locale)}</strong><span className="muted">{role(row.roles)}{row.company ? `, ${demoPhrase(row.company, locale)}` : ''}</span></span>
    </span></li>;
  })}</ul>;
  return <section className="screen">
    <h1>{m.nav.team}</h1>
    <section className="list-group"><h2 className="list-title">{m.team.agency}</h2>{list(agency)}</section>
    {clients.length > 0 && <section className="list-group"><h2 className="list-title">{m.team.clients}</h2>{list(clients)}</section>}
  </section>;
}
