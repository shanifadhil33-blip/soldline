# Soldline

## Done

P1 app scaffold with one landing placeholder, English and Arabic message skeletons, design tokens, strict TypeScript, HTTP fixtures and a gate for lint, types, tests and production build. Playwright lives in a separate package under e2e. The final gate passed all 39 tests and the production build. The deliberate test failure returned 1 and the restored gate returned 0. See verification.md for evidence.

## Next

P2 database schema, migrations, access policies and audit records. Use local fixtures until live service work is explicitly requested.

## Decisions

Node 22 is the target. This machine runs Node 20.19.2. The package engine accepts Node >=20.9 as requested. Next.js 16 itself requires Node >=20.9.

Use pnpm, Next.js 16 App Router, TypeScript strict and Tailwind 4. White background, Charcoal Ink text, Deep Muted Teal for primary buttons and active state only, Dusty Camel for structural borders and neutral borders elsewhere. Spacing is 4, 8, 12, 16 and 24 pixels. Radius is 6 or 8 pixels.

Inter uses weights 400 and 600. IBM Plex Sans Arabic uses 400 only with synthetic weight disabled. Both use next/font/google and are downloaded at build time.

Email goes through the team inbox adapter, not Gmail (Adhil, Oct 18 2026).

The gate stops at the first failed step and preserves its exit code. Detector tests cover visible copy and prohibited visual patterns. HTTP tests reject requests without a fixture.

## Parked

Sign in, database connections, provider connections, jobs, approvals, delivery features, language switching and deployment belong to later phases. No live services are called during P1.

## Services

GitHub repo: shanifadhil33-blip/soldline.

Neon project: soldline, region us-east-1.

HubSpot: developer test account.

ClickUp: Free workspace Soldline Demo.

Vercel: Hobby, not linked yet.

Email: team inbox for demo email instead of Gmail.

Service credentials are managed outside the repo. Variable names and purposes are listed in the example environment file. No key values are stored here.
