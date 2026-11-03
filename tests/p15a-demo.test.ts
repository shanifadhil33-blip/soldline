import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { http, HttpResponse } from 'msw';
import { migrate } from '../src/server/db/migrate';
import { fixtureRuntime } from './helpers/runtime';
import { server } from './fixtures/http';
import { encryptToken } from '../src/server/crypto';
import { hash, type Payload } from '../src/server/approvals/model';
import { demoClickUpSpace } from '../src/server/demo/seed';
import { loadMessages } from '../src/lib/i18n';
import type { Member } from '../src/server/permissions';
import type { Job } from '../src/server/jobs/store';

let db: PGlite, runtime: ReturnType<typeof fixtureRuntime>;
const rows = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const label = loadMessages('en').backendA4.simulatedProvision;

beforeAll(async () => {
  vi.stubEnv('TOKEN_ENC_KEY', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('MAIL_PROVIDER', 'sample');
  db = new PGlite();
  await migrate(db);
  runtime = fixtureRuntime(db);
}, 60000);
afterAll(async () => { await db.close(); vi.unstubAllEnvs(); });

async function sandbox() {
  const ticket = await runtime.owner.demo.start('imran', null);
  const imran = (await runtime.owner.demo.member(ticket))!;
  const run = (await rows<{ id: string; deal_id: string; hubspot_deal_id: string }>("SELECT r.id,r.deal_id,d.hubspot_deal_id FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE r.workspace_id=$1 AND d.name LIKE 'Harbor%'", [ticket.sandbox]))[0];
  const approval = (await rows<{ id: string; payload: Payload; payload_hash: string; input_hash: string; input_refs: { system: string; hash: string }[]; kind: string }>('SELECT * FROM approvals WHERE workspace_id=$1 AND run_id=$2 AND kind=$3', [ticket.sandbox, run.id, 'provision']))[0];
  return { ticket, imran, run, approval, ws: ticket.sandbox };
}

async function tick(expectError = false) {
  const job = await runtime.owner.jobs.claim(Date.now());
  expect(job).toBeTruthy();
  let error: unknown;
  try { await runtime.owner.jobs.executeEffect(job as Job); await runtime.owner.jobs.finish(job as Job, true, Date.now()); }
  catch (caught) { error = caught; await runtime.owner.jobs.finish(job as Job, false, Date.now()); }
  if (expectError) expect(error).toBeTruthy(); else expect(error).toBeUndefined();
  return job as Job;
}

it('Seeds an executable Harbor provision approval and keeps the sample email', async () => {
  const { approval, run } = await sandbox();
  expect(approval.payload_hash).toBe(hash(approval.payload));
  expect(approval.input_hash).toBe(hash(approval.input_refs));
  expect(approval.payload.effects[0].location).toBe(demoClickUpSpace);
  expect(approval.payload.effects.map(effect => effect.action)).toContain('create_folder');
  expect(approval.payload.effects.some(effect => effect.action === 'create_folder_and_tasks')).toBe(false);
  expect(approval.input_refs[0].system).toBe('scope');
  expect(approval.payload.effects.some(effect => JSON.stringify(effect).includes('355638664953'))).toBe(false);
  const scope = (await rows('SELECT id,version,items_hash,status FROM scope_versions WHERE deal_id=$1', [run.deal_id]))[0];
  expect(approval.input_refs[0].hash).toBe(hash(scope));
  const email = (await rows<{ payload: Payload }>('SELECT payload FROM approvals WHERE run_id=$1 AND kind=$2', [run.id, 'client_email']))[0];
  expect(email.payload.effects[0].system).toBe('mail');
  expect(email.payload.effects[0].message?.body).toContain('Sample email, not sent');
});

it('Completes Approve without a live connection as a labelled simulation and an audit row', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const { approval, imran, run, ws } = await sandbox();
  expect((await runtime.owner.approvals.decide(approval.id, imran, 'approve', '')).status).toBe(200);
  expect((await runtime.owner.approvals.decide(approval.id, imran, 'approve', '')).status).toBe(409);
  expect((await runtime.owner.approvals.execute(approval.id, imran)).status).toBe(200);
  await tick();
  const done = (await rows<{ status: string; execution_summary: { label?: string; message?: string } }>('SELECT status,execution_summary FROM approvals WHERE id=$1', [approval.id]))[0];
  expect(done.status).toBe('executed');
  expect(done.execution_summary.label).toBe(label);
  expect(done.execution_summary.message).toBe(label);
  expect((await rows<{ status: string }>('SELECT status FROM runs WHERE id=$1', [run.id]))[0].status).toBe('ready');
  expect(await rows("SELECT id FROM audit_log WHERE workspace_id=$1 AND action='provision_simulated'", [ws])).not.toHaveLength(0);
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
  expect((await runtime.owner.approvals.execute(approval.id, imran)).message).toBe('Execution already recorded');
});

