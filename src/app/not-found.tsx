import Link from 'next/link';
import { getLanguage } from '../lib/locale';
import { loadMessages } from '../lib/i18n';
export default async function NotFound(){const m=loadMessages(await getLanguage()).trust;return <main className="screen trust-card not-found"><h1>{m.notFound}</h1><p>{m.notFoundBody}</p><Link className="button" href="/home">{m.homeLink}</Link></main>;}
