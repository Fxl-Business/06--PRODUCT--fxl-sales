# 06--PRODUCT--fxl-sales - Agent Standing Context

<!-- nexo:managed:start version=4 sha256=02fd055249adb37ac71ec0db87e5e313c575eadc762d972ac81c07a1a398a84b -->
## Nexo workflow contract

Nexo owns the delivery workflow while a Nexo flow is active.
Work moves through Frame, Plan, Execute, Verify, and Capture.
Feature and batch flows plan the complete initial slice set before execution, then adapt only within the finite runtime policy.

The human owns WHAT and why.
The agent owns HOW.
Gate 1 is human approval of WHAT and is skipped only by explicit autopilot.
Gate 2 is local verification and is never skipped.
Gate 3 is the human-approved release cut and is never automatic.

Verification is tiered.
Each slice runs its named locked oracle tests plus lint on changed files.
Each integrated wave runs the full suite, full lint, and security checks once.
Each feature runs mutation testing once after all waves are green.
Execute and Verify use separate agents whenever the host supports them and the user has not explicitly required single-agent execution.

Delivery is local trunk flow.
Verified short-lived branches merge serially to `main` with no pull request and no hosted CI requirement.
Promotion to `staging` and `production` exists only when `nexo/state.json` opts into it, and every promotion is fast-forward-only.
The user never commits by hand because Nexo owns branch, commit, verification, merge, and cleanup.

Autopilot never waits for a human and never expands a budget.
A blocker or exhausted budget is recorded in `AUDIT.md`, unfinished work is parked, owned worktrees and processes are cleaned up, and the run returns a partial completion report.
<!-- nexo:managed:end -->

## Repository delivery specifics (outside the managed block)

These facts are repo-local and override the generic wording above wherever they differ.

- The trunk of this repository is **`master`**, not `main`. Every "trunk" statement in the managed block above means `master` here, as declared by `delivery.trunk` in `nexo/state.json`.
- Promotion is opted in: `master` -> `staging` -> `production`, fast-forward-only, never force-pushed, never reset, never merged with `--no-ff`.
- `staging` and `production` are deployment pointers, never integration branches. The deploy platform watches those two branches; `master` deploys are disabled in `vercel.json`.
- Per slice: a short-lived local `feat/*` or `fix/*` branch, a separate-agent Verify PASS, `git merge --no-ff` into `master`, delete the branch, then `git push origin master`.
- Gate 3a cuts and tags on `master` and fast-forwards `staging`; Gate 3b fast-forwards `production` to that same tagged commit. Both are human-approved and never automatic.
- Artifacts live only under `nexo/`: `ROADMAP.md`, `state.json`, `plans/`, `runs/`, `milestones/`, `knowledge/{decisions,doubts}/`, `playbooks/`.
