# Backend report

P10 uses one integration suite in tests/backend-gate.test.ts. It calls exported route handlers with real signed demo cookies. Session resolution, permissions, database policies, approvals, provider clients and queue dispatch are real. The runtime adapter supplies PGlite and MSW supplies provider fixtures. Next after callbacks are collected and awaited after the webhook response. No store method is called to perform a demo step.

The suite has two complete walks and separate checks for live settings, absent sessions and this route inventory. Database reads inspect durable results. Fixture preparation supplies document pages parsed from the actual three page PDF, four line items, explicit workload mappings and client input records. A fixture trigger supplies the client inputs when the actual analyse job inserts its run. It is installed only in the test database. The earlier demo placeholder records are cleared before the event. The existing demo seed is not represented as a completed production demo.

Local verification passes all 568 tests across 29 files and the complete gate exits 0. Live execution remains pending for Bilal. A local green result does not establish provider compatibility.

## Suite results

Main walk means the test named Demo routes receive evidence approve eight tasks replay deny Ravi and verify the audit. Extended walk means Extended routes recover five tasks flag injected mail isolate Laith and enforce scope writes.

| Step | Result on PGlite | Proof |
| --- | --- | --- |
| Start Omar and switch through all six personas in the same sandbox | Pass | Main walk and Extended walk |
| Receive the signed won event through the HubSpot route and run its queued analysis | Pass | Main walk |
| Read eight items with page two quotes and a blocked eight task proposal | Pass | Main walk |
| Read four block findings and the Meta access warning | Pass | Main walk |
| Prepare the exact folder, four lists, eight owned dated tasks and Omar recovery payload | Pass | Main walk |
| Imran approves and executes through routes and the tick queue | Pass | Main walk |
| Eight tasks exist and HubSpot delivery status is Ready | Pass | Main walk |
| Version one starts as draft and becomes accepted with completed provision approval | Pass | Main walk |
| Replay returns zero new actions and creates no new effects or tasks | Pass | Main walk |
| Duplicate webhook receipt also creates no new effects | Pass | Main walk |
| Refuse Ravi with 403 and a denied audit row | Pass | Main walk |
| Read the run audit and check the complete workspace chain | Pass | Both walks |
| A watched line item receipt makes the next approval stale | Pass | Main walk after its final audit step |
| Outage after five task creations creates recovery work | Pass | Extended walk |
| Retry now creates only three more tasks and leaves eight distinct ids | Pass | Extended walk |
| Replay after outage recovery still leaves eight tasks | Pass | Extended walk |
| Casual mail and the TikTok request with injected instructions leave version one unchanged | Pass | Extended walk |
| Scope request and unusual instruction findings are separate | Pass | Extended walk |
| Exact team inbox reminder needs decision and confirmation | Pass | Extended walk |
| Revoked team inbox key marks only mail as needing reconnect | Pass | Extended walk |
| One connection recovery item belongs to Faisal and later ticks preserve mail job attempts | Pass | Extended walk |
| Laith gets the same neutral 404 for a Harbor run and deliverable | Pass | Extended walk |
| Karim can read the Harbor deliverable | Pass | Extended walk |
| Direct app role scope insert, update and delete are denied | Pass | Extended walk |
| Webhook and replay after version one leave scope versions unchanged | Pass | Extended walk |
| A later scope version needs two eligible decisions and executed exact scope work | Pass | Extended walk |
| Repeated scope execution writes no third version | Pass | Extended walk |
| Personal memory stays private and edit, remove, Undo and clearing use routes | Pass | Extended walk |
| Undo creates a separate approval and pause and cancel use their route guards | Pass | Extended walk |
| Every required live provider path must be set before live setup starts | Pass | Live preflight refuses an unset %s before any provider call |
| Live settings require Bilal confirmation and refuse an unsafe path | Pass | Live preflight requires Bilal confirmation and refuses an unsafe path |
| Member routes refuse an absent session | Pass | Member routes refuse an absent session before database writes |
| Every exported route is included in this report | Pass | Backend report covers every exported route and server action |

## Route inventory

