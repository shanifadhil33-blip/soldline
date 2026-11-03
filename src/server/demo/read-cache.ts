import type { Member } from '../permissions';

type Entry = { workspace: string; expires: number; value: unknown };
const reads = new Map<string, Entry>();
const members = new Map<string, { expires: number; member: Member }>();
const inflight = new Map<string, Promise<unknown>>();
const enabled = process.env.NODE_ENV !== 'test';

export function takeMember(key: string): Member | undefined {
  if (!enabled) return undefined;
  const hit = members.get(key);
  if (!hit || hit.expires < Date.now()) return undefined;
  return hit.member;
}

export function saveMember(key: string, member: Member) {
  if (!enabled) return;
  members.set(key, { member, expires: Date.now() + 60_000 });
}

export function readDemoCache<T>(workspace: string, key: string): T | undefined {
  if (!enabled) return undefined;
  const hit = reads.get(`${workspace}:${key}`);
  if (!hit || hit.expires < Date.now()) return undefined;
  return hit.value as T;
}

export function writeDemoCache(workspace: string, key: string, value: unknown, ttl = 30_000) {
  if (!enabled) return;
  reads.set(`${workspace}:${key}`, { workspace, expires: Date.now() + ttl, value });
}

export function clearDemoWorkspace(workspace: string) {
  for (const [key, entry] of reads) if (entry.workspace === workspace) reads.delete(key);
}

export function clearDemoCaches() {
  reads.clear();
  members.clear();
  inflight.clear();
}

/** One database read for concurrent demo prefetches of the same screen. */
export async function demoCached<T>(workspace: string, key: string, load: () => Promise<T>): Promise<T> {
  const hit = readDemoCache<T>(workspace, key);
  if (hit !== undefined) return hit;
  const pending = inflight.get(`${workspace}:${key}`);
  if (pending) return pending as Promise<T>;
  const promise = load().then(value => {
    writeDemoCache(workspace, key, value);
    inflight.delete(`${workspace}:${key}`);
    return value;
  }).catch(error => {
    inflight.delete(`${workspace}:${key}`);
    throw error;
  });
  inflight.set(`${workspace}:${key}`, promise);
  return promise;
}
