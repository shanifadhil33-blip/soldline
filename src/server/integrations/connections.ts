import 'server-only';
import { createHash } from 'node:crypto';
import { encryptToken, decryptToken } from '../crypto';
import { append } from '../audit';
import type { SqlConnection, TransactionDriver } from '../db/withMember';
import { ConnectionPaused, NeedsReconnect } from './errors';
export type Provider = 'hubspot' | 'clickup' | 'mail';
export type Health = { status: 'connected' | 'needs_reconnect' | 'paused' | 'revoked'; last_ok_at: string | null; last_error_code: string | null };
type Connection = Health & { id: string; token_ciphertext: string | null; external_account_id: string | null };
/** Internal server service. Supply a privileged worker driver, never expose it to a route.
 * Each operation commits independently of the caller and of outbound HTTP failures. */
export class Connections {
  constructor(private readonly driver: TransactionDriver, readonly workspaceId: string, private readonly actorId: string, private readonly key?: string) {}
  private tx<T>(work: (db: SqlConnection) => Promise<T>) {
    return this.driver.transaction(async db => {
      await db.query("SELECT set_config('app.member_id',$1,true)", [this.actorId]);
      const member = await db.query('SELECT 1 FROM members WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL', [this.workspaceId, this.actorId]);
      if (!member.rows.length) throw new Error('Workspace access refused');
      return work(db);
    });
  }
  private async row(db: SqlConnection, provider: Provider) {
    const rows = await db.query<Connection>('SELECT id,status,token_ciphertext,external_account_id,last_ok_at,last_error_code FROM connections WHERE workspace_id=$1 AND provider=$2', [this.workspaceId, provider]);
    if (rows.rows.length !== 1) throw new NeedsReconnect();
    return rows.rows[0];
  }
  seal(value: string) { return encryptToken(value, this.key); }
  async saveWebhookSecret(id: string, secret: string) {
    const sealed = this.seal(secret);
    await this.tx(async db => {
      await db.query("UPDATE connections SET webhook_secrets=jsonb_set(webhook_secrets,ARRAY[$2],to_jsonb($3::text)) WHERE workspace_id=$1 AND provider='clickup'", [this.workspaceId, id, sealed]);
    });
    return sealed;
  }
  async health(provider: Provider): Promise<Health> {
    return this.tx(async db => { const r = await this.row(db, provider); return { status: r.status, last_ok_at: r.last_ok_at, last_error_code: r.last_error_code }; });
  }
  async storeToken(provider: Provider, token: string, accountId: string) {
    if (!accountId || !token) throw new Error('Provider account and token are required');
    const ciphertext = encryptToken(token, this.key);
    await this.tx(async db => {
      const roles = await db.query<{ allowed: boolean }>("SELECT 'admin'=ANY(app_roles($1)) AS allowed", [this.workspaceId]);
      if (!roles.rows[0]?.allowed) throw new Error('Connection access refused');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [this.workspaceId + provider]);
      const rows = await db.query('SELECT id FROM connections WHERE workspace_id=$1 AND provider=$2', [this.workspaceId, provider]);
      if (rows.rows.length) await db.query("UPDATE connections SET token_ciphertext=$3,external_account_id=$4,status='connected',last_error_code=NULL WHERE workspace_id=$1 AND provider=$2", [this.workspaceId, provider, ciphertext, accountId]);
      else await db.query("INSERT INTO connections (workspace_id,provider,status,token_ciphertext,external_account_id) VALUES ($1,$2,'connected',$3,$4)", [this.workspaceId, provider, ciphertext, accountId]);
      await append(db, this.workspaceId, { action: 'connection_saved', outcome: 'succeeded', target_type: provider });
    });
  }
  async load(provider: Provider) {
    return this.tx(async db => {
      const r = await this.row(db, provider);
      if (r.status === 'paused') throw new ConnectionPaused();
      if (r.status !== 'connected' || !r.token_ciphertext || (provider === 'hubspot' && !r.external_account_id)) throw new NeedsReconnect();
      const token = decryptToken(r.token_ciphertext, this.key);
      return { token, bucketKey: createHash('sha256').update(provider === 'hubspot' ? r.external_account_id! : token).digest('hex') };
    });
  }
  async markNeedsReconnect(provider: Provider, code: '401' | '403' | 'simulated_revoked', requestId: string) {
    await this.tx(async db => {
      await db.query("UPDATE connections SET status='needs_reconnect',last_error_code=$3 WHERE workspace_id=$1 AND provider=$2", [this.workspaceId, provider, code]);
      await append(db, this.workspaceId, { action: 'connection_needs_reconnect', outcome: 'failed', target_type: provider, request_id: requestId, after: { request_id: requestId, code } });
    });
  }
  async pause(provider: Provider) { await this.setPaused(provider, true); }
  async resume(provider: Provider) { await this.setPaused(provider, false); }
  private async setPaused(provider: Provider, paused: boolean) {
    await this.tx(async db => {
      const roles = await db.query<{ allowed: boolean }>("SELECT 'admin'=ANY(app_roles($1)) AS allowed", [this.workspaceId]);
      if (!roles.rows[0]?.allowed) throw new Error('Connection access refused');
      await db.query("UPDATE connections SET status=$3 WHERE workspace_id=$1 AND provider=$2 AND status=$4", [this.workspaceId, provider, paused ? 'paused' : 'connected', paused ? 'connected' : 'paused']);
      await append(db, this.workspaceId, { action: paused ? 'connection_paused' : 'connection_resumed', outcome: 'succeeded', target_type: provider });
    });
  }
  async record(provider: Provider, requestId: string, code: string, ok: boolean) {
    await this.tx(async db => {
      if (ok) await db.query("UPDATE connections SET last_ok_at=now(),last_error_code=NULL WHERE workspace_id=$1 AND provider=$2 AND status='connected'", [this.workspaceId, provider]);
      await append(db, this.workspaceId, { action: 'provider_request', outcome: ok ? 'succeeded' : 'failed', target_type: provider, request_id: requestId, after: { request_id: requestId, code } });
    });
  }
  async fault(provider: Provider): Promise<'outage' | 'revoked' | undefined> {
    return this.tx(async db => {
      const result = await db.query<{ mode: 'outage' | 'revoked' }>(`UPDATE demo_faults f SET fail_next=fail_next-1 FROM workspaces w WHERE f.workspace_id=$1 AND f.provider=$2 AND f.fail_next>0 AND w.id=f.workspace_id AND w.is_demo=true RETURNING f.mode`, [this.workspaceId, provider]);
      return result.rows[0]?.mode;
    });
  }
  async take(provider: Provider, bucketKey: string, now: number): Promise<number> {
    if (provider === 'mail') return 0;
    const period = provider === 'hubspot' ? 10000 : 60000;
    return this.tx(async db => {
      await db.query('INSERT INTO rate_buckets (workspace_id,provider,bucket_key,tokens,updated_at) VALUES ($1,$2,$3,100,$4) ON CONFLICT DO NOTHING', [this.workspaceId, provider, bucketKey, new Date(now).toISOString()]);
      const result = await db.query<{ tokens: string; updated_at: string }>('SELECT tokens,updated_at FROM rate_buckets WHERE provider=$1 AND bucket_key=$2 FOR UPDATE', [provider, bucketKey]);
      const row = result.rows[0];
      const available = Math.min(100, Number(row.tokens) + Math.max(0, now - new Date(row.updated_at).getTime()) * 100 / period);
      const wait = available >= 1 ? 0 : Math.ceil((1 - available) * period / 100);
      await db.query('UPDATE rate_buckets SET tokens=$3,updated_at=$4 WHERE provider=$1 AND bucket_key=$2', [provider, bucketKey, wait ? available : available - 1, new Date(now).toISOString()]);
      return wait;
    });
  }
}
