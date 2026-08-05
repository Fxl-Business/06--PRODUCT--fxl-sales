# Execute evidence - 04-generated-diff-hygiene

Commit: `5edc0868bbc8f1a61a1fb19a4942a096a1f40bea`

Changed only `.gitattributes` with the required rule:

```gitattributes
nexo/runs/**/context-pack.md -whitespace
```

## Red evidence

`git diff --check v2.3.1..HEAD` exited 2 before the policy.

It reported four errors across the two historical generated context packs: one trailing-whitespace error and one final blank-line error in each file.

## Green evidence

`git diff --exit-code HEAD -- nexo/runs/batch-20260803-auth-session/context-pack.md nexo/runs/batch-20260804-props-costs/context-pack.md` exited 0 before the commit.

`git check-attr whitespace -- nexo/runs/batch-20260803-auth-session/context-pack.md nexo/runs/batch-20260804-props-costs/context-pack.md` reported `whitespace: unset` for both paths.

`git diff --check v2.3.1` exited 0 after staging and again after the commit.

`git show --check --format=fuller HEAD` exited 0.

## Narrowness evidence

The temporary ordinary path `nexo/runs/batch-20260805-release-blocker-repair/whitespace-negative-control.txt` was created through `apply_patch` with trailing whitespace.

After `git add -N`, `git diff --check -- nexo/runs/batch-20260805-release-blocker-repair/whitespace-negative-control.txt` exited 2 and reported trailing whitespace.

The temporary file was deleted through `apply_patch` and its index entry was removed with `git reset -q --` before committing.

## Self-review

The committed diff is exactly one `.gitattributes` rule, scoped only to `nexo/runs/**/context-pack.md`.

No generated context pack was edited or staged.

No temporary negative-control file remains.
