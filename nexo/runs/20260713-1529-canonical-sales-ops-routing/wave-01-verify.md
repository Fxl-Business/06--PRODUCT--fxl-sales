---
agent: wave-verify
slice: 01-canonical-workspace-routes
status: PASS
base: c87114469210ab2cc35f32585e1c53b673f3c6e2
head: 368fa58e0b5d6bfa0bce1b6911150180538ba766
started: 2026-07-13T20:17:00Z
ended: 2026-07-13T20:20:09Z
findings_opened: 0
findings_open: 0
---

# Wave 01 integrated verification

## Verdict

PASS.

The integrated net product diff from `c871144..368fa58` satisfies the permitted acceptance and Done contract with zero opened findings and zero open findings.

## Machine gate

| Check | Result | Exact evidence |
|---|---:|---|
| `CI=true pnpm test` | PASS | 32 files and 320 tests passed: shared-utils 1 file / 17 tests, API 19 files / 162 tests, web 12 files / 141 tests |
| Focused canonical route oracles | PASS | Explicit in the root suite: pure navigation 85 tests plus rendered routing 7 tests, 92 tests total |
| `pnpm lint` | PASS | API and web ESLint completed with zero errors; package lint tasks completed |
| `pnpm type-check` | PASS | shared-types, shared-utils, API, and web completed with zero errors |
| `pnpm build` | PASS | API TypeScript build passed; web TypeScript and Vite production build passed; 1,807 modules transformed |
| `pnpm audit --audit-level high` | PASS | No known vulnerabilities found |
| `git diff --check c871144..HEAD` | PASS | Exit 0 with no whitespace errors |

The focused tests were not rerun separately because the root suite output made their exact 85 + 7 = 92 total explicit.

React Router emitted two informational v7 future-flag warnings during the rendered oracle, with no test failure or behavioral ambiguity.

## Independent review

- B1 is resolved.
  Direct invalid and role-forbidden locations render `<Navigate replace>`, and the history oracle proves Back returns to the prior valid entry instead of restoring the forbidden entry.
  Role-switch invalidation uses `navigate(path, { replace: true })`, and its history oracle proves Back does not restore forbidden Cadastros.
- Canonical URLs are the visible shell state source.
  Deep links, workspace and page clicks, Back, Forward, and role changes resolve from router params rather than duplicated workspace or view state.
- Route authorization is consistent with the Hub claim vocabulary.
  `admin`, `seller`, and `finder` map to `equipe`, `vendedor`, and `finder`; forbidden tactical and Cadastros routes replace to the active role's canonical default; users without a mapped role replace to `/no-role`.
- The pure route oracle covers all allowed canonical routes, missing and unknown params, every mismatched workspace/view pairing, explicit forbidden routes, workspace defaults, path construction, and role-view grants.
- The rendered oracle uses the real Sales Ops shell and covers canonical deep linking, click navigation, invalid and forbidden replacement, role-switch preservation and replacement, Back and Forward synchronization, and dashboard-card navigation.
- Existing legacy route trees are behaviorally unchanged by static inspection.
  The `/admin`, `/finder`, `/seller`, and `/no-role` definitions are byte-for-byte unchanged in the net diff, and React Router's static branches outrank the added `/:workspace/:view` branch.
- Scope is contained to the five files declared in plan frontmatter.
  No package manifest, lockfile, environment file, API authorization, persistence, or unrelated product tree changed.
- Security review found no new secret material, dangerous HTML or dynamic evaluation, dependency change, or server-side authorization regression surface.
  The new canonical entries remain wrapped in `Protected`, while existing backend and RLS authority is unchanged.

## Manual browser audit

The authenticated browser audit was not executed by this CLI verifier.
It remains a manual audit exactly as requested and was not replaced with a non-user-equivalent synthetic check.

## Process hygiene

All commands were run once in non-watch mode.
No process started by this verifier remains running.
Unrelated pre-existing processes from another project were not touched.
