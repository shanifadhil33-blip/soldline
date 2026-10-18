import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './fixtures/http';
// Entry scripts are never executed. Only their shared logic runs against MSW.
import { requireSeed, seedClickUp, seedHubSpot } from '../scripts/lib/seed';
it('Requires explicit confirmation and a process token before any request', async () => {
  expect(() => requireSeed({}, 'HUBSPOT')).toThrow('Set SEED_CONFIRM');
  await expect(seedClickUp({ SEED_CONFIRM: 'no', CLICKUP_ACCESS_TOKEN: 'fake' })).rejects.toThrow('Set SEED_CONFIRM');
  await expect(seedHubSpot({ SEED_CONFIRM: 'yes' })).rejects.toThrow('Provider access token is required');
  await expect(seedHubSpot({ SEED_CONFIRM: 'yes', HUBSPOT_ACCESS_TOKEN: 'fake' })).rejects.toThrow('Confirm HUBSPOT_FILES_SEARCH_PATH');
});
it('Creates the sandbox folder and four lists once across repeated fixture runs', async () => {
  const folders: { id: string; name: string }[] = [], lists: { id: string; name: string }[] = [];
  let creates = 0;
  const base = 'https://api.clickup.com/api/v2';
  server.use(
    http.get(`${base}/team/90141778913/space`, () => HttpResponse.json({ spaces: [{ id: '90149400327', name: 'Client delivery' }] })),
    http.get(`${base}/space/90149400327/folder`, () => HttpResponse.json({ folders })),
    http.post(`${base}/space/90149400327/folder`, async ({ request }) => { expect(request.headers.get('Authorization')).toBe('fake'); const row = { id: 'folder1', ...await request.json() as { name: string } }; folders.push(row); creates++; return HttpResponse.json(row); }),
    http.get(`${base}/folder/folder1/list`, () => HttpResponse.json({ lists })),
    http.post(`${base}/folder/folder1/list`, async ({ request }) => { const row = { id: String(lists.length + 1), ...await request.json() as { name: string } }; lists.push(row); creates++; return HttpResponse.json(row); }),
  );
  const env = { SEED_CONFIRM: 'yes', CLICKUP_ACCESS_TOKEN: 'fake' };
  const first = await seedClickUp(env), second = await seedClickUp(env);
  expect(first).toEqual(second); expect(creates).toBe(5); expect(lists.map(l => l.name)).toEqual(['Setup','Content','Ads','Reporting']);
});
it('Creates companies, contacts, products, four line items and a scope note once in fixtures', async () => {
  const base = 'https://api.hubapi.com';
  const objects: Record<string, { id: string; properties: Record<string, string> }[]> = {};
  let creates = 0, uploads = 0;
  const associations = new Set<string>();
  const files: { id: string }[] = [];
  const env = { SEED_CONFIRM: 'yes', HUBSPOT_ACCESS_TOKEN: 'fake_secret', HUBSPOT_SEED_DEAL_STAGE: 'closedwon', HUBSPOT_FILES_SEARCH_PATH: '/fixtures/files/search', HUBSPOT_FILES_UPLOAD_PATH: '/fixtures/files', HUBSPOT_NOTES_SEARCH_PATH: '/crm/objects/2026-03/notes/search', HUBSPOT_NOTES_CREATE_PATH: '/crm/objects/2026-03/notes', HUBSPOT_ASSOCIATION_PATH: '/fixtures/associations/{fromType}/{fromId}/{toType}/{toId}' };
  server.use(
    http.post(`${base}/crm/objects/2026-03/:type/search`, async ({ params, request }) => {
      expect(request.headers.get('Authorization')).toBe('Bearer fake_secret');
      const body = await request.json() as { filterGroups: { filters: { propertyName: string; value: string }[] }[] };
      return HttpResponse.json({ results: (objects[String(params.type)] ?? []).filter(row => body.filterGroups[0].filters.every(f => row.properties[f.propertyName] === f.value)) });
    }),
    http.post(`${base}/crm/objects/2026-03/:type`, async ({ params, request }) => {
      const type = String(params.type); objects[type] ??= [];
      const row = { id: String(++creates), ...await request.json() as { properties: Record<string, string> } }; objects[type].push(row); return HttpResponse.json(row);
    }),
    http.put(`${base}/fixtures/associations/:fromType/:fromId/:toType/:toId`, ({ request }) => { associations.add(request.url); return HttpResponse.json({}); }),
    http.get(`${base}/fixtures/files/search`, ({ request }) => { expect(new URL(request.url).searchParams.get('name')).toBe('harbor-scope.pdf'); return HttpResponse.json({ results: files }); }),
    http.post(`${base}/fixtures/files`, async ({ request }) => {
      const form = await request.formData(); const file = form.get('file') as File;
      expect(file.type).toBe('application/pdf'); expect(file.size).toBeGreaterThan(1000);
      uploads++; const row = { id: 'file1' }; files.push(row); return HttpResponse.json(row);
    }),
  );
  const first = await seedHubSpot(env), links = associations.size;
  const second = await seedHubSpot(env);
  expect(second).toEqual(first); expect(creates).toBe(14); expect(uploads).toBe(1); expect(associations.size).toBe(links);
  expect(objects.companies.map(c => c.properties.name)).toEqual(['Harbor Coffee Roasters','Cedar Line Furniture']);
  expect(objects.contacts.map(c => c.properties.firstname)).toEqual(['Karim','Laith']);
  expect(objects.deals[0].properties).toMatchObject({ dealname: 'Harbor Coffee Roasters, growth retainer', amount: '18000', hs_currency_code: 'AED' });
  expect(objects.line_items).toHaveLength(4); expect(objects.line_items.reduce((sum, item) => sum + Number(item.properties.quantity) * Number(item.properties.price), 0)).toBe(18000);
  expect(objects.notes[0].properties.hs_attachment_ids).toBe('file1');
});
it('Keeps seed failures free of provider response bodies and tokens', async () => {
  server.use(http.get('https://api.clickup.com/api/v2/team/90141778913/space', () => HttpResponse.json({ token: 'fake_secret' }, { status: 401 })));
  const error = await seedClickUp({ SEED_CONFIRM: 'yes', CLICKUP_ACCESS_TOKEN: 'fake_secret' }).catch(e => e);
  expect(String(error)).not.toContain('fake_secret'); expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain('fake_secret');
});
it('Provides a three page PDF with eight numbered deliverables on page two', async () => {
  const bytes = new Uint8Array(await readFile('tests/fixtures/harbor-scope.pdf'));
  const document = await PDFDocument.load(bytes);
  expect(document.getPageCount()).toBe(3);
  // The generated fixture uses Helvetica with plain ASCII text. Decode the actual
  // page text operators so these checks verify the saved PDF on Node 20 and 22.
  const text = document.getPages().map(page => {
    const contents = page.node.Contents();
    if (!(contents instanceof PDFArray)) throw new Error('PDF page has no content streams');
    return contents.asArray().map(ref => {
      const stream = document.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) throw new Error('PDF page content is not a stream');
      const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
      const strings = [...operators.matchAll(/<([a-f0-9]+)> Tj/gi)];
      return strings.map(match => Buffer.from(match[1], 'hex').toString('latin1')).join(' ');
    }).join(' ');
  });
  expect(text[1]).toContain('Deliverables');
  for (const title of ['1 brand style refresh','2 website landing page','3 four blog posts a month','4 monthly SEO report','5 Meta ads setup','6 Google Ads setup','7 email newsletter template','8 monthly results dashboard']) expect(text[1]).toContain(title);
  expect(text.join(' ')).not.toMatch(/[-\u2013\u2014&]/);
  expect(text[2]).toContain('Karim Nasser'); expect(text[2]).toContain('Bilal');
});
