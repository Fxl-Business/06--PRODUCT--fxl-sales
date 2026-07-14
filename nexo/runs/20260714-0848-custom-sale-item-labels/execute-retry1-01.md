# Execute retry 1 - Quantity control accessibility

Status: PASS

The verifier finding was confirmed in rendered-row markup: repeated quantity inputs were unnamed spinbuttons because the visual `Qtd.` header had no programmatic association.
The focused web oracle was extended first with exact queries for `Quantidade do item 1` and `Quantidade do item 2`.
RED reproduced with 1 of 5 tests failing at `input not found: Quantidade do item 1`.
The only production change adds the `Quantidade do item ${index + 1}` `aria-label` value to the existing quantity input.
GREEN passed all 5 focused web tests.
The focused API test passed all 4 tests, web lint passed, web type-check passed, and `git diff --check` passed.
No unrelated behavior or files changed.
Commit: `b24e33ef10011bf9c67658ffd4077e207b76521a fix(sales): label item quantity controls`.
