# Soldline

## Done

P1 app scaffold with one landing placeholder, English and Arabic message skeletons, design tokens, strict TypeScript, HTTP fixtures and a gate for lint, types, tests and production build. Playwright lives in a separate package under e2e. The final gate passed all 39 tests and the production build. The deliberate test failure returned 1 and the restored gate returned 0. See verification.md for evidence.

P2 database schema now contains all 27 app tables with generated Drizzle SQL, workspace foreign keys, enabled and forced row security, private member records, company access and contributor run access. Manual SQL creates the app role, fixed search path helpers and a locked audit chain. Local PGlite fixtures exercise migrations and policy removal. The migration runner reads DATABASE_URL_OWNER only when explicitly invoked.

P3 adds Auth.js v5 Google sign in with database sessions and the Drizzle adapter on the P2 tables. Branded sign in and error pages use the shared tokens. Six demo personas start isolated six hour sandboxes through a signed browser cookie. Repeat starts and persona switches reuse the sandbox. At most 60 remain live, with the oldest expired and exactly one cleanup job queued for its sample ClickUp folder and HubSpot deal.

The single permission matrix covers all 50 role and action cells, role unions, requester exclusion, company access, task access and scope acceptance quorum. Member routes resolve sessions, set transaction member identity and record denied actions before returning 403. The demo plan approval route records only an allowed audit event. P7 owns the real approvals engine.

P3 verification passes 215 tests across 16 files, including a complete Google OAuth callback through MSW fixtures and PGlite. The gate passes lint, types, tests and production build with exit code 0. See docs/P3.md for files, decisions and verification limits.

## Next

P4 connectors and seed scripts with the team inbox mail adapter instead of Gmail. Continue using local fixtures until live service work is explicitly requested.

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

Contributors see runs linked to findings or recovery_items they own until tasks exist. Replace this approximation when task ownership is available.

Provider connections, token encryption use, the cleanup worker, real approvals, delivery features, language switching and deployment belong to later phases. P7 must replace the audit only demo approval proof. Production concurrency across database connections remains untested because all database tests use PGlite. Cold builds still depend on the existing Google font setup; verification uses local cached font fixtures without changing the product font setup. No live identity provider or database connection was used during P3.

## Services

GitHub repo: shanifadhil33-blip/soldline.

Neon project: soldline, region us-east-1.

HubSpot: developer test account.

ClickUp: Free workspace Soldline Demo.

Vercel: Hobby, not linked yet.

Email: team inbox for demo email instead of Gmail.

Service credentials are managed outside the repo. Variable names and purposes are listed in the example environment file. No key values are stored here.
