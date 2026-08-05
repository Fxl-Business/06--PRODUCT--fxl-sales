# Verify report - 01-primary-button-never-flips-type

- Slice: `01-primary-button-never-flips-type`
- Branch: `fix/produto-wizard-step3-autosave` (`7af3f60`), one commit ahead of `master`
- Verdict: **PASS**
- Auditor: independent Verify sub-agent, Gate 2

## What the diff is

```
 apps/web/src/sales-ops/SalesOpsApp.tsx             | 33 +++++++-
 apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx | 60 ++++++++++++++
 nexo/plans/.../01-primary-button-never-flips-type.md | 91 ++++++++++++++++++++++
 3 files changed, 180 insertions(+), 4 deletions(-)
```

The behavioural change is two lines in the produto dialog footer plus one signature:

```diff
-  function submit(event: FormEvent) {
-    event.preventDefault();
+  function submit(event?: FormEvent) {
+    event?.preventDefault();
```

```diff
-                onClick={wizardStep < 4 ? advanceProductWizard : undefined}
-                type={wizardStep < 4 ? 'button' : 'submit'}
+                onClick={wizardStep < 4 ? advanceProductWizard : () => submit()}
+                type="button"
```

Everything else in the diff is comment.

## 1. Is the happy-dom claim true? Mutation experiment

Method: revert ONLY the source change (restore the step-dependent `type` and `onClick`), keep the new tests, run the dialog suite.

Baseline on the branch as delivered:

```
 ✓ src/sales-ops/__tests__/product-service-dialog.test.tsx (61 tests) 291ms
 Test Files  1 passed (1)
      Tests  61 passed (61)
```

With the bug reintroduced, whole file:

```
   × produto wizard step 3 -> 4 > keeps one activation behaviour on every step 7ms
 Test Files  1 failed (1)
      Tests  1 failed | 60 passed (61)
```

Per test, with the bug reintroduced:

```
 × produto wizard step 3 -> 4 > keeps one activation behaviour on every step 24ms
   -> expected 'step 4: submit' to be 'step 4: button'
 ✓ produto wizard step 3 -> 4 > advances from step 3 to step 4 without saving 7ms
 ✓ produto wizard step 3 -> 4 > still saves from the last step 5ms
```

Result: **the implementer's claim is TRUE, and the code comment does not overstate the limitation.**

`advances from step 3 to step 4 without saving` stays GREEN with the defect fully present.
It is a companion test, not the oracle, exactly as the comment in `product-service-dialog.test.tsx` says.
The single oracle in the suite is `keeps one activation behaviour on every step`, and it is the only test in all 537 web tests that goes red on the mutation.

Mechanically this is expected from the test harness itself: the file's `click()` helper does `element.dispatchEvent(new MouseEvent('click', ...))`, which never runs activation behaviour in any DOM implementation, and happy-dom does not model post-flush activation regardless.

Fix restored, byte-identical (`md5 4cea0f18e87f5737681bd56d00d474cf`), suite green again:

```
 ✓ src/sales-ops/__tests__/product-service-dialog.test.tsx (61 tests) 320ms
      Tests  61 passed (61)
```

## 2. Real browser verification

The implementer's harness was NOT used. I built my own:

- `apps/web/verify-harness.html` + `apps/web/src/verify-harness.tsx` (both since deleted).
- Mounts the REAL `ProductDialog` exported from `apps/web/src/sales-ops/SalesOpsApp`, inside `<StrictMode>`, with fixture props copied from the test file's `product()` / `areaFixture` / `funcao()`.
- `onSave` pushes to `window.__saves`.
- A **capture-phase `document` listener on `submit`** increments `window.__submits`, so a real form submission is counted whatever caused it, independently of whether `onSave` fired.
- `?mode=create` renders the create path (no `existing` product).
- Served with `pnpm exec vite --port 8098 --strictPort` from `apps/web`.
- Driven with real Chrome (Claude-in-Chrome), using **trusted OS-level mouse clicks and a trusted Return keypress**, not synthetic events.

### 2a. With the fix - walk 1 -> 2 -> 3 -> 4 using only the primary button

Trusted clicks on `Avançar`:

