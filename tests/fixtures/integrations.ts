export const deal = { id: 'deal1', properties: { dealname: 'Harbor Coffee Roasters, growth retainer', amount: '18000', hs_lastmodifieddate: '1000', soldline_delivery_status: 'waiting' }, associations: { notes: { results: [{ id: 'note1' }] }, line_items: { results: [{ id: 'line1' }] } } };
export const lineItem = { id: 'line1', properties: { name: 'Four blog posts a month', quantity: '4', price: '1000', hs_product_id: 'product1', hs_sku: 'blog', description: 'Monthly articles', hs_lastmodifieddate: '1000' } };
export const note = { id: 'note1', properties: { hs_note_body: 'Signed scope', hs_attachment_ids: 'file1', hs_timestamp: '1000' } };
export const task = { id: 'task1', name: 'Four blog posts a month', markdown_description: 'Soldline ref: SL-run1-blog', status: { status: 'open' } };
export const message = { message_id: 'message1', thread_id: 'thread1', to: ['karim@example.test'], subject: 'Scope confirmation', text: 'Please confirm the scope', timestamp: '2026-10-18T00:00:00Z' };
export const inboxAddress = 'adhil+bilal@mail.grokbot.com';
// Explicit local fixtures for paths absent from the research. These are never live defaults.
export const hubspotFixturePaths = { notes: '/fixtures/notes/batch/read', owners: '/fixtures/owners', fileSignedUrl: (id: string) => `/fixtures/files/${id}/signed` };
