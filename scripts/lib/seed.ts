import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
export type SeedEnv = Record<string, string | undefined>;
export interface SeedEntity { id: string; name?: string; properties?: Record<string, string> }
// Unknown HubSpot endpoints have no live default. Bilal supplies confirmed paths.
export const SEED_PATHS = {
  hubspot: 'https://api.hubapi.com', clickup: 'https://api.clickup.com/api/v2',
  objects: '/crm/objects/2026-03', filesSearch: undefined, filesUpload: undefined,
  notesSearch: undefined, notesCreate: undefined, association: undefined,
} as const;
export function requireSeed(env: SeedEnv, provider: 'HUBSPOT' | 'CLICKUP'): string {
  if (env.SEED_CONFIRM !== 'yes') throw new Error('Set SEED_CONFIRM to yes before running this script');
  const token = env[`${provider}_ACCESS_TOKEN`];
  if (!token) throw new Error('Provider access token is required');
  return token;
}
function confirmed(env: SeedEnv, name: string): string {
  const path = env[name];
  if (!path || !path.startsWith('/') || path.startsWith('//') || /[?#]/.test(path)) throw new Error(`Confirm ${name} before running this script`);
  return path;
}
function client(base: string, token: string, bearer: boolean) {
  return async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const isForm = body instanceof FormData;
    let response: Response;
    try {
      response = await fetch(base + path, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'X-Request-Id': randomUUID(), Authorization: bearer ? `Bearer ${token}` : token, ...(isForm ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
    } catch { throw new Error('Seed request failed'); }
    if (!response.ok) throw new Error(`Seed request refused with status ${response.status}`);
    try { return (response.status === 204 ? undefined : await response.json()) as T; }
    catch { throw new Error('Seed response could not be read'); }
  };
}
export async function seedClickUp(env: SeedEnv): Promise<Record<string, string>> {
  const token = requireSeed(env, 'CLICKUP');
  const request = client(SEED_PATHS.clickup, token, false);
  const team = '90141778913', space = '90149400327';
  const spaces = await request<{ spaces: SeedEntity[] }>('GET', `/team/${team}/space`);
  if (!spaces.spaces.some(s => s.id === space && s.name === 'Client delivery')) throw new Error('Expected sandbox space was not found');
  const folders = await request<{ folders: SeedEntity[] }>('GET', `/space/${space}/folder`);
  const folder = folders.folders.find(f => f.name === 'Retainer onboarding') ?? await request<SeedEntity>('POST', `/space/${space}/folder`, { name: 'Retainer onboarding' });
  const lists = await request<{ lists: SeedEntity[] }>('GET', `/folder/${encodeURIComponent(folder.id)}/list`);
  const ids: Record<string, string> = { folder: folder.id };
  for (const name of ['Setup', 'Content', 'Ads', 'Reporting']) {
    const list = lists.lists.find(l => l.name === name) ?? await request<SeedEntity>('POST', `/folder/${encodeURIComponent(folder.id)}/list`, { name });
    ids[name] = list.id;
  }
  return ids;
}
export async function seedHubSpot(env: SeedEnv): Promise<Record<string, string>> {
  const token = requireSeed(env, 'HUBSPOT');
  // Validate all unknown paths before the first provider request or write.
  const filesSearch = confirmed(env, 'HUBSPOT_FILES_SEARCH_PATH');
  const filesUpload = confirmed(env, 'HUBSPOT_FILES_UPLOAD_PATH');
  const notesSearch = confirmed(env, 'HUBSPOT_NOTES_SEARCH_PATH');
  const notesCreate = confirmed(env, 'HUBSPOT_NOTES_CREATE_PATH');
  const association = confirmed(env, 'HUBSPOT_ASSOCIATION_PATH');
  if (!['{fromType}', '{fromId}', '{toType}', '{toId}'].every(key => association.includes(key))) throw new Error('Association path needs all four placeholders');
  const stage = env.HUBSPOT_SEED_DEAL_STAGE;
  if (!stage) throw new Error('Sandbox deal stage is required');
  const request = client(SEED_PATHS.hubspot, token, true);
  async function ensure(type: string, properties: Record<string, string>, filters: Record<string, string> = properties, paths?: { search: string; create: string }) {
    const root = `${SEED_PATHS.objects}/${type}`;
    const found = await request<{ results: SeedEntity[] }>('POST', paths?.search ?? root + '/search', { filterGroups: [{ filters: Object.entries(filters).map(([propertyName, value]) => ({ propertyName, operator: 'EQ', value })) }], limit: 100 });
    return found.results[0] ?? request<SeedEntity>('POST', paths?.create ?? root, { properties });
  }
  async function link(fromType: string, fromId: string, toType: string, toId: string) {
    const values: Record<string, string> = { fromType, fromId, toType, toId };
    const path = association.replace(/\{(fromType|fromId|toType|toId)\}/g, (_, key: string) => encodeURIComponent(values[key]));
    await request('PUT', path, {});
  }
  const ids: Record<string, string> = {};
  for (const name of ['Harbor Coffee Roasters', 'Cedar Line Furniture']) ids[name] = (await ensure('companies', { name })).id;
  for (const [firstname, lastname, company] of [['Karim', 'Nasser', 'Harbor Coffee Roasters'], ['Laith', 'Saeed', 'Cedar Line Furniture']]) {
    const contact = await ensure('contacts', { firstname, lastname }); ids[firstname] = contact.id;
    await link('contacts', contact.id, 'companies', ids[company]);
  }
  const dealName = 'Harbor Coffee Roasters, growth retainer';
  const deal = await ensure('deals', { dealname: dealName, amount: '18000', hs_currency_code: 'AED', dealstage: stage }, { dealname: dealName }); ids.deal = deal.id;
  await link('deals', deal.id, 'companies', ids['Harbor Coffee Roasters']);
  await link('deals', deal.id, 'contacts', ids.Karim);
  const items = [
    { name: 'Four blog posts a month', quantity: '4', price: '1000' },
    { name: 'Monthly SEO report', quantity: '1', price: '4000' },
    { name: 'Meta ads setup', quantity: '1', price: '5000' },
    { name: 'Monthly results dashboard', quantity: '1', price: '5000' },
  ];
  for (const item of items) {
    const product = await ensure('products', { name: item.name, price: item.price }, { name: item.name }); ids[`Product ${item.name}`] = product.id;
    // Include a stable deal reference in the name search so reruns adopt only this seed line item.
    const line = await ensure('line_items', { ...item, hs_product_id: product.id, description: `Soldline seed ${dealName}` }, { name: item.name, hs_product_id: product.id, description: `Soldline seed ${dealName}` });
    ids[`Line item ${item.name}`] = line.id; await link('deals', deal.id, 'line_items', line.id);
  }
  const filename = 'harbor-scope.pdf';
  const files = await request<{ results: SeedEntity[] }>('GET', filesSearch + '?' + new URLSearchParams({ name: filename }));
  let file = files.results[0];
  if (!file) {
    const pdf = await readFile(new URL('../../tests/fixtures/harbor-scope.pdf', import.meta.url));
    const form = new FormData(); form.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), filename);
    form.append('fileName', filename); form.append('folderPath', '/Soldline'); form.append('options', JSON.stringify({ access: 'PRIVATE', overwrite: false, duplicateValidationStrategy: 'RETURN_EXISTING', duplicateValidationScope: 'EXACT_FOLDER' }));
    file = await request<SeedEntity>('POST', filesUpload, form);
  }
  ids.file = file.id;
  const body = 'Soldline signed scope for Harbor Coffee Roasters, growth retainer';
  const note = await ensure('notes', { hs_note_body: body, hs_attachment_ids: file.id, hs_timestamp: '2026-10-18T00:00:00Z' }, { hs_note_body: body }, { search: notesSearch, create: notesCreate });
  ids.note = note.id; await link('notes', note.id, 'deals', deal.id);
  return ids;
}
