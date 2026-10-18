# Soldline

## Done

P1 app scaffold with one landing placeholder, English and Arabic message skeletons, design tokens, strict TypeScript, HTTP fixtures and a gate for lint, types, tests and production build. Playwright lives in a separate package under e2e. The final gate passed all 39 tests and the production build. The deliberate test failure returned 1 and the restored gate returned 0. See verification.md for evidence.

P2 database schema now contains all 27 app tables with generated Drizzle SQL, workspace foreign keys, enabled and forced row security, private member records, company access and contributor run access. Manual SQL creates the app role, fixed search path helpers and a locked audit chain. Local PGlite fixtures exercise migrations and policy removal. The migration runner reads DATABASE_URL_OWNER only when explicitly invoked.

## Next

P3 sign in, demo personas and permissions. Build the server action permissions matrix and approved mutation functions. Continue using local fixtures until live service work is explicitly requested.

## Decisions

Node 22 is the target. This machine runs Node 20.19.2. The package engine accepts Node >=20.9 as requested. Next.js 16 itself requires Node >=20.9.

Use pnpm, Next.js 16 App Router, TypeScript strict and Tailwind 4. White background, Charcoal Ink text, Deep Muted Teal for primary buttons and active state only, Dusty Camel for structural borders and neutral borders elsewhere. Spacing is 4, 8, 12, 16 and 24 pixels. Radius is 6 or 8 pixels.

Inter uses weights 400 and 600. IBM Plex Sans Arabic uses 400 only with synthetic weight disabled. Both use next/font/google and are downloaded at build time.

Email goes through the team inbox adapter, not Gmail (Adhil, Oct 18 2026).

The gate stops at the first failed step and preserves its exit code. Detector tests cover visible copy and prohibited visual patterns. HTTP tests reject requests without a fixture.

The app role has no table ownership and no row security bypass. It receives table reads under policies and audit_append execution. General table writes remain denied until P3 introduces the action permissions matrix and approved server functions. Migration and fixture owners need row security bypass for helper lookups and fixture setup. Production requests must use soldline_app rather than the migration owner.

Every workspace record repeats its own id as workspace_id. Auth records are workspace scoped and use composite references to prevent links across workspaces. Thread and message fields fill in the unspecified model with member ownership, body, role, title and creation time.

Audit appends use built in sha256 and gen_random_uuid without extensions. Canonical audit text fixes the timezone to UTC. Actor identity comes from the current member, not the supplied event. Complete chain verification requires admin visibility or an owner connection. The migration ledger lives in the drizzle schema and rejects changed applied files.

## Parked

Contributors see runs linked to findings or recovery_items they own until tasks exist. Replace this approximation when task ownership is available.

P3 owns sign in, demo personas, permissions and approved mutation functions. Provider connections, token encryption use, jobs, approvals, delivery features, language switching and deployment belong to later phases. No live services were called during P2. Production concurrency across database connections remains untested because all database tests use PGlite.

## Services

GitHub repo: shanifadhil33-blip/soldline.

Neon project: soldline, region us-east-1.

HubSpot: developer test account.

ClickUp: Free workspace Soldline Demo.

Vercel: Hobby, not linked yet.

Email: team inbox for demo email instead of Gmail.

Service credentials are managed outside the repo. Variable names and purposes are listed in the example environment file. No key values are stored here.
