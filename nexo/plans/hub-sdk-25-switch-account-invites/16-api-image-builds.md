---
id: 16-api-image-builds
milestone: v4.1.0
status: todo
depends_on: [14-send-invite-to-uninvited-seller]
files_modified:
  - apps/api/Dockerfile
  - scripts/__tests__/api-dockerfile-workspace-deps.test.mjs
  - package.json
acceptance: "given a clean `git archive` of master, when `docker build -f apps/api/Dockerfile .` runs, then it succeeds; and a static guard fails whenever an `apps/api` `workspace:` dependency (dependencies or devDependencies) has no package.json COPY in the Dockerfile deps stage and no node_modules COPY into the build stage."
goal: "Release-verify of v4.1.0 found the production API image does not build: tsc follows src/auth/select.ts's dynamic import into packages/auth-fake, whose dependency @fxl-business/fxl-contracts/testing the deps stage never installs (introduced by 430cc96). Fix it and make the class of bug impossible to merge silently."
verifier_focus: "Build the REAL image from a clean `git archive HEAD` (not the working tree) and see it succeed, and see it FAIL at the pre-fix commit. Run the built image's migrate + server boot far enough to prove dist/server.js and dist/db/migrate.js start with NODE_ENV=production and refuse SALES_AUTH_FAKE (the existing boot refusal). The guard is non-vacuous: remove the auth-fake COPY lines -> RED."
must_not_break:
  - "The runtime CMD stays `node dist/db/migrate.js && exec node dist/server.js` (owner decision 2026-10-01)."
  - "scripts/__tests__/auth-fake-isolation.test.mjs; the known auth-fake-in-image gap is NOT widened beyond the package's own install (no NODE_ENV change)."
rules:
  - "Added after the v4.1.0 release-verify FAIL (ship flow: fix on main, re-run ship)."
  - "Minimal fix: COPY packages/auth-fake/package.json in deps, COPY its node_modules into build. Do not attempt the ROADMAP Dockerfile hardening (--prod, scoped runtime copy) here."
---

# Slice 16 - the API image builds again

## Oracle

- `node --test scripts/__tests__/api-dockerfile-workspace-deps.test.mjs` (new, in the root test script).
- A real `docker build` from a clean archive, by the Verify agent.
