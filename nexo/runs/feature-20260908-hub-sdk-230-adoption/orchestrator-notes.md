# Orchestrator notes - adoption run

## The concurrency collision, and the orchestrator error behind it

RESOLVED, and the SHA moved: `da43534` NO LONGER EXISTS. The slice-04 executor split it into
`3b6084d` (the two plan files, original message and dates preserved) and `4821d6b` (the actual
bump). Anything referring to `da43534` should read `4821d6b` for the slice.

THE ERROR WAS MINE AND IT IS WORTH NAMING. I ran `git add -A ':!.vscode'` on a branch where an
Execute agent was actively editing files, so my docs commit swallowed its four uncommitted code
files - both `package.json`s, the lockfile and a test fixture - and shipped them under a
`docs(nexo)` message. A dependency bump hidden inside a docs commit is unreadable history and would
have made the bump un-revertable on its own.

RULE FOR THE REST OF THIS RUN AND THE NEXT: never stage broadly while a subagent holds the same
working tree. Either commit only explicitly named paths, or do orchestrator writes while no agent
is running. The agent caught it and repaired it losslessly, which is luck plus a good executor, not
a control.

## Commit `3b6084d` on `feat/04-sdk-230-bump` is NOT part of slice 04

While the slice-04 Execute agent was running, the orchestrator amended the slice-05 and frame plan
documents in response to a correction from the Hub session, and committed them while still standing
on the `feat/04-sdk-230-bump` branch. That was an orchestrator slip, not the executor's work.

`3b6084d` touches ONLY:
- `nexo/plans/feature-20260908-hub-sdk-230-adoption/00-OVERVIEW.md`
- `nexo/plans/feature-20260908-hub-sdk-230-adoption/05-contract-single-resolver.md`

It was left on this branch rather than cherry-picked to `master`, because moving it would have meant
switching branches under a running agent's working tree. Slice 04's Verify agent was told the
correct SHA and told to exclude it from scope judgement, and to report it as a finding if it turns
out to touch anything under `apps/`, `packages/` or `scripts/`.

## Why the amendment happened, recorded because it changes what slice 05 builds

The Hub session pointed out that `createHubBff` calls `assertBootConfiguration` internally. Verified
here in `dist/server.js`. So the original plan - call the assertion, then construct the BFF - would
have resolved the configuration TWICE, and a divergence between the two option objects would mean
validating one configuration and constructing another. The value they would disagree about is
`redirectUri`, which is precisely what check 7 exists to catch.

Working that deletion through then surfaced a second thing the plan had wrong on its own:
`hubConfigPresence` cannot simply be deleted. `tryLoadHubAuthConfig` answers a question the SDK has
no API for - has this machine been given credentials at all - and that is what keeps
`503 hub_auth_not_configured` alive for a fresh clone. Recovering it with a `try/catch` around
`loadHubConfig` would install the blanket catch the file header explicitly forbids. So it shrinks to
an absent-check and everything else goes.

That in turn produced a named behaviour change which is now pinned by its own oracle rather than
absorbed into an existing test: the `incomplete` presence stops answering `503` and becomes a boot
failure carrying the SDK's own message.