function providers(dealId: string, failTasks = 0) {
  const calls: string[] = [];
  const folders: { id: string; name: string }[] = [];
  const lists: { id: string; name: string; parent: string }[] = [];
  const tasks: { id: string; name: string; parent: string }[] = [];
  let failed = 0;
  const deal = { hs_lastmodifieddate: '1000', soldline_delivery_status: 'Not started', soldline_plan_url: '', soldline_run_ref: '', dealstage: 'appointmentscheduled' };
  server.use(
    http.all('https://api.clickup.com/*', async ({ request }) => {
      const url = new URL(request.url);
      calls.push(`${request.method} ${url.pathname}`);
      const parts = url.pathname.split('/');
      const kind = parts.at(-1);
      const parent = parts.at(-2) ?? '';
      if (request.method === 'GET' && kind === 'folder') return HttpResponse.json({ folders });
      if (request.method === 'POST' && kind === 'folder') {
        const body = await request.json() as { name: string };
        const row = { id: 'folder-' + folders.length, name: body.name };
        folders.push(row);
        return HttpResponse.json({ ...row, date_updated: '100' });
      }
      if (request.method === 'GET' && kind === 'list') return HttpResponse.json({ lists: lists.filter(list => list.parent === parent) });
      if (request.method === 'POST' && kind === 'list') {
        const body = await request.json() as { name: string };
        const row = { id: 'list-' + lists.length, name: body.name, parent };
        lists.push(row);
        return HttpResponse.json({ ...row, date_updated: '100' });
      }
      if (request.method === 'GET' && kind === 'task') return HttpResponse.json({ tasks: tasks.filter(task => task.parent === parent), last_page: true });
      if (request.method === 'POST' && kind === 'task') {
        if (failed < failTasks) { failed += 1; return new HttpResponse(null, { status: 503 }); }
        const body = await request.json() as { name: string };
        const row = { id: 'task-' + tasks.length, name: body.name, parent };
        tasks.push(row);
        return HttpResponse.json({ ...row, date_updated: '100', markdown_description: body.name });
      }
      return HttpResponse.json({ id: kind, name: 'Sample', date_updated: '100' });
    }),
    http.all('https://api.hubapi.com/*', async ({ request }) => {
      const url = new URL(request.url);
      calls.push(`${request.method} ${url.pathname}`);
      if (request.method === 'POST' && url.pathname.endsWith('/deals')) return HttpResponse.json({ id: dealId, properties: { ...deal } });
      if (request.method === 'PATCH') Object.assign(deal, (await request.json() as { properties: typeof deal }).properties, { hs_lastmodifieddate: '2000' });
      return HttpResponse.json({ id: dealId, properties: { ...deal } });
    }),
  );
  return { calls, folders, tasks };
}

async function connect(ws: string) {
  await db.query("INSERT INTO connections(workspace_id,provider,status,external_account_id,token_ciphertext,won_stage_id) VALUES($1,'clickup','connected','90141778913',$2,NULL),($1,'hubspot','connected','portal',$3,'closedwon')", [ws, encryptToken('clickup-' + ws), encryptToken('hubspot-' + ws)]);
}

