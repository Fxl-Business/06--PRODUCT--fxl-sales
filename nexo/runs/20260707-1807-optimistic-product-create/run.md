# Optimistic Product Create

## Frame

The user wants create actions to feel instant in the application.
The approved autopilot slice implements that behavior for Admin Products creation.

## Slice

| Slice | Status | Evidence |
|---|---|---|
| 01-optimistic-product-create | done | Red test failed before implementation, passed after implementation, and passed separate Gate 2 verification. |

## Red

`pnpm --filter @fxl-sales/web test -- src/admin/products/__tests__/useProducts.test.ts` failed because the product list cache still contained only the existing product while the create request was pending.

## Green

The same command passed after adding optimistic create, success reconciliation, and failure rollback in `useCreateProduct`.

## Local Checks Before Verify

`pnpm --filter @fxl-sales/web test -- src/admin/products/__tests__/useProducts.test.ts` passed.
`pnpm --filter @fxl-sales/web type-check` passed.
`pnpm --filter @fxl-sales/web lint` passed.

## Gate 2

First separate verifier failed because root `pnpm test` and `pnpm type-check` could not resolve `@fxl-sales/shared-utils` from a fresh worktree without ignored `dist` output.
The root cause was that shared workspace packages export `dist/*`, while the root test and typecheck scripts did not build those packages first.
`package.json` now runs `build:packages` before root `test` and `type-check`.
Final separate verifier passed at `nexo/runs/20260707-1807-optimistic-product-create/agents/verify4-01-optimistic-product-create.result.json`.
Post-merge wave verifier passed on `master` at `nexo/runs/20260707-1807-optimistic-product-create/agents/wave-verify-optimistic-product-create.result.json`.
