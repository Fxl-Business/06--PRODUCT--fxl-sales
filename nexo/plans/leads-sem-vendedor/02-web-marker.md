---
id: 02-web-marker
milestone: v4.4.0
status: done
depends_on: []
files_modified: [apps/web/src/sales-ops/leads/calculations.ts, apps/web/src/sales-ops/leads/board-labels.ts, apps/web/src/sales-ops/leads/board-ui.ts, apps/web/src/sales-ops/leads/LeadCard.tsx, apps/web/src/sales-ops/leads/LeadsBoard.tsx, apps/web/src/sales-ops/leads/__tests__/lead-unassigned-marker.test.tsx]
oracle: [apps/web/src/sales-ops/leads/__tests__/lead-unassigned-marker.test.tsx]
acceptance: ["An open lead (saleId null) with sellerPersonId null renders exactly one [data-unassigned-lead] in the LeadCard seller footer whose text is exactly Sem vendedor - disponível (plain hyphen, no em dash) and no avatar, in both the full and the contact (leads edition) card layouts.", "A lead with a sellerPersonId renders the avatar initials plus the resolved vendedor name exactly as before and no [data-unassigned-lead].", "A converted lead (saleId not null) with sellerPersonId null keeps the plain avatar plus Sem vendedor line and no [data-unassigned-lead], because it is read-only and can never be claimed.", "The Lista view Vendedor cell shows the same [data-unassigned-lead] marker for exactly the same leads, in both layouts.", "leadIsUnassigned (leads/calculations.ts) is the one predicate and UNASSIGNED_LEAD_LABEL (leads/board-labels.ts) the one copy constant; the card and the Lista render the marker only through the shared UnassignedLeadMarker component.", "When the server answers with the claimed row (sellerPersonId set) the card drops the marker and shows the vendedor, with no web code beyond the existing reconcileLeadRow and query invalidation.", "The marker is as tall as the avatar (h-6) and the days badge never shrinks or wraps (daysBadgeClass carries shrink-0 and whitespace-nowrap), so the card footer stays one 35px line on the 300px column."]
---

# 02 Web marker for unassigned leads (AC9)

## Goal

A lead in the shared pool shows `Sem vendedor - disponível` in its card footer and in the Lista's Vendedor cell, so a vendedor can see at a glance which leads are free to take.
Slice 01 (API) makes those leads visible to every vendedor and claims them on the first write; the wire shape does not change (`sellerPersonId: string | null` is already on every lead), so this slice is web-only and has no dependency on 01.

## Decisions (final, no further design call needed)

1. Predicate: `leadIsUnassigned(lead) = lead.sellerPersonId === null && !leadIsConverted(lead)`, in `apps/web/src/sales-ops/leads/calculations.ts`, beside `leadIsConverted`.
   That file's header says every question the board asks about a lead is asked there exactly once, which is why it does not go in `board-labels.ts`.
2. A CONVERTED lead (`saleId !== null`) with no vendedor is NOT unassigned for this marker: it is read-only (`already_converted`, AC7) and can never be claimed, so "disponível" would be false.
   It keeps today's plain avatar `SV` plus `Sem vendedor` line.
3. The predicate keys on `sellerPersonId` alone, never on `sellerNameSnapshot`, mirroring the API's `seller_person_id IS NULL`.
   On the real wire an unassigned lead has `sellerNameSnapshot: ''` (`lead-service.ts` writes `seller?.displayName ?? ''`).
4. Copy: `export const UNASSIGNED_LEAD_LABEL = 'Sem vendedor - disponível';` in `apps/web/src/sales-ops/leads/board-labels.ts`, directly under `leadSellerLabel` (where `'Sem vendedor'` lives).
   `leadSellerLabel` itself is NOT changed.
5. One render implementation: a tiny exported component `UnassignedLeadMarker` in `LeadCard.tsx`, used by the card footer and by the Lista cell in `LeadsBoard.tsx` (which already imports from `./LeadCard`).
   `react-refresh/only-export-components` allows several component exports (verified: eslint green).
