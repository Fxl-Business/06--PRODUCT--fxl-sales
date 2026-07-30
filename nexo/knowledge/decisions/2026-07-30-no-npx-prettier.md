# Never run `npx prettier` in this repo

**Date:** 2026-07-30
**Surfaced by:** slice 04 of `batch-01K9NX4QPTUI0730CADPRODWIZ`

## The trap

Prettier is **not a dependency of this repo**. Running `npx prettier --write` therefore
downloads a newer major from the registry and formats with ITS defaults, not the repo's.
On `apps/web/src/sales-ops/SalesOpsApp.tsx` that reformatted **591 unrelated lines**,
burying a 31-line change in noise. The executor had to revert all three files and redo
every edit by hand.

## The rule

Match the surrounding code by hand. Nothing in this repo enforces prettier - `pnpm run lint`
is ESLint only - so there is no formatter to satisfy and no reason to invoke one.

If a diff comes back with hundreds of lines you did not intend to touch, this is the first
thing to suspect.
