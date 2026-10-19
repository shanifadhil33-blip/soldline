import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { createDatabase, fixture } from './helpers/pglite';
import { server } from './fixtures/http';
import { deal, lineItem, note, task, message, inboxAddress, hubspotFixturePaths } from './fixtures/integrations';
import { Connections, type Provider } from '../src/server/integrations/connections';
import { HubSpotClient } from '../src/server/integrations/hubspot';
import { ClickUpClient } from '../src/server/integrations/clickup';
import { AgentMailProvider, configureMailFromEnv } from '../src/server/integrations/mail';
import { NeedsReconnect, Retryable, RateLimited, ConnectionPaused, ProviderRejected } from '../src/server/integrations/errors';
import { encryptToken, decryptToken } from '../src/server/crypto';
let ctx: Awaited<ReturnType<typeof createDatabase>>;
const a = fixture(1), b = fixture(2), key = Buffer.alloc(32, 7).toString('base64');
const fakeToken = 'fake_private_token_934785';
let connections: Connections;
let hubspot: HubSpotClient, clickup: ClickUpClient, mail: AgentMailProvider;
const hub = 'https://api.hubapi.com', click = 'https://api.clickup.com/api/v2', mailBase = 'https://api.agentmail.to/v0';
const mailPath = `${mailBase}/inboxes/${encodeURIComponent(inboxAddress)}`;
beforeAll(async () => { ctx = await createDatabase(); }, 60000);
afterAll(async () => { await ctx?.db.close(); });
beforeEach(async () => {
  connections = new Connections(ctx.db, a.ws, a.admin, key);
  for (const provider of ['hubspot', 'clickup', 'mail'] as const) await connections.storeToken(provider, fakeToken, 'account1');
  await ctx.db.query('DELETE FROM rate_buckets');
  await ctx.db.query('UPDATE demo_faults SET fail_next=0');
  hubspot = new HubSpotClient({ connections }, hubspotFixturePaths);
  clickup = new ClickUpClient({ connections });
  mail = new AgentMailProvider({ connections, inbox: inboxAddress });
});
function respond(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, result: unknown, check?: (request: Request) => Promise<void> | void) {
  server.use(http[method](path, async ({ request }) => {
    expect(request.headers.get('Authorization')).toBe(path.startsWith(click) ? fakeToken : `Bearer ${fakeToken}`);
    expect(request.headers.get('X-Request-Id')).toMatch(/^[a-f0-9-]{36}$/);
    await check?.(request);
    return HttpResponse.json(result as Record<string, unknown>);
  }));
}
it('Encrypts tokens with random IVs and rejects tampering and bad versions', () => {
  const one = encryptToken(fakeToken, key), two = encryptToken(fakeToken, key);
  expect(one).not.toBe(two); expect(one.split(':')).toHaveLength(4);
  expect(Buffer.from(one.split(':')[1], 'base64')).toHaveLength(12);
  expect(decryptToken(one, key)).toBe(fakeToken);
  for (const bad of ['v2:' + one.slice(3), one.slice(0, -4) + 'AAAA', 'bad']) expect(() => decryptToken(bad, key)).toThrow('Stored token could not be opened');
  expect(() => encryptToken(fakeToken, 'bad')).toThrow('Token encryption key must be 32 bytes in base64');
});
it('Stores only ciphertext and never exposes credentials through health', async () => {
  const rows = await ctx.db.query('SELECT token_ciphertext FROM connections WHERE workspace_id=$1', [a.ws]);
  expect(JSON.stringify(rows.rows)).not.toContain(fakeToken);
  expect(await connections.health('hubspot')).toEqual({ status: 'connected', last_ok_at: null, last_error_code: null });
  expect(await connections.load('hubspot')).toMatchObject({ token: fakeToken });
});
it('Reads a deal with requested properties and associations', async () => {
  respond('get', `${hub}/crm/objects/2026-03/deals/deal1`, deal, request => {
    const url = new URL(request.url);
    expect(url.searchParams.get('associations')).toBe('line_items,companies,contacts,notes');
    expect(url.searchParams.get('properties')).toContain('soldline_delivery_status');
  });
  expect(await hubspot.getDeal('deal1')).toEqual(deal);
  expect((await connections.health('hubspot')).last_ok_at).not.toBeNull();
});
it('Searches modified deals and supports a paging cursor', async () => {
  respond('post', `${hub}/crm/objects/2026-03/deals/search`, { results: [deal] }, async request => {
    expect(await request.json()).toMatchObject({ after: 'next', filterGroups: [{ filters: [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: '1000' }] }] });
  });
  expect((await hubspot.searchDealsModifiedSince('1000', 'next')).results).toEqual([deal]);
});
it('Batch reads line items with the scope fields', async () => {
  respond('post', `${hub}/crm/objects/2026-03/line_items/batch/read`, { results: [lineItem] }, async request => {
    expect(await request.json()).toEqual({ inputs: [{ id: 'line1' }], properties: ['name','quantity','price','hs_product_id','hs_sku','description','hs_lastmodifieddate'] });
  });
  expect((await hubspot.batchReadLineItems(['line1'])).results).toEqual([lineItem]);
});
it('Reads deal note attachments through an explicitly configured batch path', async () => {
  respond('get', `${hub}/crm/objects/2026-03/deals/deal1`, deal);
  respond('post', `${hub}/fixtures/notes/batch/read`, { results: [note] }, async request => { expect(await request.json()).toMatchObject({ inputs: [{ id: 'note1' }], properties: ['hs_note_body','hs_attachment_ids','hs_timestamp'] }); });
  expect((await hubspot.listDealNotes('deal1')).results).toEqual([note]);
});
it('Reads a signed URL through an explicitly configured path', async () => {
  respond('get', `${hub}/fixtures/files/file1/signed`, { url: 'https://fixtures.soldline.test/scope.pdf' });
  expect((await hubspot.getFileSignedUrl('file1')).url).toContain('scope.pdf');
});
it('Reads owners through an explicitly configured path', async () => {
  respond('get', `${hub}/fixtures/owners`, { results: [{ id: 'owner1', email: 'bilal@example.test' }] }, request => { expect(new URL(request.url).searchParams.get('after')).toBe('next'); });
  expect((await hubspot.getOwners('next')).results[0].email).toBe('bilal@example.test');
});
it('Uses the confirmed HubSpot paths by default', async () => {
  respond('get', `${hub}/crm/owners/2026-03`, { results: [{ id: '1', email: 'owner@example.test' }] });
  expect((await new HubSpotClient({ connections }).getOwners()).results[0].email).toBe('owner@example.test');
});
it('Refuses unknown HubSpot paths without making requests', async () => {
  const client = new HubSpotClient({ connections }, {});
  await expect(client.listDealNotes('deal1')).rejects.toThrow('Provider path needs confirmation');
  expect(() => client.getOwners()).toThrow('Provider path needs confirmation');
  expect(() => client.getFileSignedUrl('file1')).toThrow('Provider path needs confirmation');
});
it('Checks the approval snapshot before patching deal properties', async () => {
  respond('get', `${hub}/crm/objects/2026-03/deals/deal1`, deal);
  respond('patch', `${hub}/crm/objects/2026-03/deals/deal1`, deal, async request => { expect(await request.json()).toEqual({ properties: { soldline_delivery_status: 'ready' } }); });
  expect((await hubspot.patchDealProperties('deal1', { soldline_delivery_status: 'ready' }, { modifiedAt: '1000', properties: { soldline_delivery_status: 'waiting' } })).id).toBe('deal1');
  for (const approved of [{ modifiedAt: '999', properties: {} }, { modifiedAt: '1000', properties: { soldline_delivery_status: 'changed' } }]) await expect(hubspot.patchDealProperties('deal1', { soldline_delivery_status: 'ready' }, approved)).rejects.toThrow('Deal changed since approval');
});
it('Lists ClickUp spaces', async () => { respond('get', `${click}/team/team1/space`, { spaces: [{ id: 'space1', name: 'Client delivery' }] }); expect((await clickup.listSpaces('team1')).spaces[0].id).toBe('space1'); });
it('Lists folders and lists for idempotent setup', async () => {
  respond('get', `${click}/space/space1/folder`, { folders: [{ id: 'folder1' }] }); respond('get', `${click}/folder/folder1/list`, { lists: [{ id: 'list1' }] });
  expect((await clickup.listFolders('space1')).folders[0].id).toBe('folder1'); expect((await clickup.listLists('folder1')).lists[0].id).toBe('list1');
});
it('Creates a ClickUp folder', async () => { respond('post', `${click}/space/space1/folder`, { id: 'folder1' }, async r => { expect(await r.json()).toEqual({ name: 'Retainer onboarding' }); }); expect((await clickup.createFolder('space1', 'Retainer onboarding')).id).toBe('folder1'); });
it('Creates a ClickUp list', async () => { respond('post', `${click}/folder/folder1/list`, { id: 'list1' }, async r => { expect(await r.json()).toEqual({ name: 'Content' }); }); expect((await clickup.createList('folder1', 'Content')).id).toBe('list1'); });
it('Creates a task with the reference marker and due date options', async () => {
  const input = { name: task.name, markdown_content: task.markdown_description, assignees: [123], due_date: 1000, time_estimate: 3600000, status: 'open', tags: ['scope'] };
  respond('post', `${click}/list/list1/task`, task, async r => { expect(await r.json()).toEqual({ ...input, due_date_time: false }); }); expect(await clickup.createTask('list1', input)).toEqual(task);
});
it('Reads tasks with markdown and subtasks on each page', async () => { respond('get', `${click}/list/list1/task`, { tasks: [task], last_page: true }, r => { expect(Object.fromEntries(new URL(r.url).searchParams)).toEqual({ include_markdown_description: 'true', subtasks: 'true', page: '2' }); }); expect((await clickup.getListTasks('list1', 2)).tasks).toEqual([task]); });
it('Updates a task', async () => { respond('put', `${click}/task/task1`, task, async r => { expect(await r.json()).toEqual({ status: 'complete', assignees: { add: [123] } }); }); expect(await clickup.updateTask('task1', { status: 'complete', assignees: { add: [123] } })).toEqual(task); });
it('Archives a task', async () => { respond('put', `${click}/task/task1`, task, async r => { expect(await r.json()).toEqual({ archived: true }); }); expect(await clickup.archiveTask('task1')).toEqual(task); });
it('Deletes a task including an empty response', async () => { server.use(http.delete(`${click}/task/task1`, () => new HttpResponse(null, { status: 204 }))); expect(await clickup.deleteTask('task1')).toBeUndefined(); });
it('Adds a task comment', async () => { respond('post', `${click}/task/task1/comment`, { id: 123 }, async r => { expect(await r.json()).toEqual({ comment_text: 'Scope confirmed', notify_all: false }); }); expect((await clickup.addComment('task1', 'Scope confirmed')).id).toBe('123'); });
it('Creates a webhook and stores its secret encrypted by webhook id', async () => {
  const input = { endpoint: 'https://fixtures.soldline.test/webhook', events: ['taskUpdated'], space_id: 'space1' };
  respond('post', `${click}/team/team1/webhook`, { id: 'webhook1', webhook: { secret: 'webhook_secret' } }, async r => { expect(await r.json()).toEqual(input); });
  const result = await clickup.createWebhook('team1', input); expect(decryptToken(result.secret_ciphertext, key)).toBe('webhook_secret');
  const rows = await ctx.db.query<{ webhook_secrets: Record<string, string> }>("SELECT webhook_secrets FROM connections WHERE workspace_id=$1 AND provider='clickup'", [a.ws]);
  expect(decryptToken(rows.rows[0].webhook_secrets.webhook1, key)).toBe('webhook_secret');
});
it('Lists members for owner mapping', async () => { respond('get', `${click}/team`, { teams: [{ id: 'team1', members: [{ user: { id: 123, username: 'Bilal', email: 'bilal@example.test' } }] }] }); expect((await clickup.listMembers('team1')).members[0].user.username).toBe('Bilal'); });
it('Reads the team inbox', async () => { respond('get', mailPath, { inbox_id: inboxAddress }); expect((await mail.getInbox()).inbox_id).toBe(inboxAddress); });
it('Lists messages since a cursor', async () => { respond('get', `${mailPath}/messages`, { messages: [message], next_page_token: 'next' }, r => { expect(new URL(r.url).searchParams.get('after')).toBe('cursor1'); }); expect((await mail.listMessagesSince('cursor1')).next_page_token).toBe('next'); });
it('Reads one message', async () => { respond('get', `${mailPath}/messages/message1`, message); expect(await mail.getMessage('message1')).toEqual(message); });
it('Reads one thread', async () => { respond('get', `${mailPath}/threads/thread1`, { thread_id: 'thread1', messages: [message] }); expect((await mail.getThread('thread1')).messages).toEqual([message]); });
it('Creates a reply draft', async () => { respond('post', `${mailPath}/drafts`, { draft_id: 'draft1' }, async r => { expect(await r.json()).toEqual({ to: message.to, subject: message.subject, text: message.text, in_reply_to: 'message1' }); }); expect((await mail.createDraft({ to: message.to, subject: message.subject, text: message.text, replyToMessageId: 'message1' })).draft_id).toBe('draft1'); });
it('Sends a draft', async () => { respond('post', `${mailPath}/drafts/draft1/send`, message); expect(await mail.sendDraft('draft1')).toEqual(message); });
it('Searches sent messages for duplicate detection', async () => { respond('get', `${mailPath}/messages`, { messages: [message] }, r => { expect(Object.fromEntries(new URL(r.url).searchParams)).toEqual({ labels: 'sent', to: 'karim@example.test', subject: message.subject, after: 'cursor1' }); }); expect((await mail.searchSent({ to: 'karim@example.test', subject: message.subject, since: 'cursor1' })).messages).toEqual([message]); });
const providers: Provider[] = ['hubspot', 'clickup', 'mail'];
function call(provider: Provider) { return provider === 'hubspot' ? hubspot.getDeal('deal1') : provider === 'clickup' ? clickup.listSpaces('team1') : mail.getInbox(); }
function url(provider: Provider) { return provider === 'hubspot' ? `${hub}/crm/objects/2026-03/deals/deal1` : provider === 'clickup' ? `${click}/team/team1/space` : mailPath; }
it.each(providers)('Redacts tokens in %s errors and audit records', async provider => {
  server.use(http.get(url(provider), () => HttpResponse.json({ message: fakeToken, token: fakeToken }, { status: 500 })));
  let failure: unknown;
  try { await call(provider); } catch (e) { failure = e; }
  expect(failure).toBeInstanceOf(Retryable);
  expect(String(failure)).not.toContain(fakeToken); expect(JSON.stringify(failure)).not.toContain(fakeToken);
  expect(JSON.stringify(failure, Object.getOwnPropertyNames(failure))).not.toContain(fakeToken);
  expect(JSON.stringify((await ctx.db.query('SELECT * FROM audit_log WHERE workspace_id=$1', [a.ws])).rows)).not.toContain(fakeToken);
});
it.each(providers.flatMap(p => [401, 403].map(code => [p, code] as const)))('Marks only %s as needing reconnect after %s and blocks further calls', async (provider, code) => {
  let count = 0; server.use(http.get(url(provider), () => { count++; return HttpResponse.json({ error: fakeToken }, { status: code }); }));
  await expect(call(provider)).rejects.toBeInstanceOf(NeedsReconnect); await expect(call(provider)).rejects.toBeInstanceOf(NeedsReconnect); expect(count).toBe(1);
  expect(await connections.health(provider)).toMatchObject({ status: 'needs_reconnect', last_error_code: String(code) });
  await connections.resume(provider); expect((await connections.health(provider)).status).toBe('needs_reconnect');
  for (const other of providers.filter(p => p !== provider)) expect((await connections.health(other)).status).toBe('connected');
  const audit = await ctx.db.query<{ after: Record<string, unknown>; request_id: string }>("SELECT after,request_id FROM audit_log WHERE workspace_id=$1 AND target_type=$2 AND action='connection_needs_reconnect' ORDER BY id DESC LIMIT 1", [a.ws, provider]);
  expect(audit.rows[0].request_id).toBeTruthy(); expect(audit.rows[0].after).toMatchObject({ code: String(code), request_id: audit.rows[0].request_id });
});
it('Pauses and resumes only the selected provider', async () => { await connections.pause('clickup'); await expect(clickup.listSpaces('team1')).rejects.toBeInstanceOf(ConnectionPaused); expect((await connections.health('mail')).status).toBe('connected'); await connections.resume('clickup'); expect((await connections.health('clickup')).status).toBe('connected'); });
it.each(['seconds', 'date', 'reset'] as const)('Waits for the %s rate reset then retries once', async kind => {
  let now = 1792281600000, count = 0;
  const sleep = vi.fn(async (ms: number) => { expect(ms).toBe(2000); now += ms; });
  const client = new ClickUpClient({ connections, now: () => now, sleep });
  server.use(http.get(`${click}/team/team1/space`, () => { count++; return count === 1 ? HttpResponse.json({}, { status: 429, headers: kind === 'seconds' ? { 'Retry-After': '2' } : kind === 'date' ? { 'Retry-After': new Date(now + 2000).toUTCString() } : { 'X-RateLimit-Reset': String(now / 1000 + 2) } }) : HttpResponse.json({ spaces: [] }); }));
  expect(await client.listSpaces('team1')).toEqual({ spaces: [] }); expect(count).toBe(2); expect(sleep).toHaveBeenCalledOnce();
});
it('Stops after the second 429 and returns retryable RateLimited', async () => {
  let count = 0; const sleep = vi.fn(async () => {});
  server.use(http.get(`${click}/team/team1/space`, () => { count++; return HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '0' } }); }));
  await expect(new ClickUpClient({ connections, sleep }).listSpaces('team1')).rejects.toBeInstanceOf(RateLimited); expect(count).toBe(2);
});
it('Does not guess a wait when reset headers are absent or invalid', async () => {
  let count = 0; server.use(http.get(`${click}/team/team1/space`, () => { count++; return HttpResponse.json({}, { status: 429, headers: { 'Retry-After': 'unknown' } }); }));
  await expect(clickup.listSpaces('team1')).rejects.toBeInstanceOf(RateLimited); expect(count).toBe(1);
});
it.each(providers)('Sanitizes network errors from %s', async provider => {
  server.use(http.get(url(provider), () => HttpResponse.error()));
  await expect(call(provider)).rejects.toBeInstanceOf(Retryable);
});
it('Rejects other provider failures and malformed success responses safely', async () => {
  server.use(http.get(url('clickup'), () => HttpResponse.json({ message: fakeToken }, { status: 400 })));
  await expect(call('clickup')).rejects.toBeInstanceOf(ProviderRejected);
  server.use(http.get(url('clickup'), () => HttpResponse.json({ token: fakeToken })));
  await expect(call('clickup')).rejects.toBeInstanceOf(Retryable);
});
it.each(['hubspot', 'clickup'] as const)('Uses a persistent %s bucket and refills at its provider rate', async provider => {
  const now = Date.now(), period = provider === 'hubspot' ? 10000 : 60000;
  const { bucketKey } = await connections.load(provider);
  for (let n = 0; n < 100; n++) expect(await connections.take(provider, bucketKey, now)).toBe(0);
  expect(await connections.take(provider, bucketKey, now)).toBe(period / 100);
  expect(await connections.take(provider, bucketKey, now + period / 100)).toBe(0);
  expect(await connections.take(provider, bucketKey, now + period)).toBe(0);
});
it('Shares account buckets for HubSpot and token buckets for ClickUp across workspaces', async () => {
  const other = new Connections(ctx.db, b.ws, b.admin, key);
  for (const p of ['hubspot', 'clickup'] as const) {
    await other.storeToken(p, fakeToken, 'account1');
    const one = await connections.load(p), two = await other.load(p); expect(one.bucketKey).toBe(two.bucketKey);
    await connections.take(p, one.bucketKey, 1000); await other.take(p, two.bucketKey, 1000);
    expect((await ctx.db.query<{ tokens: string }>('SELECT tokens FROM rate_buckets WHERE provider=$1 AND bucket_key=$2', [p, one.bucketKey])).rows[0].tokens).toBe('98');
  }
  await other.storeToken('clickup', 'different_token', 'account1'); expect((await connections.load('clickup')).bucketKey).not.toBe((await other.load('clickup')).bucketKey);
});
it('Rejects exhausted local buckets before making HTTP requests', async () => {
  const { bucketKey } = await connections.load('clickup');
  await ctx.db.query("INSERT INTO rate_buckets VALUES ($1,'clickup',$2,0,$3)", [a.ws, bucketKey, new Date().toISOString()]);
  await expect(clickup.listSpaces('team1')).rejects.toBeInstanceOf(RateLimited);
});
it('Consumes exactly three demo outages and then calls the fixture', async () => {
  await ctx.db.query('UPDATE workspaces SET is_demo=true WHERE id=$1', [a.ws]);
  try {
    await ctx.db.query("UPDATE demo_faults SET fail_next=3,mode='outage' WHERE workspace_id=$1 AND provider='clickup'", [a.ws]);
    let count = 0; server.use(http.get(url('clickup'), () => { count++; return HttpResponse.json({ spaces: [] }); }));
    for (let n = 0; n < 3; n++) await expect(clickup.listSpaces('team1')).rejects.toThrow('simulated outage');
    expect(count).toBe(0); await clickup.listSpaces('team1'); expect(count).toBe(1);
    expect((await ctx.db.query<{ fail_next: number }>("SELECT fail_next FROM demo_faults WHERE workspace_id=$1 AND provider='clickup'", [a.ws])).rows[0].fail_next).toBe(0);
  } finally { await ctx.db.query('UPDATE workspaces SET is_demo=false WHERE id=$1', [a.ws]); }
});
it('Simulates a revoked inbox key only for demo workspaces', async () => {
  await ctx.db.query('UPDATE workspaces SET is_demo=true WHERE id=$1', [a.ws]);
  try {
    await ctx.db.query("INSERT INTO demo_faults VALUES ($1,'mail',1,'revoked') ON CONFLICT (workspace_id,provider) DO UPDATE SET fail_next=1,mode='revoked'", [a.ws]);
    await expect(mail.getInbox()).rejects.toBeInstanceOf(NeedsReconnect); expect((await connections.health('mail')).last_error_code).toBe('simulated_revoked'); expect((await connections.health('clickup')).status).toBe('connected');
  } finally { await ctx.db.query('UPDATE workspaces SET is_demo=false WHERE id=$1', [a.ws]); }
});
it.each(['outage', 'revoked'])('Never activates %s faults for a real workspace', async mode => {
  await ctx.db.query("INSERT INTO demo_faults VALUES ($1,'mail',3,$2) ON CONFLICT (workspace_id,provider) DO UPDATE SET fail_next=3,mode=$2", [a.ws, mode]);
  respond('get', mailPath, { inbox_id: inboxAddress }); await mail.getInbox();
  expect((await ctx.db.query<{ fail_next: number }>("SELECT fail_next FROM demo_faults WHERE workspace_id=$1 AND provider='mail'", [a.ws])).rows[0].fail_next).toBe(3);
});
it('Refuses credential changes by members without admin permission', async () => {
  const manager = new Connections(ctx.db, a.ws, a.manager, key);
  await expect(manager.storeToken('mail', fakeToken, 'account1')).rejects.toThrow('Connection access refused');
  await expect(manager.pause('mail')).rejects.toThrow('Connection access refused');
  const outsider = new Connections(ctx.db, a.ws, b.admin, key);
  await expect(outsider.load('mail')).rejects.toThrow('Workspace access refused');
});