| click | from | to | saves | submits |
| --- | --- | --- | --- | --- |
| 1 | Passo 1 de 4 | Passo 2 de 4 | 0 | 0 |
| 2 | Passo 2 de 4 | Passo 3 de 4 | 0 | 0 |
| 3 | Passo 3 de 4 | Passo 4 de 4 | 0 | 0 |

End state: `{"step":"Passo 4 de 4","saves":0,"submits":0,"primaryType":"button","primaryLabel":"Salvar alterações"}`

**ZERO saves and ZERO form submissions across the whole walk.** Acceptance criterion 1 met.

The same walk driven programmatically (`element.click()`, which DOES run activation behaviour in Chrome) gave the identical result.

### 2b. Negative control - same walk, fix reverted

Source reverted to `type={wizardStep < 4 ? 'button' : 'submit'}` / `onClick={... : undefined}`, page reloaded, identical trusted-click walk on the identical harness:

```
click 1: Passo 1 -> Passo 2   saves 0   submits 0
click 2: Passo 2 -> Passo 3   saves 0   submits 0
click 3 (step 3 -> 4):
{"step":"Passo 4 de 4","primaryType":"submit","primaryLabel":"Salvar alterações",
 "saves":1,"submits":1,"savedName":"FXL Finance"}
```

**The reported defect reproduced exactly: one click on `Avançar` at step 3 advanced to step 4 AND fired one real form submission AND persisted one save the operator never approved.**
Steps 1 -> 2 and 2 -> 3 were unaffected, which matches the plan's root-cause analysis: step 3 is the one click that flips the element's own `type`.

The harness is therefore proven to be a real oracle, not a lying one.

### 2c. Fix restored, same browser session, same harness

```
{"step":"Passo 4 de 4","primaryType":"button","primaryLabel":"Salvar alterações",
 "saves":0,"submits":0}
```

Full A / B / A in one session: 0 saves with the fix, 1 save without it, 0 saves with it restored.

### 2d. The other three save paths (all with the fix in place)

**(a) The last step's primary button still saves exactly once.**
Trusted click on `Salvar alterações` at step 4:

```
before: {"saves":0,"submits":0,"type":"button"}
after:  {"saves":1,"submits":0,"step":"Passo 4 de 4",
         "savedId":"11111111-1111-4111-8111-111111111111","savedName":"FXL Finance"}
```

One save, and `submits: 0` - the form was never submitted, so a `onClick` save plus a form submit double-save is not merely unlikely, it is measured absent. See also audit point 3 below.

**(b) `Salvar alterações` (the real `type="submit"` secondary) on steps 1-3 still saves.**
On step 3:

```
{"s3":"Passo 3 de 4","secType":"submit","secIsPrimary":false,
 "saves":1,"submits":1,"step":"Passo 3 de 4"}
```

Exactly one save, through a genuine form submission, and the wizard correctly stayed on step 3.

**(c) Enter in `Parcelas restantes` on step 3 still ADVANCES and does not save.**
Real click into the input, then a real `Return` keypress:

```
{"step":"Passo 4 de 4","saves":0,"submits":0}
```

The behaviour commit `868439c` added survives untouched.

**(d) The create path still saves at step 4.**
`?mode=create`: title `Novo produto`, no `Salvar alterações` secondary anywhere (`hasSecondarySave: 0`), primary reads `Avançar` then `Adicionar`.
Filled Nome and Área with real typing and a real Combobox pick, then walked with the primary button:

```
step 3: {"saves":0,"submits":0,"primaryType":"button","primaryLabel":"Avançar","hasSecondarySave":0}
step 4: {"saves":0,"submits":0,"primaryType":"button","primaryLabel":"Adicionar"}
after clicking Adicionar:
{"saves":1,"submits":0,
 "payload":{"name":"Produto Verify","areaId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","codeSuffix":"8"}}
```

Reaches step 4 with zero saves and then saves exactly once with a complete payload.

## 3. Audit points

