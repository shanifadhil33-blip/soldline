# P1 verification

The gate command is `node scripts/gate.mjs`. It runs lint, typecheck, test and build in that order. The first failure stops the gate and returns the failing exit code. A spawn error or signal returns 1.

The gate tests launch the actual script with a local pnpm stand in. They record each invoked step and assert the following results.

| Failure | Exit code | Steps invoked |
| :--- | :--- | :--- |
| lint | 7 | lint |
| typecheck | 7 | lint, typecheck |
| test | 7 | lint, typecheck, test |
| build | 7 | lint, typecheck, test, build |
| None | 0 | lint, typecheck, test, build |

The full gate first returned 0 with 39 tests passing and a successful production build. The database smoke test was then deliberately changed to expect 2 from select 1. The full gate returned 1 with that assertion failure and did not run the build. The original assertion was restored before the final gate run. That run returned 0 with all 39 tests passing, clean lint, a successful typecheck and a successful production build.

Run command: `pnpm gate > /tmp/gate.out 2>&1; echo $?`

## Scope

No service accounts were opened or linked. No live HubSpot, ClickUp, Gmail or AI calls were made. The HTTP smoke test uses MSW and the database smoke test uses PGlite in memory. Google fonts are fetched during the Next.js build as requested.

Both dependency installs use storage inside this repo. The first attempt for each package could not create the default pnpm directory outside the repo. Local npm configuration fixed this. No global install was performed.

Playwright is installed in e2e with its own lockfile and a landing smoke spec. Browser execution is outside the P1 gate and was not run. Browser binaries were not installed.

Package installation reported an ESLint 9 deprecation and ignored optional dependency build scripts. Required gate checks pass without enabling those scripts.

## Files created

```text
.env.example
.gitignore
.npmrc
package.json
pnpm-lock.yaml
tsconfig.json
next-env.d.ts
eslint.config.mjs
postcss.config.mjs
vitest.config.ts
scripts/gate.mjs
src/app/page.tsx
src/app/layout.tsx
src/app/globals.css
src/styles/tokens.css
messages/en.json
messages/ar.json
tests/no-dash.test.ts
tests/no-ai-look.test.ts
tests/no-jargon.test.ts
tests/gate.test.ts
tests/pglite.test.ts
tests/http.test.ts
tests/setup.ts
tests/helpers/source.ts
tests/fixtures/http.ts
e2e/.npmrc
e2e/package.json
e2e/pnpm-lock.yaml
e2e/playwright.config.ts
e2e/specs/landing.spec.ts
docs/STATE.md
docs/verification.md
```

README.md was updated.