it('Configures the mail adapter from process style settings and encrypts its key', async () => {
  const adapter = await configureMailFromEnv(connections, { MAIL_PROVIDER: 'agentmail', MAIL_API_KEY: fakeToken, MAIL_INBOX_ADDRESS: inboxAddress, MAIL_API_BASE: 'https://fixtures.soldline.test/mail' });
  respond('get', `https://fixtures.soldline.test/mail/inboxes/${encodeURIComponent(inboxAddress)}`, { inbox_id: inboxAddress });
  expect((await adapter.getInbox()).inbox_id).toBe(inboxAddress);
  await expect(configureMailFromEnv(connections, {})).rejects.toThrow('Mail key and inbox address are required');
});
it('Does not consume ClickUp demo outages in a real workspace', async () => {
  await ctx.db.query("UPDATE demo_faults SET fail_next=3,mode='outage' WHERE workspace_id=$1 AND provider='clickup'", [a.ws]);
  respond('get', url('clickup'), { spaces: [] }); await clickup.listSpaces('team1');
  expect((await ctx.db.query<{ fail_next: number }>("SELECT fail_next FROM demo_faults WHERE workspace_id=$1 AND provider='clickup'", [a.ws])).rows[0].fail_next).toBe(3);
});

it.each(providers)('Removes token details from a thrown %s transport error and its audit row', async provider => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error(fakeToken));
  let error: Error | undefined;
  try { await call(provider); } catch (failure) { error = failure as Error; } finally { fetchMock.mockRestore(); }
  expect(error).toBeInstanceOf(Retryable);
  expect(error?.message).not.toContain(fakeToken);
  expect(JSON.stringify(error)).not.toContain(fakeToken);
  expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(fakeToken);
  expect(JSON.stringify((await ctx.db.query('SELECT * FROM audit_log WHERE workspace_id=$1', [a.ws])).rows)).not.toContain(fakeToken);
});
it('Refuses a write whose changed property is absent from the approval snapshot', async () => {
  respond('get', `${hub}/crm/objects/2026-03/deals/deal1`, deal);
  await expect(hubspot.patchDealProperties('deal1', { soldline_delivery_status: 'ready' }, { modifiedAt: '1000', properties: {} })).rejects.toThrow('Deal changed since approval');
});
it.each(providers)('Retries a rate response once for %s with a fresh request id', async provider => {
  let count = 0; const ids: string[] = [];
  server.use(http.get(url(provider), ({ request }) => {
    ids.push(request.headers.get('X-Request-Id')!); count++;
    if (count === 1) return HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '0' } });
    return HttpResponse.json(provider === 'hubspot' ? deal : provider === 'clickup' ? { spaces: [] } : { inbox_id: inboxAddress });
  }));
  await call(provider); expect(count).toBe(2); expect(new Set(ids).size).toBe(2);
});
