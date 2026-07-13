# Autopilot audit - run 20260713-1529-canonical-sales-ops-routing

## Browser verification

- [ ] TEST: In an authenticated real browser, open `/operacional/vendas`, navigate across all three workspaces, and confirm the URL, selected sidebar item, Back, Forward, refresh, and direct deep links remain synchronized without layout regressions.
  The in-app browser backend reported no available browser during Frame, so rendered routing tests will be the automated oracle and this live check remains manual.

## Ready to ship

- [ ] RUN: `/nexo-ship` after validating the accumulated `master` changes.
  The repository already had nine commits after `v2.0.4` before this feature started, and Autopilot never promotes or releases.
