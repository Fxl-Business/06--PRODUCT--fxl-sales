---
id: 05-web-inline-button-height
milestone: v4.7.0
status: done
depends_on: [04-web-visual-polish]
files_modified: [apps/web/src/sales-ops/leads/LeadDialog.tsx, apps/web/src/sales-ops/leads/ContactLeadDialog.tsx, apps/web/src/sales-ops/leads/__tests__/lead-dialog.test.tsx, apps/web/src/sales-ops/leads/__tests__/contact-lead-dialog.test.tsx]
oracle: [apps/web/src/sales-ops/leads/__tests__/lead-dialog.test.tsx, apps/web/src/sales-ops/leads/__tests__/contact-lead-dialog.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-delete.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-contact-container.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-full-edition.test.tsx]
acceptance: ["Every action button that sits on the same row as a form field in the two lead dialogs (LeadDialog: Limpar beside the empresa picker, Adicionar beside the produto picker, + Adicionar item livre beside the free product input; ContactLeadDialog: Limpar beside the Cliente picker) carries self-stretch, so it takes the row's height, which is the field's height", "The footer buttons (Cancelar, Salvar, Excluir lead) are unchanged", "No other class, copy or behaviour changes; oracle green; web type-check and eslint on changed files exit 0; no em dash"]
---

# 05 Inline action buttons match the field height

Inserted mid-flight (beat 7) by the orchestrator after measuring the running app (Chrome, both editions).

## Defect (measured)

In both lead dialogs, the secondary button beside a form field is about 6px shorter than the field (rendered 36.1px vs 41.8px at the page's zoom; 38px vs 44px in CSS), because the row is `flex items-center gap-2` and `secondaryButtonClass` sizes by padding (`py-2`).
Rows: `LeadDialog.tsx` around lines 205-224 (`Limpar`), 245-256 (`Adicionar`), 268-279 (`+ Adicionar item livre`, already `shrink-0 whitespace-nowrap` from slice 04); `ContactLeadDialog.tsx` around lines 205-216 (`Limpar`).

## Change (exact)

Append ` self-stretch` to the className of exactly those four buttons, using the same template-literal style slice 04 used (`${secondaryButtonClass} self-stretch`, or `${secondaryButtonClass} shrink-0 self-stretch whitespace-nowrap` for the free-item button).
`self-stretch` makes the button fill the flex row's cross axis, whose height is the tallest child (the 44px field), so the button always matches the field it sits beside, whatever the field height becomes later.
Do not touch the footer buttons (`Cancelar`, `Salvar`, `Excluir lead`) or `secondaryButtonClass` itself (it is shared across the app).

## Tests (Red first)

- `lead-dialog.test.tsx`: new test "stretches the inline action buttons to the field height": the three buttons (`Limpar`, `Adicionar`, `+ Adicionar item livre`) each have class `self-stretch`; `Cancelar` does not.
- `contact-lead-dialog.test.tsx`: new test with the same name for the Cliente `Limpar` button; `Cancelar` does not.

## Constraints

Touch only `files_modified`; run-once commands; Conventional Commit in English (`fix(leads): ...`) with no co-author line; no em dash; kill what you start; do not use ports 3006/8006.
