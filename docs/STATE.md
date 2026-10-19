# Soldline

## PAUSED Oct 19 2026, not dropped

Paused by Bilal on Adhil's decision (Oct 19 2026, via Jarvis) for the second championship entry, Proofline. Soldline resumes after Proofline with nothing lost.

Where it stopped:
- Live at commit b260c83 on https://soldline-teal.vercel.app (repo shanifadhil33-blip/soldline, main, clean and pushed; Vercel success).
- pnpm gate PASS with 670 tests. e2e 83 of 83 pass against the new seed (e99fca7). Migrations up to 0013 applied on Neon.
- Google sign in published (any Google account can sign in; /privacy and /terms are live).
- Codex is not held by Bilal (Abu is current holder in team-memory/codex-lock.md). No Codex process running.

What is left, in this order:
1. p15a: make the seeded Harbor approval run for real (it is display only today, so Approve in the live demo cannot execute; rebuild it with provisionPayload like e2e/fixtures/core.ts). Codex prompt ready: /workspace/soldline-prompts/p15a.md (copies in this folder under prompts/ and in the repo under docs/prompts/).
2. HubSpot app webhook (/api/webhooks/hubspot) and ClickUp OAuth app (/api/webhooks/clickup), with their env vars in Vercel.
3. Live sandbox run (LIVE_SANDBOX=1 pnpm test:live) with real calls and failure paths. Closes Gate step 5.
4. A real end to end Google sign in check with a real account.
5. Stitch design for web and phone from Adhil's pick (Gate step 4, design/references/), with Adhil's approval.
6. Then the Codex rebuild from Stitch and QA (Gate steps 6 to 10: known issues recheck, live e2e and role walk, phone sweep at 360 and 390 in English and Arabic, lessons merged into build-knowledge), then P15 docs and the portfolio entry.

Prompts and logs: /workspace/soldline-prompts (originals, left in place), /home/box/shared/adhil/portfolio/agency-delivery-agent/prompts/ (full copy incl. Codex logs), repo docs/prompts/ (prompt and report files only; the repo is public, so logs stay out of it).


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

P6 adds PDF parsing through unpdf on Node v22.23.3, page quotes, a deterministic English and Arabic scope parser, a validated AI chain, pure comparison rules, evidence, and delivery proposals. The Harbor fixture produces exactly four block findings for sold deliverables missing from HubSpot and the warning No Meta ad account access yet. Its plan contains eight tasks. Invented quotes, wrong pages and invented titles with real quotes are dropped. A client instruction creates an unusual instruction finding and changes no task or normal finding.

System analysis uses private named owner operations. Each scope version, item, finding and plan update writes a system audit row. New migrations add page text, cadence, mapping synonyms, offsets, ClickUp list references and a contract start date. Scope versions remain draft for P7. ClickUp workload reads use shared token buckets and MSW fixtures in tests. The queue core and permissions are unchanged. P6 verification passes 361 tests across 22 files, including 28 new tests. The gate passes lint, types, tests and the production build with exit code 0. See docs/P6.md for exact findings, tasks, files and verification limits.

P7 adds exact approvals with canonical SHA256 payload and input hashes, per kind role requirements, twenty four hour expiry and thirty minute expiry for irreversible work. Human requesters cannot approve their own work. Scope changes need two distinct eligible people. Irreversible decisions return the full message for a separate confirmation within two minutes. Every decision, refusal, effect plan and queued job writes audit rows.

Execution locks the approval, checks the stored hashes and current approver roles, then reads every input live before any effect row or job is created. Changed HubSpot deals, line items, scope versions and ClickUp list presence make approvals stale with readable reasons and observation times. Durable webhook and poll receipts and scope changes invalidate open approvals immediately. Repeated execution returns the stored summary. Queue failures roll back all planned effects and jobs before a separate failed audit is committed.

