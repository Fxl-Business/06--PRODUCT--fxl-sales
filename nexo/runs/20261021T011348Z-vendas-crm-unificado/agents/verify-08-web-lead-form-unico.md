# Verify 08-web-lead-form-unico

Verdict: FAIL (one major: lost coverage / dropped behaviour not declared by the plan). No blocker.

## Commands
- Whole web suite (`vitest run`, CI=true): 137 files, 1807/1807 passed.
- `pnpm --filter @fxl-sales/web lint`: 0 problems. `type-check`: 0 errors.
- Brand guard `node --test scripts/__tests__/brand-and-technical-ids.test.mjs`: 21/21.
- Em dash in added lines: none. Native select/option/datalist in LeadForm*.tsx: none (numbers use `Input type=number`).
- Deleted symbols (LeadDialog, ContactLeadDialog, ContactLeadFieldsSchema, createContactLead...) : no surviving reference in code.

## Wire checks (against real API code)
- GET /followups -> `{followups:[{id,leadId,leadContactName,nextStep,dueOn,ownerName,doneAt}]}` matches crm-routes.ts and lead-history-service.ts.
- advance returns `{lead}` (lead-routes.ts), fields `[{fieldId|key,value}]` ok, GET /pipelines `{pipelines}`, GET /field-definitions `{fields}` ok.
- `pickClientId` (lead-service.ts:1059) refuses top-level clientId plus a Cliente entry. `leadToWriteSeed` and `buildLeadWritePayload` carry the Cliente only top-level; verified in code and by tests (lead-form.test.ts, lead-undo.test.tsx "API accepts it").

## Mutation probes (scratch copy, outside the worktree)
Scratch baseline has 1 env-only failure ("creates a cliente by name inline", deterministic in the symlinked copy, passes 3/3 in the real worktree).
- M1 undo keeps Cliente entry: 3 extra reds (leadToWriteSeed x2, lead-undo).
- M2 prefill overwrites typed text: 2 extra reds.
- M3 contact not required: 4 extra reds.
- M4 dialog closes on refused save: 1 extra red.
- M5 not applied (anchor mismatch), not counted.

## Acceptance
Name plus one contact, always-present non-removable Cliente, inline create + copy, contact-only prefill (responsavel gap documented in lead-form.ts and test "leaves the responsavel alone"), dynamic fields by kind, Escape closes only the layer inside the real Dialog (cliente and options pickers), refused save keeps dialog open: all asserted.

## Findings
- MAJOR: dropped old-dialog behaviours with no test now and no plan statement:
  1. Birthday (nascimento) cannot be in the future / date input capped at today (old contact-lead-dialog "the birthday is a date input capped at today", "blocks a future birthday and accepts today", validateContactLeadDraft future rule). New DateRenderer has no `max`, validation only checks a real ISO day (lead-form.ts FIELD_CHECK_BY_KIND.date, LeadFormFields.tsx DateRenderer). Fix: add `max` for the nascimento key (or document the decision in 08c) and assert it.
  2. Escape on the open vendedor picker closes only the picker (old contact-lead-dialog); only cliente and options pickers are tested now. Add one case in lead-form.test.tsx.
  3. Free-text company kept when no cliente picked (old lead-dialog "keeps a free-text company"): the form has no free-text path, only preserves an existing snapshot; the preservation is only covered indirectly by the round trip. Confirm intentional.
- MINOR: create title `Novo lead` not asserted (only edit title). Old "renders exactly the sellers it is given" and "no etapa picker" cases dropped, trivial.
- Covered (ported): required name/contact, error timing, malformed e-mail, inline create, copy with/without onCreate, Limpar, stretch buttons, free item line, vendedor hidden/omitted, refused save, no_open_stage, closes only after resolve, raw id never rendered, clear sends null, cents.
