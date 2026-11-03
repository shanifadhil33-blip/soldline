export const runSorts = ['client', 'deal', 'status', 'won', 'ready', 'owner'] as const;
export type RunSort = typeof runSorts[number];
export type SortableRun = { id: string; client: string; deal: string; status: string; won: string | null; ready: string | null; owner: string | null };

/** Waiting work stays first until a sort chip is chosen. */
export function sortRuns<T extends SortableRun>(runs: T[], sort: RunSort | null, direction: 'asc' | 'desc'): T[] {
  const copy = [...runs];
  if (!sort) {
    copy.sort((a, b) => Number(b.status === 'waiting_approval') - Number(a.status === 'waiting_approval') || a.id.localeCompare(b.id));
    return copy;
  }
  copy.sort((a, b) => {
    const difference = sort === 'won' || sort === 'ready'
      ? (a[sort] ? new Date(a[sort] as string).getTime() : 0) - (b[sort] ? new Date(b[sort] as string).getTime() : 0)
      : String(a[sort] ?? '').localeCompare(String(b[sort] ?? ''));
    return difference * (direction === 'asc' ? 1 : -1) || a.id.localeCompare(b.id);
  });
  return copy;
}