The temporary plan route now decides an actual pending approval for real workspaces and demos. Its contributor 403 proof remains intact. P7 verification passes 436 tests across 23 files, including 75 new approval tests. The gate passes lint, types, tests and the production build with exit code 0 using local font fixtures. See docs/P7.md for every rule and its test, exact live recheck lines, files and limits.

P8 adds durable execution of exact P7 approvals through the existing P5 queue and private owner operations. Provision creates a folder, four lists and eight owned dated ClickUp tasks, then reads and patches the HubSpot delivery fields. Every task create first reconciles its target list using the exact Soldline reference. A timeout adopts the existing task. The outage after five tasks ends with eight distinct tasks after recovery. Missing line items create recovery work for Omar.

Recovery routes support retry now, resolve with note, cancel remaining and reconcile. Unknown team inbox mail searches sent messages by our Message ID and never automatically resends. Pause cancels pending jobs and preserves successful effects. Undo requests a separate reversal approval, archives only unchanged ClickUp objects and restores HubSpot values only while our after values still match. Changed tasks produce the exact Ravi refusal. All decisions and execution state changes append audit rows.

P8 verification passes 469 tests across 25 files, including 33 new executor and recovery tests. The gate passes lint, types, all tests and the production build with exit code 0 using cached local font fixtures. See docs/P8.md for files created, every rule and its test, the marker self audit, queue choices, deviations and verification limits.

P9 adds tick monitor jobs for missing inputs, client review, deadline risk, accepted commitments without an assigned task and quoted email scope requests. Findings keep one P8 recovery item per finding. Client reminders become exact irreversible approvals. Memory requires consent, repeated workspace records for company lessons, admin review, private personal context and visible Undo. The Memory page supports English and Arabic. Metrics use a SQL view over actual timestamps. Notifications cover assigned blocks and local daily digests while excluding the actor. The narrow undo fix resolves the actual ClickUp editor or assignee to a member name and uses Someone when no member matches. P9 verification passes 528 tests across 28 files. The gate passes lint, types, tests and the production build with exit code 0 using cached local font fixtures. See docs/P9.md for files, test names and the inherited scope write exception.

P10 adds one backend integration suite through exported routes with signed persona cookies, PGlite and MSW. The main walk proves exact provision, eight tasks, replay, contributor refusal and a complete audit chain. The extended walk proves stale approval, outage recovery to eight distinct tasks, injected scope mail, revoked team inbox recovery for Faisal and client isolation. Initial scope is drafted by analysis and accepted with completed provision or plan approval. Later versions require executed exact scope change approval. Application role writes remain denied. The backend report inventories every route and confirms there are no application server actions. The live runner has explicit path preflight, LIVE references, cleanup and a hard ClickUp call budget. It has not been run. Local verification passes 568 tests across 29 files. The full gate exits 0. The integration suite contains 39 tests and live execution remains pending. See docs/backend-report.md for the complete route inventory, each source fix and its proving test, deviations and verification limits.

P11 completes the public home, six persona demo picker and authenticated app frame in English and Arabic. Staff have eight laptop links and four phone tabs. Client reviewers have Home and Inputs. All destinations resolve to message based placeholders. Language sets html direction, numbers use Western digits and logical CSS serves both directions. Reset demo asks for confirmation before reusing the existing start flow and retains current sample work. The production PGlite and MSW browser fixture suite passes all 47 tests across all personas at widths 360, 390 and 1440 with no console errors or sideways scroll. The final unit run passes 573 tests across 31 files and pnpm gate exits 0 after lint, types, tests and the standard production build. See docs/P11.md for files, commands, self audit and limits.

P12 replaces Today and Runs placeholders and adds run detail with evidence, exact approvals, local expiry, task reads and replay. The screen delegates approval execution to P7 and schedules the existing P8 worker. The explicit P11 browser runtime now prepares approvals through the real service and serves provider traffic with MSW. A separate stale fixture proves the visible Out of date sentence and a refused execute request. The full browser suite passes 51 checks. The final core rerun passes all four width and language cases in 12.3 seconds. The final unit run passes 580 tests across 33 files and pnpm gate exits 0 after lint, types, tests and the standard production build. See docs/P12.md for the sixty second script, files, verification and limits.


