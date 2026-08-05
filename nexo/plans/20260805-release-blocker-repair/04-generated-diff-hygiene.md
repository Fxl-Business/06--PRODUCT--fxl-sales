---
id: 04-generated-diff-hygiene
milestone: v2.4.0
status: todo
depends_on: []
files_modified: [.gitattributes]
acceptance: "given historical generated Nexo context packs and an ordinary tracked file, when Git checks the release diff for whitespace errors, then context-pack snapshots are exempt while the ordinary file still fails the check"
---

# Generated Diff Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep immutable generated context-pack snapshots from failing the release whitespace gate without weakening checks for authored files.

**Architecture:** Use Git's path-specific `whitespace` attribute.
Unset that attribute only for `nexo/runs/**/context-pack.md`, which Git documents as disabling whitespace-error detection for matching paths.

**Tech Stack:** Git attributes and `git diff --check`.

## Global Constraints

- Never edit an existing generated context pack.
- Exempt only files named `context-pack.md` below `nexo/runs/`.
- Do not change global or repository `core.whitespace` configuration.
- Prove ordinary files still fail the whitespace gate.
- Remove the temporary negative-control file and its index entry before commit.

### Task 1: Lock the current Red gate

**Files:**

- Read: `nexo/runs/batch-20260803-auth-session/context-pack.md`
- Read: `nexo/runs/batch-20260804-props-costs/context-pack.md`

- [ ] **Step 1: Reproduce the exact release failure**

```bash
git diff --check v2.3.1..HEAD
```

Expected Red: four errors from the two generated historical context packs.

### Task 2: Add the path-specific generated-output policy

**Files:**

- Create: `.gitattributes`

- [ ] **Step 1: Add exactly one rule**

Use `apply_patch` to create `.gitattributes` with this exact content.

```gitattributes
nexo/runs/**/context-pack.md -whitespace
```

Git's documented `whitespace` attribute behavior defines the unset state as noticing no whitespace errors for the matched path.

- [ ] **Step 2: Verify the generated snapshots are byte-for-byte unchanged**

```bash
git diff --exit-code HEAD -- nexo/runs/batch-20260803-auth-session/context-pack.md nexo/runs/batch-20260804-props-costs/context-pack.md
git check-attr whitespace -- nexo/runs/batch-20260803-auth-session/context-pack.md nexo/runs/batch-20260804-props-costs/context-pack.md
```

Expected Green: the first command exits zero and both attributes report `whitespace: unset`.

### Task 3: Prove the exemption is narrow

**Files:**

- Create temporarily: `nexo/runs/batch-20260805-release-blocker-repair/whitespace-negative-control.txt`
- Delete before commit: `nexo/runs/batch-20260805-release-blocker-repair/whitespace-negative-control.txt`

- [ ] **Step 1: Run the positive release gate**

```bash
git add .gitattributes
git diff --check v2.3.1
```

Expected Green: no output and exit zero.

- [ ] **Step 2: Add a normal-file negative control with `apply_patch`**

Create the temporary file with one line whose final character is a space.
Mark the new path for diff inspection and run its check.

```bash
git add -N nexo/runs/batch-20260805-release-blocker-repair/whitespace-negative-control.txt
git diff --check -- nexo/runs/batch-20260805-release-blocker-repair/whitespace-negative-control.txt
```

Expected Red: Git reports `trailing whitespace` for the temporary ordinary file.

- [ ] **Step 3: Remove the negative control safely**

Delete the temporary file with `apply_patch`, then run:

```bash
git reset -q -- nexo/runs/batch-20260805-release-blocker-repair/whitespace-negative-control.txt
git status --short
git diff --check v2.3.1
```

Expected Green: the temporary path is absent, only `.gitattributes` is staged for this slice, and the release diff check exits zero.

### Task 4: Commit the policy atomically

- [ ] **Step 1: Inspect and commit**

```bash
git diff --cached --check
git diff --cached -- .gitattributes
git commit -m "chore(git): exempt generated context packs from whitespace checks"
```

Do not stage any context pack or unrelated file.
