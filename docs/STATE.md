# Soldline

## Done

P1 app scaffold with one landing placeholder, English and Arabic message skeletons, design tokens, strict TypeScript, HTTP fixtures and a gate for lint, types, tests and production build. Playwright lives in a separate package under e2e. The final gate passed all 39 tests and the production build. The deliberate test failure returned 1 and the restored gate returned 0. See verification.md for evidence.

P2 database schema now contains all 27 app tables with generated Drizzle SQL, workspace foreign keys, enabled and forced row security, private member records, company access and contributor run access. Manual SQL creates the app role, fixed search path helpers and a locked audit chain. Local PGlite fixtures exercise migrations and policy removal. The migration runner reads DATABASE_URL_OWNER only when explicitly invoked.

P3 adds Auth.js v5 Google sign in with database sessions and the Drizzle adapter on the P2 tables. Branded sign in and error pages use the shared tokens. Six demo personas start isolated six hour sandboxes through a signed browser cookie. Repeat starts and persona switches reuse the sandbox. At most 60 remain live, with the oldest expired and exactly one cleanup job queued for its sample ClickUp folder and HubSpot deal.

The single permission matrix covers all 50 role and action cells, role unions, requester exclusion, company access, task access and scope acceptance quorum. Member routes resolve sessions, set transaction member identity and record denied actions before returning 403. The demo plan approval route records only an allowed audit event. P7 owns the real approvals engine.

P3 verification passes 215 tests across 16 files, including a complete Google OAuth callback through MSW fixtures and PGlite. The gate passes lint, types, tests and production build with exit code 0. See docs/P3.md for files, decisions and verification limits.

P4 adds typed HubSpot and ClickUp clients and the AgentMail team inbox adapter. Tokens use versioned AES 256 GCM encryption with random 12 byte IVs. Provider health commits in short server transactions, independent of outbound failures. A 401 or 403 marks only that provider as needs_reconnect and blocks further calls until an admin saves a new credential. Pausing and resuming cannot clear a reconnect requirement. Webhook secrets are encrypted and stored by webhook id.

Postgres token buckets share HubSpot limits by account and ClickUp limits by token fingerprint across workspaces. The new rate_buckets and demo_faults tables have enabled and forced row security and the same restrictive workspace and staff policies as P2. The app role has no direct writes to either table. Demo faults decrement atomically and only when the workspace is a demo. Every outbound client attempt has a fresh request id in audit details. Provider bodies, tokens and raw network exceptions never enter audit or public errors.

The seed entry scripts require SEED_CONFIRM=yes and process credentials. Their shared logic is covered through MSW fixtures for repeated setup without duplicate objects. They were not run. The three page signed sample PDF is generated from the scope fixture and saved for P6. Page two contains all eight numbered deliverables.

P4 verification passes 290 tests across 18 files. The full gate passes lint, types, tests and production build with exit code 0 using local cached font fixtures. See docs/P4.md for files and verification limits.

P5 adds signed HubSpot and ClickUp webhooks, durable event receipts, dedupe, replay and a leased job queue. HubSpot signatures cover the method, full URI, raw body and timestamp with a five minute window. ClickUp verifies the raw body against encrypted secrets before parsing JSON. Invalid signatures cannot create events or jobs. The webhook response registers the worker through after once the receipt commits.

Won stage changes enqueue one analyse job per deal. Run keys include the deal and scope hash, and conflicting inserts return the existing run. Missing local deals are imported through the provider fixture contract. Runs record their delivery lead and a plus address when a mail inbox is configured. Runs stay received for P6 analysis.

Jobs claim through FOR UPDATE SKIP LOCKED with two minute leases and completion tokens. Five attempts use the decided backoff and then create one recovery item. Expired fifth leases go directly to recovery. Tick requires its bearer secret, queues each connected mail inbox and HubSpot connection by five minute bucket, and processes at most twenty jobs within a shared request time budget. Worker HTTP reads abort at that deadline. Mail cursors belong to connections and unrelated messages are never stored. Reconciliation commits its cursor only after all pages succeed.

Replay uses the stored raw event and the same event handler with replay provenance in audit details. Admins and delivery leads may replay, and demo Omar is also allowed. Replaying a completed won event returns zero new actions. System work uses private named owner operations and a separate audit append that the app role cannot execute. Actor types are webhook, schedule or system.

The GitHub tick workflow and the Vercel daily cron are present. Daily queues reconciliation and a HubSpot search for keep alive. P5 verification passes 333 tests across 20 files. The final gate passes lint, types, tests and production build with exit code 0. See docs/P5.md for files, signature proof, setup and verification limits.

## Next

P6 scope document parsing and analysis. Continue using local fixtures until live service work is explicitly requested.

## Decisions

Node 22 is the target. This machine runs Node 20.19.2. The package engine accepts Node >=20.9 as requested. Next.js 16 itself requires Node >=20.9.

Use pnpm, Next.js 16 App Router, TypeScript strict and Tailwind 4. White background, Charcoal Ink text, Deep Muted Teal for primary buttons and active state only, Dusty Camel for structural borders and neutral borders elsewhere. Spacing is 4, 8, 12, 16 and 24 pixels. Radius is 6 or 8 pixels.

Inter uses weights 400 and 600. IBM Plex Sans Arabic uses 400 only with synthetic weight disabled. Both use next/font/google and are downloaded at build time.

Email goes through the team inbox adapter, not Gmail (Adhil, Oct 18 2026).

The gate stops at the first failed step and preserves its exit code. Detector tests cover visible copy and prohibited visual patterns. HTTP tests reject requests without a fixture.

