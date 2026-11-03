import { screenData, readRuns } from '../../../server/screens';
import { getLanguage } from '../../../lib/locale';
import { loadMessages } from '../../../lib/i18n';
import { runSorts, type RunSort } from '../../../lib/run-sort';
import { ProjectBrowser } from '../../../components/project-browser';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const locale = await getLanguage();
  const m = loadMessages(locale);
  const query = await searchParams;
  const sort = runSorts.find((key): key is RunSort => key === query.sort) ?? null;
  const direction = query.direction === 'asc' ? 'asc' : 'desc';
  const runs = await screenData(readRuns, 'runs');
  return <section className="screen"><h1>{m.nav.runs}</h1><ProjectBrowser runs={runs} locale={locale} sort={sort} direction={direction} /></section>;
}
