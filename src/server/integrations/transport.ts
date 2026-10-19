import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Connections, type Provider } from './connections';
import { NeedsReconnect, ProviderRejected, RateLimited, Retryable } from './errors';
export interface TransportOptions {
  connections: Connections;
  now?: () => number;
  deadline?: number;
  sleep?: (ms: number) => Promise<void>;
}
export class Transport {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  constructor(private readonly provider: Provider, private readonly base: string, private readonly options: TransportOptions) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }
  async request<T>(method: string, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const { connections } = this.options;
    const { token, bucketKey } = await connections.load(this.provider);
    const fault = await connections.fault(this.provider,method==='POST'&&/\/list\/[^/]+\/task$/.test(path)?'task_create':undefined);
    if (fault) {
      const id = randomUUID();
      if (fault === 'revoked') {
        await connections.markNeedsReconnect(this.provider, 'simulated_revoked', id);
        throw new NeedsReconnect();
      }
      await connections.record(this.provider, id, 'simulated_outage', false);
      throw new Retryable('simulated outage');
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const delay = await connections.take(this.provider, bucketKey, this.now());
      if (delay) throw new RateLimited(this.now() + delay);
      const remaining=this.options.deadline===undefined?30000:this.options.deadline-this.now()-250;
      if(remaining<=0) throw new Retryable();
      const id = randomUUID();
      await connections.record(this.provider, id, 'started', false);
      let response: Response;
      try {
        response = await fetch(this.base + path, {
          method, redirect: 'error', signal: AbortSignal.timeout(Math.max(1,Math.min(30000,remaining))),
          headers: { Authorization: this.provider === 'clickup' ? token : `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Request-Id': id },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        await connections.record(this.provider, id, 'network', false);
        throw new Retryable();
      }
      if (method==='DELETE'&&response.status===404) {await connections.record(this.provider,id,'404',true);return schema.parse(undefined);}
      if (response.status === 401 || response.status === 403) {
        await connections.markNeedsReconnect(this.provider, String(response.status) as '401' | '403', id);
        throw new NeedsReconnect();
      }
      if (response.status === 429) {
        await connections.record(this.provider, id, '429', false);
        const reset = this.resetAt(response.headers);
        if (attempt === 0 && reset !== undefined && (this.options.deadline===undefined || reset<this.options.deadline-250)) { await this.sleep(Math.max(0, reset - this.now())); continue; }
        throw new RateLimited(reset ?? this.now() + 60000);
      }
      if (!response.ok) {
        await connections.record(this.provider, id, String(response.status), false);
        if (response.status >= 500) throw new Retryable();
        throw new ProviderRejected();
      }
      let parsed: T;
      try { parsed = schema.parse(response.status === 204 ? undefined : await response.json()); }
      catch { await connections.record(this.provider, id, 'invalid_response', false); throw new Retryable(); }
      await connections.record(this.provider, id, String(response.status), true);
      return parsed;
    }
    throw new RateLimited(this.now() + 60000);
  }
  private resetAt(headers: Headers): number | undefined {
    const retry = headers.get('Retry-After');
    if (retry !== null) {
      const seconds = Number(retry);
      const time = retry.trim() !== '' && Number.isFinite(seconds) ? this.now() + Math.max(0, seconds) * 1000 : Date.parse(retry);
      if (Number.isFinite(time)) return time;
    }
    const reset = headers.get('X-RateLimit-Reset');
    if (reset !== null && reset.trim() && Number.isFinite(Number(reset))) return Number(reset) * 1000;
    return undefined;
  }
}
export const emptyResponse = z.union([z.undefined(), z.object({}).passthrough()]);
export const entity = z.object({ id: z.union([z.string(), z.number()]).transform(String), name: z.string().optional() }).passthrough();
export type Entity = z.infer<typeof entity>;
export function segment(id: string) { return encodeURIComponent(id); }
