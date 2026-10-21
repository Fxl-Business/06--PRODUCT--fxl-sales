# Verify 09-web-lead-resumo

Verdict: FAIL (3 majors, all fixable without product code risk).

## Commands
- `pnpm --filter @fxl-sales/web exec vitest run` (whole web suite): 147 files, 1874/1874 passed.
- web lint: exit 0. web type-check: exit 0.
- `node --test scripts/__tests__/brand-and-technical-ids.test.mjs`: 21/21. board-write-surface (in suite): green, OWNED_FILES extended with the 7 new files.
- No em dash in added lines of the diff. Worktree status identical before and after (mutations done in an APFS clone under the scratchpad).

## Acceptance
Proven by tests: card/Lista opens summary (leads-contact-container, lead-delete, leads-list-view), Avançar lists only nextStages (advance-dialog mutation red), follow-up required unless exit (mutation red), reason (mutation red), routes and ?etapa= (oracle lead-routes mutation red, 2 tests), delete navigates to funil (mutation red). Follow-ups Minha/Equipe and period tests present (followups*.test.*).

## Gap judgements
(a) MAJOR. AdvanceDialog uses the shared Combobox (which calls useInlineLayer, combobox.tsx:93). A scratch probe adapted from move-dialog-inline-layer.test.tsx PASSES (Escape closes only the picker, positive control closes the dialog), so behaviour is right, but no committed test covers it. CLAUDE.md UI Controls requires a real-Dialog test. Fix: add that probe as `advance-dialog-inline-layer.test.tsx`.
(b) Minor. Delete confirmation over the form Escape layering case was dropped; LeadDeleteDialog layering is still covered where it is mounted elsewhere? Not re-asserted in the summary container. Re-add one test in lead-summary-container.test.tsx (open form, Excluir, Escape on alertdialog closes only it).
(c) MAJOR. Of the removed tests: "Excluir only on edit / confirmed delete closes form" covered (lead-form.test.tsx:559, container delete test); "converted lead no Excluir" covered by "converted lead offers no Editar"; "refused delete keeps form open" NOT re-asserted; "restores prior fields by inverse PATCH" covered (inverse.fields assert); "refuses a stale inverse edit" NOT covered anywhere: mutation deleting `await requireUnchangedLead(result.lead)` keeps 9/9 green. Also mutating `leadToWriteSeed(previous, added)` to `(previous, [])` survives (the added-field clearing is unasserted). Fix: port the stale case (refetch returns a different lead, undo shows UNDO_CONFLICT, no second PATCH) and a case with a field added by the edit.
(d) Minor, accepted. Delete from summary shows no restore notice; documented in kanban-de-leads.md and code comment, restorable from Leads excluidos. Product regression vs the board (which offered undo); flag to owner.
(e) MAJOR (docs). CLAUDE.md:131 still says leads admin sees only `operacional` [`leads`] and seller only `meus-dados` [`leads`], but code gives `leads`, `funil`, `follow-ups` (funil was already missing). sales-ops-routing.md:43 still says "exactly three screens". Fix both lines to list leads, funil, follow-ups. The kanban-de-leads.md and routing sections for 09 otherwise match the code; the new CLAUDE.md route and card-click text match.

## Other findings
- Minor: test 'Voltar pops history...' is vacuous; mutating `navigate(-1)` to `if (false)` stays green because both paths land on /operacional/funil. Start the in-app history at a distinct entry (e.g. /operacional/vendas) to tell pop from replace.
- Existing nav-edition fence literals were extended only by appending follow-ups entries, no assertion weakened.

## Mutation probes (scratch clone)
route ?etapa= to segment: red (2). drop requireUnchangedLead: SURVIVED. drop navigate after delete: red. Voltar pop disabled: SURVIVED. added fields cleared to []: SURVIVED. extra stage in picker: red. follow-up block removed: red (2). reason block removed: red.
