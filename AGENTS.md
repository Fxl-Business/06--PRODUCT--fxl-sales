# 06--PRODUCT--fxl-sales - Agent Standing Context

<!-- nexo:managed:start -->
<!-- Managed by Nexo (/nexo-init, /nexo-doctor). Edit only OUTSIDE these markers. -->

## Methodology: Nexo - Extreme Programming, enforced

Work runs through the loop, **one small slice at a time** (a feature is many slices):

```
Frame → Plan → [Human Gate] → Execute(Red→Green→Refactor) → Verify → Capture → ↺
```

- **Frame** - capture *what* + *why*; write acceptance criteria as testable statements ("given X, when Y, then Z").
- **Plan** - slice to the smallest shippable increment; state scope limits (YAGNI); name the test that proves "done". If it needs the word "and", it's two slices.
- **Human Gate (Gate 1)** - the human approves the plan + test contract. *(skippable: `--autopilot`)*
- **Execute** - **Red** (write the failing test = locked oracle, immutable to the implementer) → **Green** (simplest thing that passes) → **Refactor** (only on green).
- **Verify (Gate 2)** - a **different agent** runs the full suite + lint + typecheck + security, locally. Objective PASS/FAIL.
- **Capture** - atomic Conventional Commit; record the run in `nexo/runs/`; distill learnings to `nexo/knowledge/` + curate `CLAUDE.md`.

Roles never invert: the **human owns WHAT** (goals, priorities, "ship it", "stop - over-engineered"); the **agent owns HOW** (implementation, tests, refactor, research). If WHAT is unclear, **stop and ask** - never guess and build.

## The three gates

| Gate | Checks | Enforced by | Skippable? |
|---|---|---|---|
| **1 · WHAT** | the plan is right | the human | yes (`--autopilot`) |
| **2 · Machine** | tests + lint + typecheck + security green | a **separate Verify agent, run locally** | **never** |
| **3a · Cut → staging** | release-verify green + version correct; tag on `master` (`/nexo-ship`) | human approval | **never auto** |
| **3b · Staging → prod** | staging validated in-env; ff-push `production` | human approval | **never auto** |

## Delivery - local trunk + promotion (`master → staging → production`, no hosted CI)

- **`master`** is the single long-lived trunk. Always green (local Verify passed before merge), always testable. Everything integrates here.
- Per slice: short-lived **local** `feat/*` / `fix/*` → separate-agent Verify PASS → `git merge --no-ff` into `master` → delete branch → `git push origin master`.
- **Promotion (opt-in, this repo):** `staging` and `production` are **deployment pointers**, never integration branches. Promotion is **fast-forward-only** `git push` run by `/nexo-ship` (Gate 3a/3b) - never force-pushed, never reset, never merged `--no-ff`. The deploy platform (Vercel/Coolify) watches the branches; deploys happen ONLY from `staging`/`production` (`master` deploys are disabled in vercel.json).
- **No PRs, no hosted CI.** Gate 2 is the local Verify.
- **The user never commits by hand - Nexo runs the whole delivery sequence.**

## Conventional Commits (drives SemVer at ship time)

Atomic - one logical change per commit. If the message needs "and", split it.

```
<type>(<scope>): <summary>
```

Types: `feat` (→ minor) · `fix` / `perf` (→ patch) · `refactor` · `test` · `docs` · `chore` · `ci`.
Breaking change: `feat!:` or a `BREAKING CHANGE:` footer (→ major).

## Artifacts live in one place - `nexo/`

`ROADMAP.md` (backlog) · `state.json` (pointer + `delivery` block) · `plans/` · `runs/` · `milestones/` · `knowledge/{decisions,doubts}/` · `playbooks/`. Never scatter into `.nexo/`, `docs/nexo/`, or `.planning/`.

<!-- nexo:managed:end -->