P13 replaces Recovery, Audit log, Connections, client Home and Inputs with working trust screens. The demo backend panel uses the existing Ravi approval refusal and reads its new audit row. Audit checks the complete chain and limits rows by stored roles and run ownership. Client reads and writes enforce company isolation, foreign links share the neutral missing page, and the new client approval fields survive repeated monitor observations. Provider changes reuse P4 and recovery actions reuse P8. The final unit run passes 601 tests across 35 files and the standard gate exits 0. The full browser suite passes 83 checks and the final five trust spec rerun passes all 32 checks. See docs/P13.md for each rule, its test, verification and limits.

## Next

P14. Continue the remaining application work from the verified P11 shell and P13 trust screens. Bilal owns the separate live sandbox acceptance.

## Decisions

Node 22 is the target. P10 verification selects the supplied Node v22.23.3 before every shell command. The package engine still accepts Node >=20.9. No runtime was installed.

Use pnpm, Next.js 16 App Router, TypeScript strict and Tailwind 4. P13 application screens use pure white backgrounds. P11 public pages retain warm paper backgrounds, Charcoal Ink text, Deep Muted Teal for primary buttons and active state only, Dusty Camel for structural borders and neutral borders elsewhere. Spacing is 4, 8, 12, 16 and 24 pixels. Radius is 6 or 8 pixels.

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

P13 client approval records a durable Soldline review decision. Remote ClickUp status synchronization is outside this screen phase. Undo uses the existing separate reversal approval for supported completed effects because P8 has no direct reversal of a queue decision. Unknown provider capability identifiers receive generic plain language labels. The new client review migration must be applied before deploying these reads against an existing database.


P10 live execution remains pending for Bilal. The confirmed path manifest must include every required provider path and a complete folder task count contract. The runner refuses missing settings, reserves ClickUp cleanup calls and stops before exceeding 60 actual calls. Real provider compatibility, live cleanup, deployed webhook delivery and live timing remain unverified. Inbound mail, injected faults and monitor observations of the just created tasks remain fixtures in live mode. See docs/backend-report.md for the exact limits and settings. No live call was made during P10.

P10 settles the P9 scope exception for application operations. Analysis may create only version one as draft and reuses an existing version without writing another draft. Completed provision or plan approval accepts the first version. Later snapshots are written only inside executed scope change approval with two eligible decisions. Casual and injected mail, webhook, replay and direct app role writes cannot change the existing scope. Privileged fixture owners and the explicitly labelled demo placeholder seed are outside that application write contract. Task review history is measured from successful observations, and external tasks need confirmed scope links. Reminder recipients require a person to supply the exact address and wording. Company lessons all wait for admin review. Private staff performance lessons, a general conversation interface, notification screens and live subscriptions, shared message keys for the existing account and Memory page text and monthly interaction measurements remain parked. No simulated results are shown as real.

P8 executes provision, mail, recovery and reversal effects through P5. P10 adds exact scope snapshot execution and initial scope acceptance. Other unsupported actions still fail closed into recovery. P12 verifies the core screens with local browser fixtures. The ordinary demo seed still has its earlier placeholder plan. Mail Message ID mapping and sent search remain fixture contracts. Remote conditional writes and production concurrency remain unverified. P7 approval envelopes retain their existing keys while executable child records use the decided SHA256 keys. ClickUp events without a list id conservatively mark open list approvals stale across the workspace. Every caller must supply all input references on which the exact payload depends. Production concurrency and provider conditional write contracts remain unverified. Data can change after the live read, so P8 must recheck each real write. No integration or scope engine code was changed.

