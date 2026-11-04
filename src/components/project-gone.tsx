import Link from 'next/link';
import { loadMessages, type Language } from '../lib/i18n';

/** A shared or refreshed project link whose sample has been reset. A clear message instead of a bounce to the list. */
export function ProjectGone({ locale }: { locale: Language }) {
  const m = loadMessages(locale).trust;
  return <section className="screen not-found">
    <h1>{m.goneTitle}</h1>
    <p className="muted">{m.goneBody}</p>
    <Link className="button primary" href="/runs" prefetch>{m.goneLink}</Link>
  </section>;
}
