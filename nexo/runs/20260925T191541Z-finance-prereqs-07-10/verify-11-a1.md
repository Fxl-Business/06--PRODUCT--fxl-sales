# Verify 11-api-test-typecheck (attempt a1)

Verdict: PASS
Branch feat/20260925-11-api-test-typecheck, head 1efea989f85a451abcbee50c5e0e72c2f5bd52f1, base master c79abed.

## Diff hygiene

16 files, all in the plan's files_modified list plus the new helper `apps/api/test/rls/first-row.ts`, `apps/api/tsconfig.test.json` and root `package.json` (guard wiring).
No nexo/runs, nexo/plans or .env files in the diff.
No product code (`apps/api/src`) changed.

## Weakened-test review

Every hunk of every test file was read.
108 removed / 119 added lines in the six large files; after filtering the mechanical `const [x] = await ...` to `const x = firstRow(await ..., 'x')` rewrite, every remaining hunk was inspected by hand.
- Every `expect(...)` removed was re-added verbatim with only `rows[0]` replaced by `firstRow(rows, '...')`; matchers and expected values are identical (no toEqual to toMatchObject, no exact to contains).
- No `.skip`, `.todo`, `.only`, early return or new conditional that could make an assertion unreachable.
- No new `as any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `as unknown as`, or non-null `!` in the diff.
- `lead-stages-rls.test.ts`: `created[1]` is guarded by `if (!second) throw new Error(...)`, a failing guard.
- `proposal-schema-migration.test.ts` `payableAfterDelete`: the row is expected to exist (asserts `receivableId` is null after the receivable delete), so `firstRow` is correct there.
- `audit-history-org-scope.test.ts`: `after` narrowed from `Record<string, unknown> | null` to `Record<string, string | number>` (all SEED_ROWS carry string objects, none null) and bound via `adminClient.json(row.after)::jsonb`; the comment was updated accordingly and the suite's `->>` assertions still pass, so the jsonb shape is unchanged.
- `settlements-schema.test.ts`: helper param widened to `Sql | postgres.TransactionSql` (a real type, not a cast).
- `conversion-webhook-contract.test.ts`: only unused imports removed.
- `firstRow<T>(rows, what)` throws `Error("expected a row for <what>, but there was none")` when `rows[0] === undefined`; it never returns a default.

## Oracles (run-once, in the slice worktree)

- TEST_DATABASE_URL and TEST_MIGRATE_DATABASE_URL both point at localhost:5006; apps/api/.env is git-ignored. db:migrate was not run.
- `pnpm run type-check`: exit 0; the api step runs `tsc --noEmit && tsc --noEmit -p tsconfig.scripts.json && tsc --noEmit -p tsconfig.test.json`.
- Mutation: appended `export const n: number = 'x';` to `apps/api/test/rls/leads-rls.test.ts`; type-check exit 2 with `TS2322` at that line; reverted, tree clean.
- `node --test scripts/__tests__/api-test-typecheck.test.mjs`: 3/3 pass.
  Negative control: removing `&& tsc --noEmit -p tsconfig.test.json` from apps/api/package.json makes it fail 1 of 3; reverted.
- Guard wiring is not vacuous: it is listed by explicit path in the root `test` script's `node --test` list, its three subtests appear in the `CI=true pnpm test` output, and `node --test` on a missing file exits 1 on this machine.
- `pnpm run lint`: exit 0.
- `CI=true pnpm test`: exit 0 (auth-fake 35, shared-utils 155, api 678, web 998, node guards 58/58).
- `CI=true pnpm --filter @fxl-sales/api test:integration`: exit 0, 35 files, 272/272 (matches master).

## Notes

- The web unit suite prints React Router v7 future-flag warnings and dnd-kit component stacks; pre-existing noise, not caused by this slice.
- No processes left running; worktree clean at 1efea98.