P6 leaves automatic signed file retrieval parked with the existing unverified HubSpot file URL contract. The named scope ingestion operation accepts the PDF bytes and stores numbered page text. Analysis consumes the local HubSpot line item mirror and supplied onboarding records. The earlier sandbox seed retains its placeholder data and was outside this phase. P12 covers run detail and elapsed fixture browser timing. Live timing remains unverified. Contract start dates and mapping ClickUp list ids need explicit configuration. AI adapters require named compatible endpoint settings and have only been exercised with MSW. P7 now owns real approval writes. P10 now supplies the exact scope snapshot approval and execution contract.

P5 needs deployment settings before external scheduling: TICK_URL and TICK_SECRET in GitHub secrets, TICK_SECRET on the app, and CRON_SECRET for the daily Vercel bearer. HUBSPOT_APP_CLIENT_SECRET must match the webhook app. Each HubSpot connection needs won_stage_id and should name delivery_lead_id. These were not configured remotely. The requested unit tests skill is absent, so P5 used the existing Vitest, MSW and PGlite setup directly.

P6 verified unpdf with Node v22.23.3 by putting the supplied local runtime first on PATH for every shell command. Production webhook response latency and database concurrency across separate connections remain unverified locally.


Mail paths below match the AgentMail OpenAPI (checked Oct 18 2026) but the team inbox adhil+bilal@mail.grokbot.com is a Grok Bot native inbox with no API key, so they cannot run live; see docs/provider-paths.md and fix-plan A2. They live in the single MAIL_PATHS block in src/server/integrations/mail.ts. Query filters, response fields and reply draft mapping are also provisional fixture contracts.

`GET /inboxes/{inbox}`

`GET /inboxes/{inbox}/messages` for listMessagesSince and searchSent

`GET /inboxes/{inbox}/messages/{id}`

`GET /inboxes/{inbox}/threads/{id}`

`POST /inboxes/{inbox}/drafts`

`POST /inboxes/{inbox}/drafts/{id}/send`

CONFIRMED Oct 18 2026 (Bilal, live): HubSpot owners, notes batch read, file signed URL, file search and upload, object search and association label paths (association create from the 2026-03 reference). Defaults live in HUBSPOT_CONFIRMED_PATHS and SEED_PATHS. See docs/provider-paths.md. Oct 19 2026: the HubSpot service key now has write scopes for deals, companies, contacts, line items, notes and products, and the HubSpot seed runs live and reruns safely in test portal 247724060: deal 355638664953 (closedwon, soldline_delivery_status Not started, amount 18000), 4 line items totalling 18000, contacts Karim and Laith, companies Harbor Coffee Roasters and Cedar Line Furniture, and a note with the signed scope PDF (file 412301100775, now naming Imran Shaikh as delivery lead). The test portal only allows USD (deal_currency_code), so the seed sets no currency and amounts read as USD there.

Seed paths: confirmed, see docs/provider-paths.md. ClickUp seed ran live Oct 18 2026: folder Retainer onboarding 901414513961, lists Setup 901422397743, Content 901422397744, Ads 901422397745, Reporting 901422397746 in space Client delivery 90149400327; a rerun returned the same ids. HubSpot seed file uploaded: harbor-scope 412301100775 (/Soldline, private). The sandbox deal stage is closedwon.

MAIL_API_BASE defaults to `https://api.agentmail.to/v0`. MAIL_API_KEY supplies Bearer authentication and MAIL_INBOX_ADDRESS identifies `adhil+bilal@mail.grokbot.com`. Explicit admin setup encrypts the key before client use. TOKEN_ENC_KEY must be exactly 32 bytes encoded as base64. No environment file was opened or edited. Adding MAIL_API_BASE to the example file remains outside the shared boundary on environment files.

P6 resolves the earlier unpdf runtime limit with the supplied Node 22 runtime and tests the actual three page PDF with unpdf. No runtime was installed.

HubSpot approval checks read the current modified time and the approved values before a write. The provider offers no confirmed conditional write mechanism in the supplied notes. A remote change between that read and patch remains a provider concurrency limit to confirm before the real approval engine.


