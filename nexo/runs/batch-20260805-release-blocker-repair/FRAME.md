# Frame: v2.4.0 release blocker repair

## Intent

Repair every blocker proven by the independent `v2.4.0` release verification, then rerun the release gate on the exact integrated `master` commit.

## Why

The candidate cannot be promoted to staging while concurrent authentication can destroy a valid session, professional payable identity can suppress money owed, the full dependency audit contains high-severity findings, or the release diff hygiene gate fails.

## Acceptance

- Given concurrent refreshes for one durable session across independent stores, when one request rotates the token, then no stale request can delete the rotated session or clear the valid state.
- Given two sale professionals with the same display name, when one paid payable survives a won to open to won cycle, then only its source professional is suppressed and the other payable is created exactly once.
- Given the complete dependency graph, when the production and full high-severity audits run, then both exit zero.
- Given the complete release diff from `v2.3.1`, when `git diff --check` runs, then generated context packs do not produce false failures and normal files remain enforced.
- Given all four repairs integrated on `master`, when the independent release verifier runs the full suite, lint, type-check, build, integration tests, security audits, migration review, and diff check, then it returns PASS before Gate 3a is shown.

## Scope limits

No new product capability is added.
No unrelated runtime dependency is upgraded.
No generated context-pack snapshot is edited manually.
No production promotion or milestone close is part of the repair batch.

## Mode

The user approved the design and explicitly selected `--auto`.
Nexo Gate 1 is skipped for this batch.
Gate 2 and Gate 3 remain mandatory.
