# v4.7.1 - Kanban com altura fixa, rolagem por coluna e barra horizontal no topo

Tag: `v4.7.1` at `6465c92` (the gate-3 record commit over the release commit `be1ffa9`)
Cut: 2026-10-15
Flow: `/nexo-ship` (promotion; Gate 3a and Gate 3b approved by the owner in chat for `be1ffa9`, with the instruction to confirm the production confirmation)
Chain: `master == staging == production == 6465c92`
Release-verify: PASS at `be1ffa9` by a separate agent (`RELEASE-VERIFY.md`); `6465c92` differs only in `nexo/state.json` (the gate-3 record).
Vercel Preview deployment (staging) for `6465c92`: success; its URL sits behind Vercel deployment protection, so the bundle was not inspected there.
Vercel Production deployment for `6465c92`: success; `https://sales.fxlbusiness.com` switched from `index-CCqWEwFT.js` to `index-CSXyKZa_.js`, which carries the release-only string `Rolar as etapas para os lados`.
The API code did not change in this release; the production API (AWS) answered `/health` 200 before and after.

## Accomplishments

- The Quadro fills the page height instead of growing with its longest column (31 cards had made it 4144px tall on a 900px screen and stretched every column).
- Each column scrolls its own cards under a fixed header, with a 6px scrollbar drawn in the column padding so the cards stay aligned with the header card.
- A hand-drawn, touch-sized horizontal scrollbar sits above the columns (`BoardScrollbar.tsx`): thumb drag, track press and keyboard, with the board scroller as its only source of truth; the native strip is hidden and the bar keeps its height while invisible.
- Touch: `MouseSensor` plus a 250ms press-and-hold `TouchSensor` with `touch-manipulation` on the card replace `PointerSensor` plus `touch-none`, so a swipe scrolls the column or the board and a hold drags; the kebab guard now covers the mouse and touch activators.
- Phones and upright tablets start on the sidebar icon rail (`narrow-viewport.ts`, below 1024px), the shell paddings shrink below 768px and a column fits the phone width.

## Key decisions

- One visible horizontal scrollbar (top) instead of a mirrored pair: a native scrollbar is an invisible overlay on iPad and phones and too thin for a finger.
- The page content area becomes a flex column only for the leads view; in a flex column the other screens' overflow-clipping children would become shrinkable flex items.
- Gesture oracles use literal coordinates: a swipe derived from `DRAG_ACTIVATION` went `NaN` under the very mutation it had to catch.

## Open items

- On a phone, expanding the sidebar still pushes the page instead of overlaying it.
- 24 local-only test leads (`Construtora Teste N Ltda`) were added to the dev database of the `leads-owner` fixture org to exercise the scroll; they never left the developer machine.

References: `nexo/milestones/v4.7.1/RELEASE-NOTES.md`, `nexo/milestones/v4.7.1/RELEASE-VERIFY.md`, `CLAUDE.md` `## Kanban de leads`, `nexo/knowledge/reference/kanban-de-leads.md` (section "Quadro com altura fixa, rolagem por coluna e barra no topo").