it('Writes a live sandbox folder and deal, refuses protected ids, and does not duplicate work', async () => {
  const happy = providers('900111');
  const { approval, imran, run, ws } = await sandbox();
  await connect(ws);
  expect((await runtime.owner.approvals.decide(approval.id, imran, 'approve', '')).status).toBe(200);
  expect((await runtime.owner.approvals.execute(approval.id, imran)).status).toBe(200);
  await tick();
  expect(happy.folders).toHaveLength(1);
  expect(happy.tasks).toHaveLength(8);
  expect(happy.calls.some(call => call.startsWith('PATCH') && call.includes('900111'))).toBe(true);
  expect(happy.calls.some(call => call.includes('355638664953') || call.includes('sample_'))).toBe(false);
  const resources = await rows<{ provider: string; external_id: string }>('SELECT provider,external_id FROM demo_resources WHERE workspace_id=$1 ORDER BY provider,external_id', [ws]);
  expect(resources).toEqual([{ provider: 'clickup', external_id: 'folder-0' }, { provider: 'hubspot', external_id: '900111' }]);
  expect((await rows<{ hubspot_deal_id: string }>('SELECT hubspot_deal_id FROM deals WHERE id=$1', [run.deal_id]))[0].hubspot_deal_id).toBe('900111');
  const folderCalls = happy.calls.filter(call => call.startsWith('POST') && call.endsWith('/folder')).length;
  const taskCalls = happy.calls.filter(call => call.startsWith('POST') && call.endsWith('/task')).length;
  expect((await runtime.owner.approvals.execute(approval.id, imran)).message).toBe('Execution already recorded');
  expect(happy.calls.filter(call => call.startsWith('POST') && call.endsWith('/folder'))).toHaveLength(folderCalls);
  expect(happy.calls.filter(call => call.startsWith('POST') && call.endsWith('/task'))).toHaveLength(taskCalls);
});

it('Refuses a sandbox deal id that is protected or a sample id', async () => {
  for (const forbidden of ['355638664953', 'sample_created']) {
    const seen = providers(forbidden);
    const { approval, imran, ws } = await sandbox();
    await connect(ws);
    expect((await runtime.owner.approvals.decide(approval.id, imran, 'approve', '')).status).toBe(200);
    expect((await runtime.owner.approvals.execute(approval.id, imran)).status).toBe(200);
    await tick(true);
    expect(seen.calls.some(call => call.startsWith('PATCH'))).toBe(false);
    expect(await rows('SELECT id FROM demo_resources WHERE workspace_id=$1 AND external_id=$2', [ws, forbidden])).toHaveLength(0);
  }
});

it('Retries a partial task failure without a second folder', async () => {
  const seen = providers('900222', 1);
  const { approval, imran, ws, ticket } = await sandbox();
  const admin = (await runtime.owner.demo.member({ ...ticket, persona: 'faisal' }))!;
  await connect(ws);
  expect((await runtime.owner.approvals.decide(approval.id, imran, 'approve', '')).status).toBe(200);
  expect((await runtime.owner.approvals.execute(approval.id, imran)).status).toBe(200);
  await tick(true);
  expect(seen.folders).toHaveLength(1);
  const item = (await rows<{ id: string }>('SELECT id FROM recovery_items WHERE workspace_id=$1 AND kind=$2 ORDER BY created_at DESC LIMIT 1', [ws, 'execution_failed']))[0];
  expect((await runtime.owner.recovery.act(admin as Member, item.id, 'retry_now', '')).status).toBe(200);
  await tick();
  expect(seen.folders).toHaveLength(1);
  expect(seen.tasks).toHaveLength(8);
  expect(seen.calls.filter(call => call.startsWith('POST') && call.endsWith('/folder'))).toHaveLength(1);
});
