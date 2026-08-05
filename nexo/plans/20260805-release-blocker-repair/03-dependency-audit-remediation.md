---
id: 03-dependency-audit-remediation
milestone: v2.4.0
status: done
depends_on: []
files_modified: [apps/api/package.json, apps/web/package.json, pnpm-workspace.yaml, pnpm-lock.yaml]
acceptance: "given the complete workspace dependency graph, when production and full audits run at high severity, then both exit zero with no high or critical findings and the repository quality gates remain green"
---

# Dependency Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all high-severity dependency findings with the narrowest compatible development-tooling update.

**Architecture:** Refresh only the direct tooling roots that own the vulnerable `postcss` and `brace-expansion` paths.
Let pnpm re-resolve compatible transitive versions and keep runtime dependency changes outside this slice.

**Tech Stack:** pnpm 10.17.1, npm registry advisories, ESLint, TypeScript ESLint, PostCSS, and the existing monorepo quality scripts.

## Global Constraints

- Do not use `pnpm audit --fix --force`.
- Do not upgrade Hono, React Router, or any unrelated runtime dependency in this slice.
- Do not manually edit `pnpm-lock.yaml`.
- Keep package ranges within their current major versions.
- Add the narrow `brace-expansion@<1.1.18` override because an isolated targeted update proved the current ESLint graph otherwise retains `1.1.15`.
- The full audit must report zero high and zero critical findings.
- Moderate findings are not silently upgraded into unrelated runtime work.
- Run every check once without watch mode.

## Current Red evidence

`pnpm audit --audit-level high --json` exits 1 with six high findings.
The vulnerable lock entries are `postcss@8.5.16`, `brace-expansion@1.1.15`, and `brace-expansion@5.0.7`.
The registry currently provides patched `postcss@8.5.25`, `brace-expansion@1.1.18`, and `brace-expansion@5.0.9`.
The two brace versions remain compatible with their existing `minimatch` major ranges.

### Task 1: Record the locked audit failure

**Files:**

- Read: `apps/api/package.json`
- Read: `apps/web/package.json`
- Read: `pnpm-lock.yaml`

- [ ] **Step 1: Run both audit oracles before changing dependencies**

```bash
pnpm audit --prod --audit-level high
pnpm audit --audit-level high
```

Expected Red: the production-only audit exits zero, while the full audit exits one with six high `postcss` and `brace-expansion` findings.
Save the command exits and vulnerable resolved versions in the slice run record.

### Task 2: Refresh only the owning tooling roots and pin the proven 1.x floor

**Files:**

- Modify: `apps/api/package.json` only if pnpm raises an existing compatible minimum.
- Modify: `apps/web/package.json` only if pnpm raises an existing compatible minimum.
- Modify: `pnpm-workspace.yaml` to pin the patched `brace-expansion` 1.x transitive floor.
- Modify: `pnpm-lock.yaml` through pnpm.

- [ ] **Step 1: Run the targeted compatible update**

```bash
pnpm update --recursive postcss eslint @eslint/js typescript-eslint
```

Do not add `--latest` because that would permit new major versions.
Inspect the diff and reject any runtime dependency change.

- [ ] **Step 2: Verify the patched resolved versions**

```bash
rg -n 'postcss@8\.5\.(2[5-9]|[3-9][0-9])|brace-expansion@1\.1\.18|brace-expansion@5\.0\.9' pnpm-lock.yaml
pnpm why brace-expansion -r
pnpm why postcss -r
```

Green requires every `1.x` brace path to resolve to at least `1.1.18`, every `5.x` brace path to resolve to at least `5.0.9`, and PostCSS to resolve above `8.5.17`.

- [ ] **Step 3: Add the required narrow 1.x override**

An isolated run of the targeted update selected `brace-expansion@5.0.9` but retained vulnerable `brace-expansion@1.1.15`.
Add this selector-specific override to the existing `overrides` block in `pnpm-workspace.yaml` and regenerate the lockfile.

```yaml
  'brace-expansion@<1.1.18': 1.1.18
```

```bash
pnpm install --lockfile-only
```

Do not add a 5.x override because the targeted compatible update already selects `5.0.9`.

### Task 3: Prove Green and preserve repository behavior

**Files:**

- Verify: `package.json`
- Verify: `apps/api/package.json`
- Verify: `apps/web/package.json`
- Verify: `pnpm-lock.yaml`

- [ ] **Step 1: Run the security gates**

```bash
pnpm audit --prod --audit-level high
pnpm audit --audit-level high
```

Expected Green: both commands exit zero with no high or critical findings.

- [ ] **Step 2: Run the complete compatibility gates**

```bash
CI=true pnpm run lint
CI=true pnpm run type-check
CI=true pnpm test
CI=true pnpm run build
```

Expected Green: all commands exit zero and no test runner remains active.

- [ ] **Step 3: Verify diff scope and commit atomically**

```bash
git diff --check
git diff --name-only
git add apps/api/package.json apps/web/package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore(deps): clear high-severity tooling advisories"
```

Stage only files that actually changed.
