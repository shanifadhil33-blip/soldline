# Confirmed provider paths (fix plan A1, Oct 18 2026, Bilal)

Checked with curl against the live sandboxes (HubSpot developer test portal 247724060 na2, ClickUp workspace "Soldline Demo" 90141778913) and the vendor references. No secrets here. "Live" means a real call returned the status shown; "Docs" means confirmed in the vendor reference only.

## HubSpot (base https://api.hubapi.com, Bearer service key; date versioned 2026-03, v3 still answers the same)
| Use | Method and path | Result |
|---|---|---|
| Deal list, get, patch | GET/PATCH `/crm/objects/2026-03/deals[/{id}]` | Live 200 |
| Deal search | POST `/crm/objects/2026-03/deals/search` | Live 200 |
| Line items batch read | POST `/crm/objects/2026-03/line_items/batch/read` | Live 207 for unknown ids (results plus errors; treat 207 as success and read `errors`) |
| Notes batch read | POST `/crm/objects/2026-03/notes/batch/read` | Live 207, works with the service key although notes.read was not offered |
| Owners | GET `/crm/owners/2026-03?limit=&after=` | Live 200. `/crm/objects/2026-03/owners` is 400 "Unable to infer object type" |
| File signed URL | GET `/files/2026-03/files/{id}/signed-url?expirationSeconds=` | Live 200 on the uploaded seed file; keys expiresAt, extension, name, size, type, url |
| File search | GET `/files/2026-03/files/search?name=` | Live 200. HubSpot stores the name WITHOUT the extension ("harbor-scope"), and search lags a few seconds after upload |
| File upload | POST `/files/2026-03/files` multipart: file, fileName, folderPath, options JSON | Live 201, file id 412301100775 at /Soldline/harbor-scope.pdf (PRIVATE) |
| Search companies, contacts, line items, notes | POST `/crm/objects/2026-03/{type}/search` | Live 200 |
| Products search | POST `/crm/objects/2026-03/products/search` | Live 403: needs `e-commerce` and `crm.objects.products.read` |
| Create companies, contacts, line items, notes | POST `/crm/objects/2026-03/{type}` | Live 403 for companies: key lacks `crm.objects.companies.write` (same for contacts, line items, notes) |
| Default association | PUT `/crm/objects/2026-03/{fromType}/{fromId}/associations/default/{toType}/{toId}` | Docs (2026-03 reference). Batch: POST `/crm/associations/2026-03/{from}/{to}/batch/associate/default` |
| Association labels | GET `/crm/associations/2026-03/{from}/{to}/labels` | Live 200 |
| Association read with paging | POST `/crm/associations/2026-03/{from}/{to}/batch/read` (`after` per id) | Docs |
| Pipelines | GET `/crm/pipelines/2026-03/deals` | Live 200; won stage id `closedwon` in pipeline `default` |
| Account | GET `/account-info/v3/details` | Live 200: DEVELOPER_TEST, US/Eastern, na2 |

Defaults now in code: `HUBSPOT_CONFIRMED_PATHS` (src/server/integrations/hubspot.ts) and `SEED_PATHS` (scripts/lib/seed.ts).

## ClickUp (base https://api.clickup.com/api/v2, header `Authorization: pk_...` without Bearer)
| Use | Method and path | Result |
|---|---|---|
| Teams and members | GET `/team` (members are inside each team) | Live 200. `GET /team/{id}/member` is 404, fixed in ClickUpClient.listMembers |
| Spaces, folders, lists | GET `/team/{id}/space`, `/space/{id}/folder`, `/folder/{id}/list`, `/folder/{id}`, `/list/{id}` | Live 200 |
| Create folder, list | POST `/space/{id}/folder`, `/folder/{id}/list` | Live 200 (seed) |
| Create task | POST `/list/{id}/task` with markdown_content, time_estimate, tags | Live 200; the create response has NO markdown_description, read it back with `include_markdown_description=true` |
| List tasks | GET `/list/{id}/task?include_markdown_description=true&subtasks=true&page=` | Live 200, `last_page` present |
| Comment | POST `/task/{id}/comment` | Live 200; `id` is a NUMBER (entity schema already coerces) |
| Update task status | PUT `/task/{id}` | Live 400 for "in progress": lists in "Client delivery" only have `to do` and `complete` |
| Delete task | DELETE `/task/{id}` | Live 204, empty body |
| Webhook create, list, delete | POST `/team/{id}/webhook`, GET same, DELETE `/webhook/{id}` | Live 200; response `{id, webhook:{id, secret(64), health, ...}}` matches the code; test webhook deleted |
| Folder templates | none in v2 (`/space/{id}/folder_template` 404); task templates list empty | Soldline creates folder and lists directly, no template or readiness polling needed |

Space statuses needed by monitors: `to do`, `in progress`, `client review`, `complete`. ClickUp v2 has no endpoint to edit space statuses; add them once in the browser (Space settings, Statuses).

## Team inbox (adhil+bilal@mail.grokbot.com)
See fix-plan A2 "Team inbox". The address is a plus alias of the Grok Bot native inbox adhil@mail.grokbot.com. It is NOT an AgentMail inbox (the connected AgentMail org lists 0 inboxes) and there is no API key for it. The adapter paths match the AgentMail OpenAPI (`https://api.agentmail.to/v0/inboxes/{inbox_id}/messages|threads/{id}|drafts|drafts/{id}/send`, 401 without a key), with these mismatches to fix when a real AgentMail inbox exists:
- CreateDraftRequest has no `headers` field; use `client_id` for idempotency instead of a Message-ID header.
- List messages has no `message_id` filter; sent search must match `client_id` or headers from get message.
- List items carry `preview`, not `text`; read bodies with get message (`extracted_text` strips quoted replies).
- `inbox_id` is the inbox address itself; a plus alias is not an inbox id.
