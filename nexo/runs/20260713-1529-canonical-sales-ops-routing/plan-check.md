# Plan check: Canonical Sales Ops routing

## Verdict

PASS.
The revised single slice covers the feature contract and is executable without unresolved design decisions.

## Prior blocker resolution

1. Route parameters are now consistent.
   Production and rendered tests use `/` plus `/:workspace/:view`, which supplies both parameters consumed by `useParams`.
   Static legacy route ranking and the final catch-all behavior are explicitly preserved.

2. Cadastros vocabulary and authorization are exact.
   The internal identifier, private array, metadata label, visible switcher label, visual key, and canonical URL all use `cadastros` or `Cadastros` as appropriate.
   Non-team Cadastros navigation returns `[]` exactly, while operational navigation remains available to every role.
   This prevents forbidden `/cadastros/*` pairs from being accepted by the shared navigation source of truth.

3. The missing interaction oracles are now locked.
   A rendered role-switch test proves an allowed operational route is preserved and a forbidden Cadastros route is replaced with the new role default.
   A rendered dashboard test proves `Ver todas` uses `go('vendas')` to reach `/operacional/vendas`.

4. Gate 2 is fully specified.
   The separate Verify agent must run exact repository-wide test, lint, type-check, build, high-severity dependency audit, and diff-hygiene commands once without watch mode.

## Contract checks

- The canonical matrix contains all eight team routes and the complete seller and finder matrices.
- Root, unknown, mismatched, forbidden tactical, and non-team Cadastros inputs resolve to exact role defaults with replace semantics.
- The URL is the only workspace and page source of truth, and route-local React state is removed.
- Deep links, click navigation, Back and Forward, dashboard navigation, role switching, refresh, and role-aware redirects have exact automated or browser audit coverage.
- Existing `/admin/*`, `/finder/*`, `/seller/*`, and `/no-role` behavior is protected by route placement, explicit scope constraints, diff inspection, and browser audit.
- RED 1 and RED 2 state valid pre-change failure reasons and name focused run-once commands.
- Exact helper interfaces, handler behavior, file paths, and commands are provided.
- `files_modified` contains every stated product and test file, including the new rendered routing test.
- Frontmatter has valid `id`, `milestone`, `status`, `depends_on`, `files_modified`, and testable `acceptance` fields.
- Wave derivation reports one dependency-free wave.
- API endpoints, auth claims, role grants, server rewrites, database schemas, and persistence remain out of scope.
- The overview and slice contain no em dash and no unresolved placeholder.

## Result

The plan is ready for execution under the stated Autopilot flow and mandatory separate-agent Gate 2.