**Does `event?: FormEvent` break any other caller?**
No.
`grep -n "function submit"` finds seven `submit` functions in `SalesOpsApp.tsx` (lines 3009, 3735, 4670, 4797, 4882, 5027, 6826).
Only 3735, the one inside `ProductDialogBody`, changed; the other five still take a required `FormEvent` and live in separate component scopes (`ClientDialog`, `AreaDialog`, `FuncaoDialog`, `PersonDialog`, and the one at 3009), and 6826 takes a status string, not an event.
Within `ProductDialogBody` the changed `submit` has exactly two call sites: `onSubmit={submit}` on the form (React supplies a `FormEvent`, so `preventDefault` still runs) and `() => submit()` on the primary button.
Both were exercised in the browser above and both behave correctly.

**Could the primary button double-save on the last step?**
No, and it is measured rather than argued.
On step 4 the button is `type="button"`, which has no activation behaviour, so it cannot submit the owning form; and the `Salvar alterações` secondary (the only `type="submit"` in the dialog) is gated on `wizardStep < 4` and is not rendered at all on step 4.
The instrumented capture-phase `submit` counter read `0` while `onSave` read exactly `1`, on both the edit and the create path.

**Is the create path still able to save at step 4?**
Yes - measured in 2d(d) above.

**CLAUDE.md compliance.**
`git diff master..HEAD | grep -c '—'` returns `0`: no em dash anywhere in the diff, only plain dashes.
No CHANGELOG and no auto-generated file is touched.

**Scope.**
`git diff master..HEAD --name-only` returns exactly three paths:

```
apps/web/src/sales-ops/SalesOpsApp.tsx
apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx
nexo/plans/20260805-produto-wizard-step3-autosave/01-primary-button-never-flips-type.md
```

Within scope.

## 4. Gate commands

Each run exactly once, never in watch mode.

`pnpm run lint`:

```
apps/api lint: Done
apps/web lint: Done
```

`pnpm run type-check`:

```
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
```

`pnpm test`:

```
packages/shared-utils test:  Test Files  3 passed (3)   Tests  80 passed (80)
apps/api test:               Test Files 35 passed (35)  Tests 342 passed (342)
apps/web test:               Test Files 46 passed (46)  Tests 537 passed (537)
build-contract: ok
```

All green, including the tracked-file guard (`build-contract: ok`).

## 5. Observations, none blocking

1. **The plan's `files_modified` frontmatter lists `CLAUDE.md`, but the diff does not touch it.**
   The reasoning lives in two long in-code comments instead, which is defensible and arguably better placed.
   Worth a decision at Capture time whether the `type="button"` invariant deserves a line under `## UI Controls` in `CLAUDE.md`, since that file already codifies comparable dialog-level invariants such as `useInlineLayer`.

2. **A small, non-acceptance behaviour delta on step 4's Enter key, reasoned rather than measured.**
   Before the change, step 4's primary was `type="submit"` and was therefore the form's default button, so Enter from any step-4 field saved.
   After the change step 4 has no submit button at all, so Enter saves only via implicit submission from the form element itself, which per spec requires exactly one blocking field to be mounted.
   In the state I observed, step 4 mounts exactly one input (`Comissão do vendedor`), so Enter still saves there; if the operator adds `Custos padrão por função` rows, Enter on step 4 would stop saving.
   This is outside the slice's acceptance criteria, is the safe direction of failure (it can only save less, never more), and matches the posture commit `868439c` already established.
   Flagged for the record, not as a gate failure.

## 6. Tree restored

Scratch harness files deleted, vite killed by exact PGID (`kill -- -14979`), port 8098 confirmed free.

```
$ md5 apps/web/src/sales-ops/SalesOpsApp.tsx
MD5 (...) = 4cea0f18e87f5737681bd56d00d474cf     # identical to the delivered commit
$ git status --porcelain
?? .vscode/                                      # pre-existing, not mine
$ git diff master..HEAD --stat
 3 files changed, 180 insertions(+), 4 deletions(-)
```

`git diff master..HEAD` is unchanged from how I found it.

## Verdict

**PASS.**
The acceptance criteria are met and proven in the environment that can actually see the defect.
The negative control demonstrated the bug without the fix and its absence with it, in the same browser session on the same harness.
The mutation experiment confirms the guard is exactly as strong as the code comment claims, no more and no less: one real oracle (`keeps one activation behaviour on every step`) and one honest companion.
