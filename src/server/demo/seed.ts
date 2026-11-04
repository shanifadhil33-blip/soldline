import { seedSampleInbox } from '../integrations/sample-inbox';
import { randomUUID } from 'node:crypto';
import type { SqlConnection } from '../db/withMember';
import type { Role } from '../permissions';
import { exactApprovalFields, hash, sortedRefs, type InputRef, type Payload } from '../approvals/model';
import { provisionPayload } from '../executor/provision';
export const demoClickUpSpace = '90149400327';
export const personas = {
  faisal: { name: 'Faisal Rahman', role: 'admin' },
  omar: { name: 'Omar Haddad', role: 'account_manager' },
  imran: { name: 'Imran Shaikh', role: 'delivery_lead' },
  ravi: { name: 'Ravi Menon', role: 'contributor' },
  karim: { name: 'Karim Nasser', role: 'client_reviewer' },
  laith: { name: 'Laith Saeed', role: 'client_reviewer' },
} satisfies Record<string, { name: string; role: Role }>;
export type Persona = keyof typeof personas;
export const scopeTitles = ['Brand style refresh', 'Website landing page', 'Four blog posts a month', 'Monthly SEO report', 'Meta ads setup', 'Google Ads setup', 'Email newsletter template', 'Monthly results dashboard'];
export const inputTitles = ['Brand guide files', 'Meta ad account access', 'Google Ads access', 'Analytics access', 'Name of the client approver', 'Launch date'];
export async function seedSandbox(db: SqlConnection, ws: string, expiry: Date) {
  // Table identifiers are a closed list in this module, never supplied by a request.
  async function insert(table: string, row: Record<string, unknown>) {
    const values = { workspace_id: ws, ...row };
    const keys = Object.keys(values);
    await db.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(values));
  }
  await insert('workspaces', { id: ws, name: 'Northlight Studio', is_demo: true, demo_expires_at: expiry.toISOString() });
  const harbor = randomUUID(), cedar = randomUUID();
  await insert('client_companies', { id: harbor, name: 'Harbor Coffee Roasters' });
  await insert('client_companies', { id: cedar, name: 'Cedar Line Furniture' });
  const ids = {} as Record<Persona, string>;
  for (const [persona, value] of Object.entries(personas)) {
    const id = randomUUID(); ids[persona as Persona] = id;
    await insert('members', { id, user_id: null, display_name: value.name, preferred_name: persona, roles: [value.role], client_company_id: persona === 'karim' ? harbor : persona === 'laith' ? cedar : null, ...(persona === 'ravi' ? { clickup_user_id: '42' } : {}) });
  }
  const deal = randomUUID(), run = randomUUID(), document = randomUUID(), version = randomUUID();
  await insert('deals', { id: deal, client_company_id: harbor, hubspot_deal_id: `sample_${deal}`, name: 'Harbor Coffee Roasters, growth retainer', amount: '18000', currency: 'AED', close_date: new Date().toISOString().slice(0, 10), owner_member_id: ids.omar, snapshot: JSON.stringify({ label: 'Sample data', fictional: true, product: 'Halal friendly coffee', hubspot_note: 'Signed scope PDF attached to the deal', clickup_folder_id: `sample_${ws}` }) });
  await insert('scope_documents', { id: document, deal_id: deal, source: 'hubspot_note', filename: 'Signed scope.pdf', page_count: 3, text: scopeTitles.join('. ') });
  await insert('scope_versions', { id: version, deal_id: deal, version: 1, status: 'accepted', source_document_id: document });
  const scopeItemIds = scopeTitles.map(() => randomUUID());
  for (let i = 0; i < scopeTitles.length; i++) await insert('scope_items', { id: scopeItemIds[i], scope_version_id: version, key: String(i + 1), title: scopeTitles[i], quantity: i === 2 ? 4 : 1, cadence: [2, 3, 7].includes(i) ? 'monthly' : 'once', source_page: Math.min(3, 1 + Math.floor(i / 3)) });
  for (const name of ['Blog posts', 'SEO report', 'Meta ads setup', 'Results dashboard']) await insert('line_items', { deal_id: deal, name });
  // Every sample run has a delivery lead (Imran, or Faisal for the finished one) and a won date, so each role sees its own work.
  const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
  const harborTasks = scopeTitles.map((title, index) => ({ scopeItem: index + 1, title, list: ['Setup', 'Content', 'Ads', 'Reporting'][Math.floor(index / 2)], owner: ids.ravi, due: new Date(Date.now() + 86400000 * (index + 1)).toISOString() }));
  await insert('runs', { id: run, deal_id: deal, run_key: `sample_${run}`, status: 'waiting_approval', scope_version_id: version, plan: JSON.stringify({ label: 'Sample data', tasks: harborTasks }), delivery_lead_id: ids.imran, won_at: daysAgo(2) });
  // Two inputs have waited more than 3 days, so the account manager and delivery lead each see an old input.
  for (const [i, label] of inputTitles.entries()) await insert('onboarding_inputs', { run_id: run, key: label.toLowerCase().replaceAll(' ', '_'), label, status: 'missing', requested_at: daysAgo(i < 2 ? 4 : 1) });
  await insert('findings', { run_id: run, kind: 'scope_mismatch', title: 'Four promised deliverables are missing from the CRM package', owner_member_id: ids.ravi, evidence: JSON.stringify([{ source: 'Signed scope page 2', quote: 'Brand style refresh', record_ref: 'The deal lists 4 of 8 sold items', rule: 'sold_not_in_crm' }]) });
  const cedarDeal = randomUUID();
  await insert('deals', { id: cedarDeal, client_company_id: cedar, hubspot_deal_id: `sample_${cedarDeal}`, name: 'Cedar Line Furniture', owner_member_id: ids.omar });
  const cedarRun = randomUUID();
  await insert('runs', { id: cedarRun, deal_id: cedarDeal, run_key: `sample_${cedarDeal}`, status: 'blocked', plan: JSON.stringify({ label: 'Sample data' }), delivery_lead_id: ids.imran, won_at: daysAgo(1) });
  for (const label of ['Product photos', 'Showroom opening hours']) await insert('onboarding_inputs', { run_id: cedarRun, key: label.toLowerCase().replaceAll(' ', '_'), label, status: 'missing', requested_at: daysAgo(1) });
  await insert('findings', { run_id: cedarRun, kind: 'no_owner', severity: 'block', status: 'open', title: 'Showroom launch video has no owner yet', owner_member_id: ids.omar, evidence: JSON.stringify([{ source: 'Signed scope page 2', quote: 'Showroom launch video', record_ref: 'No owner on the deal', rule: 'no_owner' }]) });
  // A finished run gives real won and ready dates and a won to ready time.
  const summit = randomUUID(), summitDeal = randomUUID();
  await insert('client_companies', { id: summit, name: 'Summit Trail Outfitters' });
  await insert('deals', { id: summitDeal, client_company_id: summit, hubspot_deal_id: `sample_${summitDeal}`, name: 'Summit Trail Outfitters, ads retainer', amount: '9000', currency: 'AED', owner_member_id: ids.omar });
  await insert('runs', { deal_id: summitDeal, run_key: `sample_${summitDeal}`, status: 'ready', plan: JSON.stringify({ label: 'Sample data' }), delivery_lead_id: ids.faisal, won_at: daysAgo(9), ready_at: daysAgo(8.5) });
  await seedSampleInbox(db, ws);
  await seedWaitingItems(db, insert, { ws, run, cedarRun, deal, version, ids, expiry, daysAgo, scopeItemIds, tasks: harborTasks });
}