6. Visual: a 24px dashed teal pill, measured in headless Chromium with the real Figtree font on a 300px column (see Evidence).
   Teal is the fourth normal-stage hue of `NORMAL_PALETTE` (`#eef8f7` soft, `#17706d` ink), with a slightly stronger dashed border `#9fd3cf` so the dash reads.
   It stays clear of the grey, amber and red `dayBadgeTone` tiers it sits beside (an amber pill read like the 8-14 day badge and was rejected) and of the conversion green.
   Dashed means "empty slot", the common unassigned idiom; `h-6` equals `avatarClass` so an unassigned footer is exactly as tall as an assigned one (35px).
   Contrast `#17706d` on `#eef8f7` is about 5.4:1 (AA for small text).
7. Pre-existing pixel defect fixed along the way (user rule: fix what clearly looks off): `daysBadgeClass` had no `shrink-0` / `whitespace-nowrap`, so a long vendedor name (for example `Maria Aparecida dos Santos Oliveira`) squeezed `há 12 dias` onto two lines and grew the footer from 35px to 49.5px.
   Adding both tokens to `daysBadgeClass` fixes it for the card and is harmless in the Lista `td`.
   This is still pure pill geometry, consistent with `nexo/knowledge/reference/kanban-de-leads.md` ("`daysBadgeClass` ficou só com a geometria da pílula").
8. No optimistic claim on the client.
   During a move the marker stays until the server answers (sub-second), then `reconcileLeadRow` swaps in the server row.
   The claim rule (vendedor claims, admin never claims) lives only on the server; a client copy would be a second implementation of it.
9. The DragOverlay copy of a card renders `LeadCard` too, so it shows the marker with no extra code.
10. No `title` on the marker (the card already carries `title={CARD_TOOLTIP}`), no `aria-hidden` anywhere in it: the visible text is the accessible name.

## Why the claimed row needs no extra web code (verified by reading)

- Move: `useMoveLead` in `apps/web/src/sales-ops/leads/hooks.ts` `onSuccess` writes `reconcileLeadRow(current, response.lead)`, which replaces the WHOLE row by id (`apps/web/src/sales-ops/leads/optimistic.ts`), seller fields included, and `invalidates: [queryKeys.leads.all]` refetches.
- Edit: `useSaveLead` has no optimistic write and `invalidates: [queryKeys.leads.all]`, so the refetched page carries the claimed row.
- The name resolves through `leadSellerLabel`: the live pessoa from `lookups.personNameById`, else the `sellerNameSnapshot` the API writes on claim (AC3).
- The oracle pins both halves: `reconcileLeadRow` carries the seller fields, and re-rendering a card with the claimed row drops the marker.

## Steps

Work in your slice worktree.
In a fresh worktree run `pnpm install --frozen-lockfile` and then `pnpm run build:packages` (the web tests import `@fxl-sales/shared-utils/<subpath>`, which resolves to `packages/shared-utils/dist`; without the build every leads test fails with `Failed to resolve import "@fxl-sales/shared-utils/professional-split"`).

Write the oracle first (step 6), run it, and see it RED (16 of 20 fail with `leadIsUnassigned is not a function`), then implement steps 1 to 5.

### 1. `apps/web/src/sales-ops/leads/calculations.ts`

Insert directly after `leadIsConverted` (keep everything else):

```ts
/**
 * THE unassigned predicate: the lead sits in the shared pool, so any vendedor
 * may take it by moving or editing it first (the API claims it in that same
 * write). True exactly when no vendedor owns it AND it is not converted: a
 * converted lead is read-only (`already_converted`) and can never be claimed,
 * so it is not "disponível" even with no vendedor.
 *
 * Keyed on `sellerPersonId` alone, never on `sellerNameSnapshot`, mirroring
 * the API's `seller_person_id IS NULL`.
 */
export function leadIsUnassigned(lead: SalesOpsLead): boolean {
  return lead.sellerPersonId === null && !leadIsConverted(lead);
}
```

### 2. `apps/web/src/sales-ops/leads/board-labels.ts`

Insert directly after `leadSellerLabel` (leave `leadSellerLabel` byte-identical):

```ts
/**
 * The seller-slot marker of a lead in the shared pool (`leadIsUnassigned`), on
 * the card footer and in the Lista's Vendedor cell. A plain hyphen, never an em
 * dash.
 */
export const UNASSIGNED_LEAD_LABEL = 'Sem vendedor - disponível';
```

