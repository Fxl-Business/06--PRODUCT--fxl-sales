# Quick plan — leads funnel: Composição vs Acumulado

Milestone: v4.4.0

## Intent
The leads "Funil" view today shows a *composition* (each lead counted only in its
current stage), which is not a true funnel. Add a shape toggle so the same view can
render a true **cumulative** funnel (a lead in stage K is counted in every earlier
stage, by linear assumption), tapering monotonically from the top. Keep the current
composition view a click away.

## Decisions (taken under autopilot)
- Default shape = **Acumulado** (the view is named "Funil").
- **Perdido out of the progression**: the cumulative funnel sums only `normal` +
  `conversion` stages in board order; the `lost` stage is shown as a separate aside
  total, never inside the taper (no stage history exists to place a lost lead).
- Cumulative percentage = share of the TOP ("% do topo"), 100% at the top.

## Acceptance criteria (oracle: lead-funnel.test.tsx)
1. New pure `buildCumulativeFunnel(leads, stages)`:
   - progression = boardStages minus `lost`, board order, conversion at the bottom;
   - row count/value are cumulative (lead's current progression-index K counts in all
     indices 0..K) → monotonic non-increasing top→bottom;
   - top row count == number of leads currently in any progression stage; value same;
   - returns a `lost` aside {stageId,name,count,totalBrl} from leads in the lost stage
     (or null when there is no lost stage), never mixed into `rows`;
   - converted leads (conversion stage, saleId !== null) sit in the bottom row.
2. `LeadsFunnelView` gains a Composição/Acumulado segmented toggle, default Acumulado.
   - Acumulado: bars taper by top magnitude; share label "% do topo"; a `[data-funnel-lost]`
     aside renders below the rows; footer grand totals unchanged (all leads incl. lost).
   - Composição: identical to today ("% do total", width by max, no aside).
   - Faturamento/Volume applies to both shapes.
3. Existing composition tests stay green (behavior preserved behind the toggle).

## Files
- apps/web/src/sales-ops/leads/calculations.ts (add buildCumulativeFunnel)
- apps/web/src/sales-ops/leads/LeadsFunnelView.tsx (shape toggle + cumulative render + lost aside)
- apps/web/src/sales-ops/leads/board-labels.ts (FUNNEL_SHAPE_LABEL, PERCENT_OF_TOP, lost aside label)
- apps/web/src/sales-ops/leads/__tests__/lead-funnel.test.tsx (oracle)
