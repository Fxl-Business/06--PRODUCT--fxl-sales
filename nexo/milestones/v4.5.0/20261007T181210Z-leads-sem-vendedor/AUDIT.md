# Autopilot audit - run 20261007T181210Z-leads-sem-vendedor

## Decisions taken without the human
- Integrated the waves on the run branch `feat/20261007-00-run` inside its own worktree and fast-forwarded `master` only once at the end, because another agent was working in the main checkout and a per-wave merge there would have rewritten files under it.
- Added slice 03 (per-org advisory board lock) mid-run: the slice 01 planner found a pre-existing deadlock between concurrent moves in the same column (40P01, a 500 to the user) and duplicate positions on concurrent creates; a shared pool of 114 leads in one column makes both likely.
- A converted lead with no vendedor shows the plain `Sem vendedor` line, not the `disponível` marker, because it is read-only and can never be claimed.
- A non-admin whose pessoa is not an active vendedor (finder-only, or a deactivated vendedor) keeps today's scope: no pool visibility, no claim.
- Slice 02 also added `shrink-0 whitespace-nowrap` to the days badge, fixing a pre-existing wrap of `há 12 dias` under a long vendedor name.
- Feature-tier mutation testing: the repo configures no mutation tool, so the phase closed `not_applicable`; each slice's Verify ran a targeted mutation probe instead (slice 02: 3 mutants killed; slice 03: removing the lock turns 4/5 red).

## For you to test or decide
- [ ] TEST: drag a `Sem vendedor - disponível` card as a vendedor in a real browser and see it become yours. The server path was proven over HTTP and by the integration oracle; the browser drag itself was not, because the Chrome extension disconnected mid-session.
- [ ] DECIDE (optional follow-up): during a long import every waiting board request holds a pooled API connection (pool max 10) with no `lock_timeout`; a `SET LOCAL lock_timeout` on the board lock would bound it. Not built, not required for this feature.
- [ ] DECIDE (copy): `meus-dados/leads` still reads "Seus leads em negociação"; it now also lists the unassigned pool. Keep, or change the subtitle?

## Ready to ship
- [ ] `/nexo-ship` - three slices on `master` (feat: pool + claim, feat: marker, fix: board lock); the Construbom import can go in once this is deployed.