All member routes require a valid session or unexpired signed demo cookie. Database reads run as soldline_app with the member identity. Named owner operations recheck the stored member and workspace. A missing or hidden record returns a neutral not found response. The permission matrix remains in src/server/permissions.ts and its existing 56 tests cover role cells, unions, requester exclusion and scope quorum.

| Route | Who may call it | Test |
| --- | --- | --- |
| `GET /api/auth/[...nextauth]` | Auth.js validates the requested authentication operation | tests/auth-route.test.ts: Completes Google OAuth with MSW fixtures using the exported handlers and an original NextRequest |
| `POST /api/auth/[...nextauth]` | Auth.js validates OAuth state and form protection | The same complete OAuth route test and tests/auth.test.ts session lifecycle tests |
| `POST /api/demo/start` | Public, with a known persona; signed cookie permits sandbox reuse | Main walk; tests/demo.test.ts: Returns 200 for 50 rapid starts through the route directly |
| `POST /api/sign-out` | Any visitor, same site only (Sec-Fetch-Site or Origin); deletes the Auth.js session, clears session and demo cookies, audit row sign_out when a member was signed in; 303 home for forms, JSON otherwise | tests/sign-out.test.ts |
| `GET /api/sign-out` | Never signs out; 405 with a plain message | tests/sign-out.test.ts |
| `POST /api/webhooks/hubspot` | Valid HubSpot signature, timestamp and configured portal | Both walks; tests/system-routes.test.ts: Webhook invalid signatures never query the event store or register a worker |
| `POST /api/webhooks/clickup` | Valid MAC from an encrypted configured webhook secret and matching webhook id | tests/events-jobs.test.ts: Verifies ClickUp before JSON parsing and deduplicates each history item; Refuses a ClickUp body with a different webhook id even when another stored secret signed it |
| `POST /api/jobs/tick` | Exact configured tick bearer | Both walks; tests/system-routes.test.ts: Tick without bearer returns 401 before constructing database services |
| `GET /api/jobs/daily` | Exact configured cron bearer | tests/system-routes.test.ts: Daily without its bearer returns 401 before constructing database services; tests/events-jobs.test.ts: Queues reconciliation and keep alive for the secured daily request |
| `POST /api/jobs/daily` | The same configured cron bearer | The same daily schedule test uses the shared secured handler |
| `GET /api/runs/[id]` | Staff in the workspace; contributors subject to run policy; client reviewers only for their company | Both walks and Member routes refuse an absent session before database writes |
| `GET /api/deliverables/[id]` | The same workspace and run policies; client reviewer must belong to the deal company | Extended walk proves Karim allowed and Laith refused |
| `GET /api/runs/[id]/audit` | Admin; account manager owning the deal; delivery lead assigned to the run | Both walks check Faisal and the complete chain, and the main walk checks Omar and Imran access; existing permissions and policy tests cover audit role restrictions |
| `POST /api/approvals` | Admin, account manager or delivery lead may draft for a visible run; HTTP callers cannot claim an agent identity or another requester | Both walks and Member routes refuse an absent session before database writes; store identity and requester tests in tests/approvals.test.ts |
| `POST /api/runs/[id]/approve-plan` | Admin or delivery lead, excluding a human requester | Main walk proves Imran and Ravi; tests/forbidden.test.ts: Records exactly one audit row for $persona |
| `POST /api/approvals/[id]/decide` | Plan and provision: admin or delivery lead; mail: admin or account manager; scope: eligible quorum members; reversal: admin or delivery lead; human requester excluded | Extended walk and tests/approvals.test.ts: Decision confirm and execute routes use the real engine; Scope requester cannot supply either quorum decision |
| `POST /api/approvals/[id]/confirm` | The deciding approver of an irreversible approval, within two minutes | Extended walk and tests/approvals.test.ts: Only the deciding approver can confirm an irreversible approval; Confirmation at two minutes is too late |
| `POST /api/approvals/[id]/execute` | The same eligible roles as decision, after approval, required confirmation and live input checks | Both walks and tests/approvals.test.ts: Completes every live recheck before the first effect row or job exists |
| `POST /api/runs/[id]/replay` | Admin, delivery lead or demo Omar | Both walks; tests/events-jobs.test.ts: Refuses replay by a contributor or across workspaces |
| `POST /api/recovery/[id]/actions` | Admin or the account manager or delivery lead owning the item | Extended walk; tests/recovery.test.ts: Recovery routes enforce staff ownership contributor denial and workspace isolation |
| `POST /api/runs/[id]/pause` | Admin or delivery lead | Extended walk; tests/recovery.test.ts: Run routes pause and cancel through the permission guard |
| `POST /api/runs/[id]/cancel` | Admin or delivery lead | The same route tests |
| `POST /api/runs/[id]/undo` | Admin or delivery lead; creates a separate approval and excludes its human requester from approval | Extended walk; tests/recovery.test.ts: Undo route refuses runs with no reversible effects; tests/executor.test.ts covers successful reversal and refusal after Ravi edits |
| `GET /api/memory` | Active member for his own personal entries; admin also sees company entries | Extended walk; tests/memory.test.ts: Another person cannot read or edit personal memory; Client reviewers never receive company lessons or another personal history |
| `POST /api/memory` | Active member for his own confirmed personal entries; staff may propose company entries; only admin may approve or edit company entries | Extended walk covers creation, editing, removing, Undo, clearing and Imran refusal; tests/memory.test.ts covers consent, repeated records and admin review |
| `POST /api/monitors/reminder` | Admin or account manager, for a visible open reminder finding and exact recipient and wording | Extended walk; tests/monitors.test.ts: Client reminder is an irreversible approval without sending mail |

