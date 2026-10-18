import { randomUUID } from 'node:crypto';
import type { SqlConnection } from '../db/withMember';
import type { Role } from '../permissions';
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
    await insert('members', { id, user_id: null, display_name: value.name, preferred_name: persona, roles: [value.role], client_company_id: persona === 'karim' ? harbor : persona === 'laith' ? cedar : null });
  }
  const deal = randomUUID(), run = randomUUID(), document = randomUUID(), version = randomUUID();
  await insert('deals', { id: deal, client_company_id: harbor, hubspot_deal_id: `sample_${deal}`, name: 'Harbor Coffee Roasters, growth retainer', amount: '18000', currency: 'AED', close_date: new Date().toISOString().slice(0, 10), owner_member_id: ids.omar, snapshot: JSON.stringify({ label: 'Sample data', fictional: true, product: 'Halal friendly coffee', hubspot_note: 'Signed scope PDF attached to the deal', clickup_folder_id: `sample_${ws}` }) });
  await insert('scope_documents', { id: document, deal_id: deal, source: 'hubspot_note', filename: 'Signed scope.pdf', page_count: 3, text: scopeTitles.join('. ') });
  await insert('scope_versions', { id: version, deal_id: deal, version: 1, status: 'accepted', source_document_id: document });
  for (let i = 0; i < scopeTitles.length; i++) await insert('scope_items', { scope_version_id: version, key: String(i + 1), title: scopeTitles[i], quantity: i === 2 ? 4 : 1, cadence: [2, 3, 7].includes(i) ? 'monthly' : 'once', source_page: Math.min(3, 1 + Math.floor(i / 3)) });
  for (const name of ['Blog posts', 'SEO report', 'Meta ads setup', 'Results dashboard']) await insert('line_items', { deal_id: deal, name });
  await insert('runs', { id: run, deal_id: deal, run_key: `sample_${run}`, status: 'waiting_approval', scope_version_id: version, plan: JSON.stringify({ label: 'Sample data' }) });
  for (const label of inputTitles) await insert('onboarding_inputs', { run_id: run, key: label.toLowerCase().replaceAll(' ', '_'), label, status: 'missing' });
  await insert('findings', { run_id: run, kind: 'scope_mismatch', title: 'Four promised deliverables are missing from the CRM package', owner_member_id: ids.ravi });
  const cedarDeal = randomUUID();
  await insert('deals', { id: cedarDeal, client_company_id: cedar, hubspot_deal_id: `sample_${cedarDeal}`, name: 'Cedar Line Furniture', owner_member_id: ids.omar });
  await insert('runs', { deal_id: cedarDeal, run_key: `sample_${cedarDeal}`, status: 'received', plan: JSON.stringify({ label: 'Sample data' }) });
}