### 3. `apps/web/src/sales-ops/leads/board-ui.ts`

Replace the `daysBadgeClass` block:

```ts
/**
 * Pill geometry only. Compose with `dayBadgeTone(days)` for the colour.
 *
 * `shrink-0 whitespace-nowrap`: a pill never shrinks or wraps. Without them a
 * long vendedor name beside it squeezed `há 12 dias` onto two lines and grew the
 * card footer from 35px to 49.5px (measured in Chromium on a 300px column).
 */
export const daysBadgeClass =
  'inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold';
```

Insert directly after `avatarClass`:

```ts
/**
 * The seller slot of a lead in the shared pool, in place of the avatar and name.
 * `h-6` is `avatarClass`'s height, so an unassigned card's footer is exactly as
 * tall as an assigned one's. The dashed border reads as an empty slot; the teal
 * (the fourth normal-stage hue) stays clear of the grey, amber and red
 * `dayBadgeTone` tiers it sits beside. The label goes in an inner `truncate`
 * span, because text-overflow does not apply to a flex container's own text.
 */
export const unassignedMarkerClass =
  'inline-flex h-6 min-w-0 items-center rounded-full border border-dashed border-[#9fd3cf] bg-[#eef8f7] px-2.5 text-[11px] font-semibold text-[#17706d]';
```

### 4. `apps/web/src/sales-ops/leads/LeadCard.tsx`

- Add `UNASSIGNED_LEAD_LABEL` to the `./board-labels` import (after `SALE_STATUS_LABEL`).
- Add `unassignedMarkerClass` to the `./board-ui` import (after `readOnlyCardClass`).
- Change the calculations import to `import { daysInCurrentStage, leadIsConverted, leadIsUnassigned } from './calculations';`.
- Insert this component directly ABOVE `export function LeadCard({`:

```tsx
/**
 * The seller slot of a lead nobody owns yet (`leadIsUnassigned`). Shared by the
 * card footer and the Lista's Vendedor cell so the two can never drift. The text
 * IS the accessible name: nothing here is aria-hidden.
 */
export function UnassignedLeadMarker() {
  return (
    <span className={unassignedMarkerClass} data-unassigned-lead="">
      <span className="truncate">{UNASSIGNED_LEAD_LABEL}</span>
    </span>
  );
}
```

- After `const sellerLabel = leadSellerLabel(lead, lookups);` add `const unassigned = leadIsUnassigned(lead);`.
- Replace the footer's left span (today two children: the avatar and the truncated name) with:

```tsx
        <span className="flex min-w-0 items-center gap-2">
          {unassigned ? (
            <UnassignedLeadMarker />
          ) : (
            <>
              <span className={avatarClass}>{avatarInitials(sellerLabel)}</span>
              <span className="truncate text-[12px] text-[#57575f]">{sellerLabel}</span>
            </>
          )}
        </span>
```

The days badge block after it is unchanged (it already composes `daysBadgeClass`).

### 5. `apps/web/src/sales-ops/leads/LeadsBoard.tsx`

- Add `leadIsUnassigned,` to the `./calculations` import (between `leadIsConverted,` and `leadsInStage,`).
- Change `import { LeadCard } from './LeadCard';` to `import { LeadCard, UnassignedLeadMarker } from './LeadCard';`.
- In the Lista `<tbody>` row, replace the Vendedor cell (the `td` holding `avatarClass` plus `{sellerLabel}`) with:

```tsx
                        <td className="px-4 py-3">
                          {leadIsUnassigned(row) ? (
                            <UnassignedLeadMarker />
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              <span className={avatarClass}>{avatarInitials(sellerLabel)}</span>
                              {sellerLabel}
                            </span>
                          )}
                        </td>
```

Nothing else in `LeadsBoard.tsx` changes; `const sellerLabel = leadSellerLabel(row, lookups);` stays.

### 6. Oracle: `apps/web/src/sales-ops/leads/__tests__/lead-unassigned-marker.test.tsx` (new)

Create it with exactly this content.
It mounts `LeadCard` standalone and `LeadsBoard` directly, like `leads-list-view.test.tsx` and `leads-contact-board.test.tsx`: both components are presentational, need no `QueryClientProvider`, and need NO `vi.mock('@/auth/react')` (so `auth-mock-edition-export.test.ts` is not involved).