Server actions: none. There is no file or inline action with a use server directive. Browser controls call the listed routes. Auth.js exports authentication helpers and clearDemoOnSignIn is an authentication event hook, not an application server action. The OAuth fixture test covers that hook and cookie clearing. The inventory test scans all source files and will fail if a server action is added without updating this claim.

## Source fixes and evidence

Every retained source change fixes a failed integration step. The first runs failed for missing route modules, draft scope remaining unaccepted, missing injection findings, wrong reconnect ownership and advancing attempts for disconnected mail. No earlier migration was changed. Existing grants already deny direct scope writes, so no schema or grant migration was needed.

| Source | Real cause and fix | Proving test |
| --- | --- | --- |
| src/app/api/runs/[id]/route.ts | No route could read the analysed evidence. Add a member scoped read with a limited client response | Main walk; Extended walk isolation; absent session test |
| src/app/api/deliverables/[id]/route.ts | No deliverable link handler could prove the requested isolation case. Add a policy scoped read with a neutral missing response | Extended walk proves Karim 200 and Laith 404 |
| src/app/api/approvals/route.ts | Exact approval creation had only an internal store operation. Expose a guarded validated human request without permitting requester impersonation | Both walks create their approvals through this route |
| src/app/api/runs/[id]/audit/route.ts and src/server/db/owner.ts | No route exposed a run audit with a complete chain check. Add a scoped named read that checks stored permissions and returns only this run's rows | Both walks check the full chain |
| src/server/approvals/http.ts | Ravi could be hidden by run policy before the required role denial and audit. Check the plan approval role before looking up the run | Main walk and the unchanged contributor denial test |
| src/app/api/runs/[id]/replay/route.ts | Replay opened an owner operation inside the member transaction and stalled on the single PGlite connection. Resolve the session and use the named service outside that transaction; retain its stored role check | Both walks complete replay and assert no new tasks |
| src/server/scope/store.ts | Analysis could create version two as a draft. It now creates only the initial draft and reuses an existing version without modifying its items | Both walks and tests/scope-store.test.ts: Analysis reuses the existing accepted scope and cannot write a later draft |
| src/server/executor/store.ts | Completed provision never accepted version one. Accept its initial draft with approver identity and time when all approved work succeeds | Main walk |
| src/server/executor/store.ts and src/server/executor/worker.ts | Scope acceptance was unsupported. Execute one exact scope snapshot atomically with the executed scope approval, items, run link, effect receipt and audits; recheck the current scope hash and reuse a completed effect | Extended walk proves pending decisions do not write, execution creates version two and repetition does not create version three |
| src/server/monitors/rules.ts and src/server/monitors/store.ts | A scope request email did not retain a separate unusual instruction flag. Record its quoted instruction as a separate persistent finding | Extended walk |
| src/server/executor/store.ts | Revoked mail recovery went to the delivery lead. Deduplicate connection recovery by workspace and provider and assign an active admin | Extended walk proves exactly one item for Faisal |
| src/server/jobs/store.ts | Disconnected mail continued consuming job attempts. Skip jobs whose required provider needs reconnect, is paused or is revoked; other provider jobs remain eligible | Extended walk advances another tick bucket and proves unchanged mail attempts and connected HubSpot and ClickUp |

