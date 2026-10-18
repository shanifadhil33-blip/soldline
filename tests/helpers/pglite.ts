import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../../src/server/db/migrate';
import { withMember, type SqlConnection } from '../../src/server/db/withMember';

export const tables = ['workspaces','users','accounts','sessions','verification_tokens','members','client_companies','connections','deals','line_items','scope_documents','scope_versions','scope_items','deliverable_mappings','memories','runs','onboarding_inputs','findings','approvals','external_effects','inbound_events','jobs','recovery_items','audit_log','agent_threads','agent_messages','notifications','demo_faults','rate_buckets','monitor_tasks'] as const;
export const roles = ['admin','account_manager','delivery_lead','contributor','client_reviewer'] as const;
export function id(group: number, value: number) { return `00000000-0000-4000-8000-${String(group * 1000 + value).padStart(12, '0')}`; }
export const fixture = (g: number) => ({ ws: id(g,1), companyA: id(g,2), companyB: id(g,3), admin: id(g,10), manager: id(g,11), lead: id(g,12), contributor: id(g,13), reviewer: id(g,14), other: id(g,15), archived: id(g,16), runA: id(g,30), runB: id(g,31), runOther: id(g,32), thread: id(g,60) });

export async function createDatabase() {
  const db = new PGlite();
  await migrate(db);
  for (const group of [1,2]) {
    const f = fixture(group);
    async function insert(table: string, row: Record<string, unknown>) {
      const values = { workspace_id: f.ws, ...row };
      const keys = Object.keys(values);
      await db.query(`INSERT INTO ${table} (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map((_,i) => `$${i+1}`).join(',')})`, Object.values(values));
    }
    await insert('workspaces', { id: f.ws, name: 'Fixture workspace', is_demo: false });
    for (const company of [f.companyA, f.companyB]) await insert('client_companies', { id: company, name: 'Client' });
    for (let n = 0; n < 7; n++) {
      await insert('users', { id: id(group,100+n), name: 'Adhil', email: `adhil${group}${n}@example.test` });
      await insert('members', { id: id(group,10+n), user_id: id(group,100+n), display_name: 'Adhil', roles: [roles[n % 5]], client_company_id: n === 4 ? f.companyA : null, archived_at: n === 6 ? '2026-10-18T00:00:00Z' : null });
    }
    await insert('accounts', { user_id: id(group,100), type: 'oauth', provider: 'demo', provider_account_id: 'adhil' });
    await insert('sessions', { user_id: id(group,100), session_token: 'demo', expires: '2027-01-01T00:00:00Z' });
    await insert('verification_tokens', { identifier: 'adhil', token: 'demo', expires: '2027-01-01T00:00:00Z' });
    await insert('demo_faults', { provider: 'clickup', mode: 'outage', fail_next: 0 });
    await insert('rate_buckets', { provider: 'clickup', bucket_key: `fixture${group}`, tokens: '100', updated_at: new Date().toISOString() });
    await insert('connections', { provider: 'mail', status: 'connected' });
    for (let n = 0; n < 3; n++) {
      const deal = id(group,20+n), run = id(group,30+n);
      await insert('deals', { id: deal, client_company_id: n === 1 ? f.companyB : f.companyA, hubspot_deal_id: String(n), name: 'Delivery', owner_member_id: f.manager });
      await insert('runs', { id: run, deal_id: deal, run_key: `deal:${deal}:won:scope`, status: 'received' });
      await insert('onboarding_inputs', { run_id: run, key: 'logo', status: 'missing' });
      await insert('findings', { id: id(group,40+n), run_id: run, kind: 'missing_input', owner_member_id: n === 0 ? f.contributor : f.other });
    }
    await insert('findings', { run_id: f.runA, kind: 'unusual_instruction' });
    await insert('monitor_tasks', { run_id: f.runA, task_id: 'fixture', status: 'Open', observed_at: new Date().toISOString() });
    await insert('line_items', { deal_id: id(group,20) });
    await insert('scope_documents', { id: id(group,50), deal_id: id(group,20), source: 'upload' });
    await insert('scope_versions', { id: id(group,51), deal_id: id(group,20), version: 1, status: 'draft', source_document_id: id(group,50) });
    await insert('scope_items', { scope_version_id: id(group,51) });
    await insert('deliverable_mappings', { learned_from_run_id: f.runA });
    await insert('memories', { scope: 'org' });
    for (const member of [f.admin, f.other]) {
      await insert('memories', { scope: 'person', member_id: member });
      const thread = member === f.admin ? f.thread : id(group,61);
      await insert('agent_threads', { id: thread, member_id: member });
      await insert('agent_messages', { thread_id: thread, member_id: member, role: 'user', body: 'Ready' });
      await insert('notifications', { member_id: member, body: 'Ready' });
    }
    await insert('approvals', { id: id(group,70), run_id: f.runA, kind: 'provision' });
    await insert('external_effects', { id: id(group,71), run_id: f.runA, approval_id: id(group,70), effect_key: `effect${group}` });
    await insert('inbound_events', { source: 'mail', dedupe_key: `event${group}` });
    await insert('jobs', { id: id(group,72), run_id: f.runA });
    await insert('recovery_items', { run_id: f.runA, job_id: id(group,72), finding_id: id(group,40), owner_member_id: f.contributor });
    await db.query("SELECT set_config('app.member_id', $1, false)", [f.admin]);
    await db.query("SELECT audit_append($1, '{\"action\":\"created\",\"outcome\":\"succeeded\"}')", [f.ws]);
  }
  await db.query("RESET app.member_id");
  return {
    db,
    asMember<T>(member: string, work: (connection: SqlConnection) => Promise<T>) {
      return withMember(db, member, async (connection) => {
        await connection.query('SET LOCAL ROLE soldline_app');
        return work(connection);
      });
    },
  };
}
