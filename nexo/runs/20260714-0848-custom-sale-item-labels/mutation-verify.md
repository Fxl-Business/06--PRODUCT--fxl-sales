# Feature-boundary mutation verification

- Agent: `mutation-verify`
- Slice: `feature-boundary`
- Branch: `feat/01-custom-sale-item-labels`
- Worktree: `.worktrees/01-custom-sale-item-labels`
- Started: `2026-07-14T12:27:04Z`
- Verdict: `PASS`

## Preconditions

The feature worktree was on the required branch and `git status --short` was empty before mutation.

## Mutant A: custom item display chooser

Temporary mutation:

```ts
return product.name;
```

The mutation replaced the open-price fallback chooser that normally returns `item.customLabel.trim() || product.name`.

Command:

```text
pnpm --filter @fxl-sales/web test src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx
```

Mutated result: exit `1`, with 1 failed and 4 passed tests.

The failing test was `keeps repeated custom labels independent and submits them in review order`.

The review expected `Módulo Vendas, Módulo RH` but received `FXL Custom, FXL Custom`, directly exposing the loss of independent custom labels.

After restoring the exact production line with `apply_patch`, the same command exited `0` with 5 of 5 tests passing.

## Mutant B: API product-name validation

Temporary mutation:

```ts
productName: z.string().min(1),
```

The mutation replaced `z.string().trim().min(1).max(140)`.

Command:

```text
pnpm --filter @fxl-sales/api test src/domains/sales-ops/__tests__/service.test.ts
```

Mutated result: exit `1`, with 2 failed and 2 passed tests.

The ledger test received `  Módulo Vendas  ` instead of the normalized `Módulo Vendas` snapshot.

The API-boundary test also observed whitespace-only `productName` input being accepted.

These failures directly expose lost whitespace normalization and blank-name rejection.

After restoring the exact schema line with `apply_patch`, the same command exited `0` with 4 of 4 tests passing.

## Final integrity checks

`git status --short` produced no output in the feature worktree.

`git diff --check` exited `0` with no output.

No mutation survived, both production edits were restored, and the feature worktree is clean.

## Verdict

`PASS`