type Insert = (table: string, row: Record<string, unknown>) => Promise<void>;
/** One waiting item for every person: the approval behind "Waiting for approval", fixes, a client email and a client review. */
async function seedWaitingItems(db: SqlConnection, insert: Insert, c: { ws: string; run: string; cedarRun: string; deal: string; version: string; ids: Record<Persona, string>; expiry: Date; daysAgo: (days: number) => string; scopeItemIds: string[]; tasks: { title: string; list: string; due: string }[] }) {
  const scope = (await db.query<{ id: string; version: number; items_hash: string | null; status: string }>('SELECT id,version,items_hash,status FROM scope_versions WHERE id=$1', [c.version])).rows[0];
  const scopeRef: InputRef = { system: 'scope', record_id: c.deal, version_marker: String(scope.version), hash: hash(scope) };
  const mailRefs: InputRef[] = sortedRefs([scopeRef]);
  const provision = provisionPayload({
    spaceId: demoClickUpSpace,
    folderName: 'Harbor Coffee Roasters',
    dealId: `sample_${c.deal}`,
    runRef: c.run.replaceAll('-', ''),
    planUrl: `https://soldline.local/runs/${c.run}`,
    tasks: c.tasks.map((task, index) => ({ key: String(index + 1), name: task.title, list: task.list, assignees: [42], due_date: Date.parse(task.due) })),
    missingLineItems: 4,
    ownerMemberId: c.ids.omar,
  });
  const approval = async (kind: 'provision' | 'client_email', payload: Payload, reversibility: 'reversible' | 'irreversible') => {
    const fields = exactApprovalFields(kind, payload, mailRefs, reversibility, c.expiry.toISOString());
    await insert('approvals', { run_id: c.run, ...fields });
  };
  await approval('provision', provision, 'reversible');
  await approval('client_email', { effects: [{ system: 'mail', location: 'Sample inbox', action: 'send_message', records: [{ id: 'sample_reminder', fields: {} }], amounts: {},
    message: { to: ['karim@harbor.example'], subject: 'Two items we still need from you', body: 'Hi Karim, we still need the brand guide files and Meta ad account access to start. Sample email, not sent.' } }] }, 'irreversible');
  const fix = (owner: Persona, run: string, title: string, reason: string) => insert('recovery_items', { run_id: run, kind: 'monitor', title, plain_reason: reason, owner_member_id: c.ids[owner], status: 'open', allowed_options: ['resolve_with_note'] });
  await fix('omar', c.run, 'Add the four missing line items in HubSpot', 'The signed scope has 8 deliverables but the deal has 4 line items.');
  await fix('faisal', c.cedarRun, 'Reconnect the sample inbox', 'Simulated: the sample inbox key was revoked, so reminders are paused. Sample data.');
  await fix('ravi', c.run, 'Upload the brand style draft again', 'The first upload did not reach ClickUp.');
  await insert('monitor_tasks', { run_id: c.run, task_id: 'sample_task_brand', scope_item_id: c.scopeItemIds[0], status: 'client review', review_since: c.daysAgo(1), due_at: c.daysAgo(-2), assignee_ids: ['42'], observed_at: new Date().toISOString() });
  await insert('monitor_tasks', { run_id: c.run, task_id: 'sample_task_blog', scope_item_id: c.scopeItemIds[2], status: 'in progress', due_at: c.daysAgo(-1), assignee_ids: ['42'], observed_at: new Date().toISOString() });
  await db.query("SELECT set_config('app.member_id',$1,true)", [c.ids.omar]);
  await db.query('SELECT audit_append($1,$2::jsonb)', [c.ws, JSON.stringify({ action: 'event_processed', outcome: 'succeeded', target_type: 'run', target_id: c.run })]);
  await db.query("SELECT set_config('app.member_id',$1,true)", [c.ids.imran]);
  await db.query('SELECT audit_append($1,$2::jsonb)', [c.ws, JSON.stringify({ action: 'approval_created', outcome: 'succeeded', target_type: 'run', target_id: c.run })]);
  await db.query("SELECT set_config('app.member_id','',true)");
}