```tsx
// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeadFieldSet } from '@fxl-sales/shared-utils/sales-edition';
import { LeadCard } from '../LeadCard';
import { LeadsBoard } from '../LeadsBoard';
import { UNASSIGNED_LEAD_LABEL, buildLabelLookups } from '../board-labels';
import { avatarClass, daysBadgeClass, unassignedMarkerClass } from '../board-ui';
import { leadIsUnassigned } from '../calculations';
import { reconcileLeadRow } from '../optimistic';
import type { LeadsInfiniteData, SalesOpsLead, SalesOpsLeadStage } from '../types';
import type { SalesOpsPerson } from '../../types';

/**
 * AC9 of leads-sem-vendedor. A lead in the shared pool (no vendedor, not
 * converted) shows `Sem vendedor - disponível` on `[data-unassigned-lead]` in the
 * card footer and in the Lista's Vendedor cell, instead of the avatar and
 * `Sem vendedor`. An assigned lead renders exactly as before, and a CONVERTED
 * lead with no vendedor keeps the plain `Sem vendedor` line: it is read-only and
 * can never be claimed, so it is not "disponível".
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const NOVO_ID = 'cccccccc-0000-4000-8000-000000000001';
const CONV_ID = 'cccccccc-0000-4000-8000-000000000002';
const PERSON_ID = 'd0000000-0000-4000-8000-000000000001';
const LEAD_POOL = 'aaaaaaaa-0000-4000-8000-000000000001';
const LEAD_OWNED = 'aaaaaaaa-0000-4000-8000-000000000002';
const LEAD_CONVERTED = 'aaaaaaaa-0000-4000-8000-000000000003';
const SALE_ID = 'eeeeeeee-0000-4000-8000-000000000001';

/** Spelled out here on purpose, so a drifted constant cannot pass by comparing to itself. */
const EXACT_LABEL = 'Sem vendedor - disponível';
const LAYOUTS: LeadFieldSet[] = ['full', 'contact'];

const NOW = new Date('2026-10-07T12:00:00.000Z');
const LOOKUPS = buildLabelLookups({
  clients: [],
  people: [{ id: PERSON_ID, displayName: 'Marina Souza' } as SalesOpsPerson],
  products: [],
});

function stage(
  id: string,
  name: string,
  kind: SalesOpsLeadStage['kind'],
  position: number,
): SalesOpsLeadStage {
  return {
    id,
    name,
    kind,
    position,
    status: 'active',
    isSystem: kind !== 'normal',
    archivedAt: null,
    orgId: 'org-1',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
  };
}

const STAGES = [stage(NOVO_ID, 'Novo', 'normal', 1), stage(CONV_ID, 'Proposta', 'conversion', 2)];

function lead(id: string, patch: Partial<SalesOpsLead> = {}): SalesOpsLead {
  return {
    id,
    stageId: NOVO_ID,
    position: 1,
    contactName: 'Helena Braga',
    clientId: null,
    clientNameSnapshot: 'Acme',
    estimatedValueBrl: 150_000,
    description: null,
    contactPhone: '(27) 99999-0000',
    contactEmail: 'helena@acme.com.br',
    contactBirthDate: null,
    sellerPersonId: null,
    sellerNameSnapshot: '',
    lostReason: null,
    stageChangedAt: '2026-09-25T12:00:00.000Z',
    saleId: null,
    saleStatus: null,
    saleCode: null,
    products: [],
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

const POOL = lead(LEAD_POOL);
const OWNED = lead(LEAD_OWNED, {
  contactName: 'Bruno Lima',
  position: 2,
  sellerPersonId: PERSON_ID,
  sellerNameSnapshot: 'Marina Souza',
});
const CONVERTED = lead(LEAD_CONVERTED, {
  contactName: 'Caio Rocha',
  stageId: CONV_ID,
  saleId: SALE_ID,
  saleStatus: 'won',
  saleCode: '0001-1',
});
/** What the API answers after a vendedor's move or edit claimed POOL. */
const CLAIMED = { ...POOL, sellerPersonId: PERSON_ID, sellerNameSnapshot: 'Marina Souza' };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

function required(scope: ParentNode, selector: string): HTMLElement {
  const node = scope.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`not rendered: ${selector}`);
  return node;
}

/** The avatar is the one span carrying exactly `avatarClass`. */
function hasAvatar(scope: Element): boolean {
  return [...scope.querySelectorAll('span')].some((node) => node.className === avatarClass);
}

describe('leadIsUnassigned', () => {
  it('is true for an open lead with no vendedor', () => {
    expect(leadIsUnassigned(POOL)).toBe(true);
  });

  it('is false once a vendedor owns the lead', () => {
    expect(leadIsUnassigned(OWNED)).toBe(false);
    expect(leadIsUnassigned(CLAIMED)).toBe(false);
  });

  it('is false for a converted lead, with or without a vendedor', () => {
    expect(leadIsUnassigned(CONVERTED)).toBe(false);
    expect(leadIsUnassigned({ ...CONVERTED, sellerPersonId: PERSON_ID })).toBe(false);
  });

  it('keys on sellerPersonId alone, never on the name snapshot', () => {
    expect(leadIsUnassigned(lead('x', { sellerNameSnapshot: 'Marina' }))).toBe(true);
    expect(leadIsUnassigned(lead('y', { sellerPersonId: PERSON_ID }))).toBe(false);
  });
});

describe('UNASSIGNED_LEAD_LABEL', () => {
  it('is the exact copy, with a plain hyphen and no em or en dash', () => {
    expect(UNASSIGNED_LEAD_LABEL).toBe(EXACT_LABEL);
    expect(UNASSIGNED_LEAD_LABEL).not.toContain('\u2014');
    expect(UNASSIGNED_LEAD_LABEL).not.toContain('\u2013');
  });
});

describe('footer geometry', () => {
  it('gives the marker the avatar height, so both footers are equally tall', () => {
    expect(unassignedMarkerClass.split(' ')).toContain('h-6');
    expect(avatarClass.split(' ')).toContain('h-6');
    expect(unassignedMarkerClass.split(' ')).toContain('min-w-0');
  });

  it('never lets the days badge shrink or wrap beside a long seller slot', () => {
    const tokens = daysBadgeClass.split(' ');
    expect(tokens).toContain('shrink-0');
    expect(tokens).toContain('whitespace-nowrap');
  });
});

describe.each(LAYOUTS)('LeadCard seller footer (%s layout)', (fieldSet) => {
  async function renderCard(value: SalesOpsLead) {
    await act(async () => {
      root.render(<LeadCard fieldSet={fieldSet} lead={value} lookups={LOOKUPS} now={NOW} />);
    });
    return required(container, `[data-lead-card="${value.id}"]`);
  }

  it('shows the marker instead of the avatar for an unassigned open lead', async () => {
    const card = await renderCard(POOL);
    const markers = card.querySelectorAll('[data-unassigned-lead]');
    expect(markers).toHaveLength(1);
    expect(markers[0]!.textContent).toBe(EXACT_LABEL);
    // The text is the accessible name: nothing hides it.
    expect(markers[0]!.closest('[aria-hidden="true"]')).toBeNull();
    expect(hasAvatar(card)).toBe(false);
    expect(card.textContent).not.toContain('SV');
    // The days badge still sits beside it.
    expect(card.querySelector('[data-days-in-stage]')).not.toBeNull();
  });

  it('renders an assigned lead exactly as before: avatar initials and name, no marker', async () => {
    const card = await renderCard(OWNED);
    expect(card.querySelector('[data-unassigned-lead]')).toBeNull();
    expect(hasAvatar(card)).toBe(true);
    expect(card.textContent).toContain('MS');
    expect(card.textContent).toContain('Marina Souza');
    expect(card.textContent).not.toContain('disponível');
  });

  it('keeps the plain Sem vendedor line on a converted lead with no vendedor', async () => {
    const card = await renderCard(CONVERTED);
    expect(card.querySelector('[data-unassigned-lead]')).toBeNull();
    expect(hasAvatar(card)).toBe(true);
    expect(card.textContent).toContain('SV');
    expect(card.textContent).toContain('Sem vendedor');
    expect(card.textContent).not.toContain('disponível');
  });

  it('drops the marker when the server row comes back claimed', async () => {
    await renderCard(POOL);
    expect(container.querySelector('[data-unassigned-lead]')).not.toBeNull();
    const card = await renderCard(CLAIMED);
    expect(card.querySelector('[data-unassigned-lead]')).toBeNull();
    expect(card.textContent).toContain('Marina Souza');
  });
});

describe('reconcileLeadRow carries the claim into the board cache', () => {
  it('replaces the whole cached row, seller fields included', () => {
    const snapshot: LeadsInfiniteData = {
      pages: [{ leads: [POOL, OWNED], nextCursor: null }],
      pageParams: [null],
    };
    const row = reconcileLeadRow(snapshot, CLAIMED).pages[0]!.leads.find(
      (candidate) => candidate.id === LEAD_POOL,
    );
    expect(row?.sellerPersonId).toBe(PERSON_ID);
    expect(row?.sellerNameSnapshot).toBe('Marina Souza');
    expect(row && leadIsUnassigned(row)).toBe(false);
  });
});

describe.each(LAYOUTS)('LeadsBoard (%s layout)', (fieldSet) => {
  async function renderBoard() {
    await act(async () => {
      root.render(
        <LeadsBoard
          fieldSet={fieldSet}
          leads={[POOL, OWNED, CONVERTED]}
          lookups={LOOKUPS}
          now={NOW}
          onEditLead={vi.fn()}
          onMoveLead={vi.fn()}
          onOpenSale={vi.fn()}
          stages={STAGES}
        />,
      );
    });
  }

  it('marks only the unassigned open card in the Quadro', async () => {
    await renderBoard();
    const card = (id: string) => required(container, `[data-lead-card="${id}"]`);
    expect(required(card(LEAD_POOL), '[data-unassigned-lead]').textContent).toBe(EXACT_LABEL);
    expect(card(LEAD_OWNED).querySelector('[data-unassigned-lead]')).toBeNull();
    expect(card(LEAD_CONVERTED).querySelector('[data-unassigned-lead]')).toBeNull();
  });

  it('shows the same marker in the Lista Vendedor cell, and only there', async () => {
    await renderBoard();
    const listToggle = required(container, '[data-view-option="list"]');
    await act(async () => {
      listToggle.click();
    });
    const row = (id: string) => required(container, `[data-list-row="${id}"]`);

    const markers = row(LEAD_POOL).querySelectorAll('[data-unassigned-lead]');
    expect(markers).toHaveLength(1);
    expect(markers[0]!.textContent).toBe(EXACT_LABEL);
    // Lead, Fase, Produtos|Aniversário, VENDEDOR: the fourth cell in both layouts.
    expect(markers[0]!.closest('td')?.cellIndex).toBe(3);
    expect(hasAvatar(row(LEAD_POOL))).toBe(false);

    expect(row(LEAD_OWNED).querySelector('[data-unassigned-lead]')).toBeNull();
    expect(hasAvatar(row(LEAD_OWNED))).toBe(true);
    expect(row(LEAD_OWNED).textContent).toContain('Marina Souza');

    expect(row(LEAD_CONVERTED).querySelector('[data-unassigned-lead]')).toBeNull();
    expect(row(LEAD_CONVERTED).textContent).toContain('Sem vendedor');
    expect(row(LEAD_CONVERTED).textContent).not.toContain('disponível');
  });
});
```