The earlier scope store test had seeded an accepted version before asking analysis to create another draft. Its setup now starts without an existing scope and uses the pending scope run key. All eight item, quote, finding, draft, audit and permission assertions remain. A new regression case proves a fresh analysis reuses an existing accepted version without changing any version or item. No assertion was removed or loosened.

The scope write rule is proved for application operations. Initial business analysis creates version one as draft. Successful provision or plan correction accepts it. A later snapshot is written only inside exact scope change execution after two eligible decisions. The positive test retains the eight contracted items and adds the requested ninth item; earlier versions retain their items. Casual mail, injected mail, webhook receipts, replay and denied direct app writes leave existing versions unchanged. Privileged database owners remain able to prepare fixtures. The demo seed still contains explicitly labelled placeholder sample records and is not a separate production scope ingestion path.

## Live mode for Bilal

The live code is written and has not been run. Bilal must confirm the UNVERIFIED contracts in docs/STATE.md first. Run only `LIVE_SANDBOX=1 pnpm test:live` after supplying process settings. The launcher refuses any other mode. No environment file is loaded or changed.

Required settings are LIVE_PATHS_CONFIRMED=yes, LIVE_PROVIDER_PATHS, LIVE_MAIL_BASE, LIVE_HUBSPOT_PORTAL, LIVE_CLICKUP_SPACE, LIVE_WORKLOAD_LIST, LIVE_CLICKUP_ASSIGNEE, LIVE_LINE_IDS, LIVE_DEAL_BODY, LIVE_WON_STAGE, LIVE_HUBSPOT_TOKEN, LIVE_CLICKUP_TOKEN and LIVE_MAIL_TOKEN. LIVE_LINE_IDS has four confirmed line item ids corresponding to the signed fixture. LIVE_DEAL_BODY is the confirmed deal create JSON, including the sandbox pipeline and associations to those items. No stage, company, contact, product, association or provider path is guessed.

LIVE_PROVIDER_PATHS is a JSON object with every key exported as requiredPaths in tests/helpers/backend-live.ts. That includes all provisional mail paths, HubSpot notes, owners, file and association paths, seed paths, actual deal create and delete paths, and ClickUp paths used by the walk and cleanup. Missing entries and unsafe relative paths refuse setup before the first provider request. Required placeholders are validated. Values are paths relative to the fixed HubSpot and ClickUp hosts or the explicit HTTPS mail base.

The ClickUp folder count contract needs an explicit clickupFolderTasks path containing {folder}, including the confirmed exact folder filter and query. It must return the complete folder as tasks with distinct ids in one response. A response declaring another page is refused. This avoids spending four list requests at every assertion. Both replay assertions and the outage recovery assertion read this remote count. Other intermediate counts come from the actual successful task create responses.

Each scenario creates its own HubSpot deal and ClickUp folder with a LIVE reference. The real deal is marked won before the locally signed event is delivered to the exported webhook handler. The stale approval step also edits a real line item through its explicitly supplied update path. Cleanup restores that line item name. This exercises the backend contract against the sandboxes without claiming to test deployed webhook delivery. HubSpot and ClickUp operations use explicit confirmed path mappings. The same PGlite database boundary is retained; no Neon connection is made.

