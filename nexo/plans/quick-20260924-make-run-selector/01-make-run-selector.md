---
slice: 01-make-run-selector
flow: quick
milestone: v4.1.0
run: 20260924T005511Z-make-run-selector
files_modified:
  - Makefile
  - scripts/__tests__/dev-localhost-only.test.mjs
---

# A bare `make` is the numbered run selector again

## Intent

The previous quick made a bare `make` print the full help.
The human wants the numbered selector back as the default, listing only the ways to run the app, the development-identity ones included.
The human chose five options and explicitly left `dev-fake-setup` out.

## Acceptance

- A bare `make` offers exactly `1) api`, `2) web`, `3) dev-fake`, `4) back-fake`, `5) front-fake`, prompts `Selection [1-5]:` and dispatches each number to that target.
- Staging never appears in the default selector; it stays opt-in by name (`make stg`).
- `make help` still lists every documented target, grouped by section.

## Oracles

- `scripts/__tests__/dev-localhost-only.test.mjs`: `a bare make opens the numbered selector over exactly the five ways to run the app` and `make help prints every target`.
- E2E: `make -n` with each choice 1-5 on stdin resolves to the expected command.