What it covers (20 tests):

- Pure predicate: open and unassigned is true; owned, claimed and converted (with or without a vendedor) are false; keyed on `sellerPersonId` not the snapshot.
- Copy: exact string, no U+2014 or U+2013.
- Geometry contract: marker `h-6` equals the avatar's, marker `min-w-0`, badge `shrink-0` plus `whitespace-nowrap` (happy-dom cannot measure layout; the real measurement is in Evidence and in the browser check below).
- `LeadCard`, in BOTH `fieldSet="full"` and `fieldSet="contact"`: unassigned shows exactly one marker with the exact text, not inside any `aria-hidden`, no avatar span, no `SV`, days badge still present; assigned shows the avatar, `MS` and `Marina Souza` and no marker; converted unassigned shows the avatar, `SV`, `Sem vendedor`, no marker and no `disponível`; re-render with the claimed row drops the marker.
- `reconcileLeadRow` carries the claimed seller fields.
- `LeadsBoard`, both layouts: Quadro marks only the pool card; Lista puts exactly one marker in the fourth cell (Vendedor) of the pool row and none in the owned or converted rows.

## Existing tests

- `grep -rn "Sem vendedor" apps/web/src` hits only `board-labels.ts` (the `leadSellerLabel` fallback) and `board-labels.test.ts:83` (asserts `leadSellerLabel` returns `Sem vendedor`); `leadSellerLabel` is unchanged, so that test stays green.
- Many leads fixtures use `sellerPersonId: null` with a non-empty `sellerNameSnapshot` (`'Marina'`, `'Marina Souza'`); those cards now render the marker, but no test asserts the seller text on them.
- Measured: with this exact implementation applied, the FULL web suite was green (123 files, 1595 tests, before adding the oracle), eslint on the six files and `tsc --noEmit` exited 0, and `board-write-surface.test.ts` stays green (no banned literal, no kind comparison).
- So no existing test file is modified by this slice.