Contributors see runs linked to findings or recovery_items they own until tasks exist. Replace this approximation when task ownership is available.

P11 provides language switching for the public pages and app frame. The cleanup worker, language preferences for existing account flows and deployment belong to later phases. P8 now owns delivery execution. P7 replaced the audit only demo approval proof with a real approval decision. Production concurrency across database connections remains untested because all database tests use PGlite. Cold builds still depend on the existing Google font setup; verification uses local cached font fixtures without changing the product font setup. No live identity provider or database connection was used during P3.

## Services

GitHub repo: shanifadhil33-blip/soldline.

Neon project: soldline, region us-east-1.

HubSpot: developer test account.

ClickUp: Free workspace Soldline Demo.

Vercel: Hobby, not linked yet.

Email: team inbox for demo email instead of Gmail.

Service credentials are managed outside the repo. Variable names and purposes are listed in the example environment file. No key values are stored here.

## P14 (Oct 19 2026, by hand while Codex was out of usage)
Done: /privacy and /terms; seed sets no currency (test portal is USD only) and resets the deal to Not started; scope PDF names Imran Shaikh; agency titles Agency director (admin) and Specialist (contributor); POST /api/sign-out (same site only); Auth.js error copy, error.tsx, global-error.tsx; notifications by database triggers (drizzle/sql/0011_notifications.sql, applied on Neon) with GET /api/notifications and POST /api/notifications/read; demo seed has a waiting item for every persona and the real pending approvals behind Waiting for approval (Today data in src/server/today.ts); fail() and answer() in src/server/http.ts so no route answers an empty error.
Open: ClickUp status write back, sample inbox provider, demo controls as real writes, the demo_cleanup job handler (6 hour cleanup), agent, memory, settings, MCP, Help and feedback. e2e specs were not rerun against the new seed.


## P14a backend chunk A4

ClickUp transitions now queue in progress, client review and complete writes; monitors treat complete as closed. Client approval keeps its existing notification trigger. SampleInboxProvider is the default, stores the three seeded client messages and labelled outbound drafts, and executes approved email as Sample, not sent with audit evidence. AgentMail requires an explicit MAIL_PROVIDER=agentmail setting.

The authenticated runDemoControl server action performs all six controls through named owner services. Mark won uses a separate recorded HubSpot sandbox deal when credentials are configured, otherwise it injects a labelled durable event. Replay creates zero new actions. Line item edits stale open approvals. Task create outages consume exactly the configured count; failed execution creates normal recovery work. Inbox revocation is simulated.

Tick and daily jobs queue expired sandbox cleanup with a five sandbox cap. Cleanup deletes only recorded created ClickUp folders, restores recorded HubSpot deal stages and delivery fields, records partial progress, retries failures and finally removes sandbox workspace rows. New migration 0012_demo_backend.sql adds the mail and resource ledgers, scoped app grants with write checks, and sandbox deletion dependencies.

Open: live acceptance and deployment migration remain for the reviewer. No live provider or database call was made. Agent, memory, settings, MCP, Help and feedback remain outside this backend chunk. No visual changes or new screens were made.

P14a verification: Node v22.23.3, pnpm gate EXIT=0, all 645 tests across 43 files, lint, typecheck and the production build passed. Sixteen new focused backend tests cover items 8 through 11. See docs/P14a.md for files per item, test coverage and limits.

## P14b

P14b adds member private agent conversations and approval only action cards, personal and company settings, revocable hashed member MCP tokens with JSON RPC tools and per token limits, and database feedback attachments. Free AI wording has member and sandbox daily caps with deterministic data fallback. Small organisation notes activate immediately; consequential lessons require Agency director review. Forget clears personal memory and conversations while preserving organisation memory and audit. Migration 0013_agent_backend.sql is required before deployment. Backend and tests only, with no new screens or visual changes. The final pnpm gate exits 0 with all 670 tests and the production build passing. See docs/P14b.md for verification and limits.