The app role has no table ownership and no row security bypass. It receives table reads under policies and audit_append execution. Only onboarding input insert and update are granted to the app role, with restrictive write policies and the existing workspace and company guards. All other direct writes remain denied, including every audit table mutation. Migration and fixture owners need row security bypass for helper lookups and fixture setup. Production requests must use soldline_app rather than the migration owner.

Every workspace record repeats its own id as workspace_id. Auth records are workspace scoped and use composite references to prevent links across workspaces. Thread and message fields fill in the unspecified model with member ownership, body, role, title and creation time.

Audit appends use built in sha256 and gen_random_uuid without extensions. Canonical audit text fixes the timezone to UTC. Actor identity comes from the current member, not the supplied event. Complete chain verification requires admin visibility or an owner connection. The migration ledger lives in the drizzle schema and rejects changed applied files.

P3 uses a separate owner connection confined to server only modules for Auth.js identity storage, session lookup and demo provisioning. Member requests always use soldline_app. No owner driver is exposed to routes. Sandbox methods accept only known personas and always filter workspace mutations to demo workspaces. New real identities receive a private workspace and an admin member. Auth.js properties map to existing SQL names without renaming tables or columns.

Demo members have a null user link. A database trigger requires real members to have a user and refuses authentication rows in demo workspaces. The earlier P2 test workspaces are now explicitly real fixtures to preserve that invariant. Workspace creation time determines recycling order. Expired records remain until the later cleanup worker handles them. Cookies cannot revive expired sandboxes.

Contributor scope suggestions and client scope requests use an explicit intent and cannot become full proposals. Scope acceptance needs two distinct people with account manager and delivery lead roles, or admin and one of those roles. Each approver must separately pass the requester exclusion check. Agent requests carry the asking member through the same permissions module.

## Parked

P5 needs deployment settings before external scheduling: TICK_URL and TICK_SECRET in GitHub secrets, TICK_SECRET on the app, and CRON_SECRET for the daily Vercel bearer. HUBSPOT_APP_CLIENT_SECRET must match the webhook app. Each HubSpot connection needs won_stage_id and should name delivery_lead_id. These were not configured remotely. The requested unit tests skill is absent, so P5 used the existing Vitest, MSW and PGlite setup directly.

The current shell still reports Node 20.19.2 on PATH despite the P5 runtime note naming Node 22.23. No runtime installation or PATH change was made. P6 must verify unpdf with the intended runtime. Production webhook response latency and database concurrency across separate connections remain unverified locally.


UNVERIFIED mail paths below all require confirmation against the live inbox API before P8. They live in the single MAIL_PATHS block in src/server/integrations/mail.ts. Query filters, response fields and reply draft mapping are also provisional fixture contracts.

`GET /inboxes/{inbox}`

`GET /inboxes/{inbox}/messages` for listMessagesSince and searchSent

`GET /inboxes/{inbox}/messages/{id}`

`GET /inboxes/{inbox}/threads/{id}`

`POST /inboxes/{inbox}/drafts`

`POST /inboxes/{inbox}/drafts/{id}/send`

TODO UNVERIFIED HubSpot owners, notes batch read and Files signed URL paths have no default. The HUBSPOT_PATHS block reserves them as undefined. Confirm the 2026 March reference and supply explicit paths before live use. Association pagination and association paths also need confirmation. All provided deal and line item methods use the supplied 2026 March paths.

TODO UNVERIFIED seed paths for company, contact, product and line item search and create follow `/crm/objects/2026-03/{type}` and `/crm/objects/2026-03/{type}/search`. Confirm these before a sandbox run. Notes search, notes create, file search, file upload and the association URL template require explicit process settings and have no guessed default. Confirm their response shapes, supported search filters and multipart fields too. The single SEED_PATHS block holds the base paths and unknown slots. See docs/P4.md for settings. The sandbox deal stage must be supplied explicitly.

MAIL_API_BASE defaults to `https://api.agentmail.to/v0`. MAIL_API_KEY supplies Bearer authentication and MAIL_INBOX_ADDRESS identifies `adhil+bilal@mail.grokbot.com`. Explicit admin setup encrypts the key before client use. TOKEN_ENC_KEY must be exactly 32 bytes encoded as base64. No environment file was opened or edited. Adding MAIL_API_BASE to the example file remains outside the shared boundary on environment files.

The existing unpdf version needs Iterator support that this Node 20 runtime does not provide. P4 validates the actual generated PDF text streams through pdf lib. The general PDF parser runtime belongs to P6 and was not changed.

HubSpot approval checks read the current modified time and the approved values before a write. The provider offers no confirmed conditional write mechanism in the supplied notes. A remote change between that read and patch remains a provider concurrency limit to confirm before the real approval engine.


Contributors see runs linked to findings or recovery_items they own until tasks exist. Replace this approximation when task ownership is available.

The cleanup worker, real approvals, delivery features, language switching and deployment belong to later phases. P7 must replace the audit only demo approval proof. Production concurrency across database connections remains untested because all database tests use PGlite. Cold builds still depend on the existing Google font setup; verification uses local cached font fixtures without changing the product font setup. No live identity provider or database connection was used during P3.

## Services

GitHub repo: shanifadhil33-blip/soldline.

Neon project: soldline, region us-east-1.

HubSpot: developer test account.

ClickUp: Free workspace Soldline Demo.

Vercel: Hobby, not linked yet.

Email: team inbox for demo email instead of Gmail.

Service credentials are managed outside the repo. Variable names and purposes are listed in the example environment file. No key values are stored here.