## Run commands (run-once only, never watch)

From the slice worktree root:

```bash
pnpm run build:packages
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__/lead-unassigned-marker.test.tsx
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads
pnpm --filter @fxl-sales/web exec eslint src/sales-ops/leads/calculations.ts src/sales-ops/leads/board-labels.ts src/sales-ops/leads/board-ui.ts src/sales-ops/leads/LeadCard.tsx src/sales-ops/leads/LeadsBoard.tsx src/sales-ops/leads/__tests__/lead-unassigned-marker.test.tsx
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/web test
```

Expected: the oracle is 20 passed; before steps 1 to 5 it is RED (16 failed).
Mutation probes already run against this oracle, all killed: Lista cell left unmarked (2 fail), predicate without the converted exclusion (4 fail), badge without `shrink-0 whitespace-nowrap` (1 fail).

## Evidence (headless Chromium 1228, Figtree from Google Fonts, 300px column, 248px card content)

| Variant | Footer height | Label clipped |
| --- | --- | --- |
| Assigned `MS Marina Souza` | 35.0px | n/a |
| Marker, badge `hoje` / `há 12 dias` / `há 120 dias` / `há 999 dias` | 35.0px | no (label 133px, pill 155px) |
| Long vendedor name, badge WITHOUT `shrink-0 whitespace-nowrap` (today) | 49.5px, badge wraps to two lines | n/a |
| Long vendedor name, badge WITH the fix | 35.0px, name truncates with an ellipsis | n/a |
| Rejected: dashed avatar circle plus 12px text | 49.5px at 12+ days (badge wraps) | yes |

