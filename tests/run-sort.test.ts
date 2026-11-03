import { expect, it } from 'vitest';
import { sortRuns } from '../src/lib/run-sort';

const runs = [
  { id: 'b', client: 'Cedar', deal: 'Cedar Line', status: 'blocked', won: '2026-11-02', ready: null, owner: 'Imran' },
  { id: 'a', client: 'Harbor', deal: 'Harbor Coffee', status: 'waiting_approval', won: '2026-11-01', ready: null, owner: 'Omar' },
];

it('keeps work that needs you first until a chip is chosen', () => {
  expect(sortRuns(runs, null, 'desc').map(run => run.id)).toEqual(['a', 'b']);
});

it('sorts by the chosen chip and direction', () => {
  expect(sortRuns(runs, 'client', 'asc').map(run => run.client)).toEqual(['Cedar', 'Harbor']);
  expect(sortRuns(runs, 'client', 'desc').map(run => run.client)).toEqual(['Harbor', 'Cedar']);
});
