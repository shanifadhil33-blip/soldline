'use client';
import { useMemo, useState } from 'react';
import { loadMessages, type Language } from '../lib/i18n';
import { runSorts, sortRuns, type RunSort } from '../lib/run-sort';
import type { RunRow } from '../server/screens';
import { RunList } from './run-list';

export function ProjectBrowser({ runs, locale, sort, direction }: {
  runs: RunRow[]; locale: Language; sort: RunSort | null; direction: 'asc' | 'desc';
}) {
  const m = loadMessages(locale).screens;
  const [currentSort, setSort] = useState<RunSort | null>(sort);
  const [currentDirection, setDirection] = useState<'asc' | 'desc'>(direction);
  const ordered = useMemo(() => sortRuns(runs, currentSort, currentDirection), [runs, currentSort, currentDirection]);
  function apply(nextSort: RunSort | null, nextDirection: 'asc' | 'desc') {
    setSort(nextSort);
    setDirection(nextDirection);
    const params = new URLSearchParams();
    if (nextSort) params.set('sort', nextSort);
    params.set('direction', nextDirection);
    const query = params.toString();
    window.history.replaceState(null, '', query ? `/runs?${query}` : '/runs');
  }
  return <>
    <div className="filter-bar" role="group" aria-label={m.sort}>
      {runSorts.map((key, index) => <button type="button" key={key} aria-pressed={currentSort === key} onClick={() => apply(key, currentDirection)}>{m.columns[index]}</button>)}
      <button type="button" aria-pressed={currentDirection === 'asc'} onClick={() => apply(currentSort, currentDirection === 'asc' ? 'desc' : 'asc')}>{currentDirection === 'asc' ? m.ascending : m.descending}</button>
    </div>
    <RunList runs={ordered} locale={locale} />
  </>;
}