The outage and revoked mail response are injected faults. Inbound sample mail stays a fixture in live mode and no mail is sent. Monitor reads of just created tasks use their actual create observations from this run so monitor ticks do not multiply sandbox calls. Cached observation counts are printed separately. These observations do not prove that later remote edits would be seen by a live monitor. Existing connector and monitor fixture tests cover that separate behavior.

Cleanup is in the suite's final hook, including on failed assertions. It attempts to delete every recorded ClickUp folder and HubSpot deal and reports cleanup failures instead of hiding them. Calls are counted per provider, including failed actual requests. The runner reserves ClickUp calls for cleanup and refuses a request before the total could exceed 60. The two walks use a nominal budget of 60 ClickUp calls including cleanup when the confirmed list and count contracts return complete pages. Extra pages or provider retries can exhaust that budget and fail the run. Bilal must paste the real output before live acceptance can be marked green.

## Verification

pnpm test passes 568 tests across 29 files. The new integration file has 39 tests: two full walks, 34 required path checks, one confirmation and unsafe path check, one absent session check and one inventory check. The scope store regression adds one test to the earlier suite. The final pnpm gate exits 0 after lint, TypeScript, all 568 tests and the production build. A final focused run after aligning the synthetic live event stage with the confirmed live stage passes all 39 integration tests. Node v22.23.3 is selected before every shell command. The required commands are pnpm test and pnpm gate with output redirected to /tmp/gate.out and the exit code printed separately without a pipe. Production build verification uses existing cached font assets through temporary local fixtures. Product font configuration is unchanged.

## Deviations and work outside scope

There is no docs/P1.md or plan.md in the repo. docs/verification.md contains the P1 verification record; the supplied plan excerpts define the demo order. The stale approval check follows the main walk's final audit, then the extended walk begins with its own isolated deal and outage. Preparatory fixture data replaces the earlier sandbox placeholders only in tests. UI screens, elapsed video timing, deployment and real sign in remain outside this backend suite.

The live mode deliberately retains fixtures for inbound mail, injected faults and monitor observations of its own creates. It verifies real HubSpot writes and ClickUp task counts only after Bilal runs it. Provider paths, response compatibility, live cleanup and live timing remain unverified. Production concurrency and provider conditional writes remain parked. The older contributor run policy still uses assigned findings or recovery work as its approximation of task ownership; this phase does not claim to replace that broader permission policy.

During initial instruction discovery, a find command listed AGENTS.md paths in neighboring repos. Those files were not opened or edited. All subsequent source reads and retained edits stayed in this repo. The requested /tmp/gate.out is the only intended retained write outside it. No environment file was opened or edited. No real sign in, live HubSpot, ClickUp, mail or AI call, Neon connection, global installation, commit or push occurred.

## P12 screen routes

`GET /api/runs/[id]/tasks` reads current ClickUp tasks through the existing member session, row security, Connections and ClickUpClient. It reads only lists created successfully for the visible run. Provider failures return a refusal rather than old task data.

`POST /api/approvals/[id]/run` uses the existing P7 approval HTTP boundary and schedules the existing P8 worker through Next after only when execution is accepted. It adds no approval or executor rules.

The existing run read now includes staff approval payloads, visible audit rows and workspace member display names. Client responses keep their existing narrow shape.


## P13 trust routes

`GET /api/recovery` lists visible open items with their stored allowed options.
`GET /api/audit` checks the complete chain with the existing verifier and limits rows to the stored role and run ownership.
`GET /api/connections` returns provider status and capability labels without credentials.
`POST /api/connections` refuses non admins with an audit append and delegates authorized changes to P4.
`GET /api/client` reads company scoped inputs and deliverables through RLS.
`POST /api/inputs/[id]` confirms a visible input through the existing input write policies.
`POST /api/deliverables/[id]` records client approval only for his company in Client review.
`POST /api/demo/backend-check` invokes the existing plan approval POST with the signed Ravi demo session and reads the new denial from the audit service.

Server actions: none. Trust controls call route handlers. Input mutation and client deliverable approval routes were absent before P13 and are narrow additions. Client approval records the local review decision and does not claim a remote ClickUp mutation.