The Lista marker is 24px tall and 155px wide; row height matches an assigned row within 0.5px.

## Browser check (Verify, real product, run-once, kill your own process group)

1. `make dev-fake` (or `make back-fake` plus `make front-fake`), record the PIDs/process group you started.
2. As `team-owner`, open `/operacional/leads`, create a lead and leave Vendedor empty; create a second lead with a vendedor whose name is long (for example `Maria Aparecida dos Santos Oliveira`, created in Cadastros > Pessoas if absent).
3. Quadro: the first card's footer shows the dashed teal `Sem vendedor - disponível` pill on one line, same footer height as the second card; the second card's days badge stays on one line beside the truncated name.
4. Lista: the Vendedor cell shows the same pill for the first lead and avatar plus name for the second.
5. As `leads-owner` (leads edition, `/operacional/leads`) repeat step 3 on the contact card layout.
6. Stop exactly the process group you started (`kill -- -"$pgid"`); never kill by name.

## Risks

- A fresh worktree without `pnpm run build:packages` fails every leads test on module resolution; that is environment, not the change.
- Slice 01 lands the claim; until it merges, an admin board already shows unassigned leads (admins can file them today), so the marker is visible and testable without 01.
- Admins also see the marker; "disponível" is still true for them (the pool is open to vendedores), so no admin-specific copy is wanted (out of scope per the overview: no admin filter).
- `react-refresh/only-export-components`: `LeadCard.tsx` now exports two components and a type, which the rule allows (eslint verified).
- Do not touch `apps/api`, `CLAUDE.md` or `nexo/knowledge` (AC10 is written at Capture).
