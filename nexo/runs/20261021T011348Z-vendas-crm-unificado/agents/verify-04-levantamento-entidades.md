# Verify 04-levantamento-entidades (document slice)

Verdict: PASS (minors only).

- Checker without --fix: PASS (672 citations, 590 unique; entities 2, 9, 10, 11 alto).
- Non-vacuity (scratch copies in scratchpad verify-04): line 1000->1001 FAIL ("does not contain"); sub-heading "#### RLS" renamed FAIL ("missing or out-of-order"); entity 10 downgraded to médio FAIL (two messages). All three red.
- Hand check: about 75 citations sampled across sections 3.1 to 3.13, 5.1 to 5.4 (every 9th citation plus targeted claims). Cited lines support the claims, including: 0008 leads_insert_webhook WITH CHECK (true), 0022 CHECKs and partial unique index, requireCapability gate list and the "no gate on /leads and /lead-stages" claim (routes.ts comment 74-80 agrees), events.ts kindOf/idempotencyKey/roleForPayableKind, finders/links capability gates, payouts NO RLS, audit_log no tenant RLS, sole legacy `leads` writer (conversions/service.ts:254), client POST without requireAdmin.
- Independent reader greps: stage `kind` and `stage_id` reader files, ensureLeadStages callers, salesOpsLeads/salesOpsLeadStages readers, legacy `leads` readers. No reader of consequence missing.
- Risk review: three fixed highs are alto; 9 and 11 alto by judgement is conservative and defensible; médio for 1, 3, 5, 7, 8, 12 and baixo for 4, 6, 13 defensible. "O que quebra" and fixo-vs-configurável correct for Lead, Etapa, Funil, Cliente, Contato, Pessoa, Produto, Importação.
- git diff --name-only merge-base..HEAD -- . ':!nexo/runs' : empty. Worktree untouched. No em dash.

Minors (do not block 1b):
1. 3.1 does not state `estimated_value_brl` is NOT NULL DEFAULT 0 (schema.ts:1030) while recommending it become a dynamic field; 1b must keep the >= 0 floor and a default.
2. 3.9 says totals enter the Finance event; only row amountCents, saleId, saleCode, client name snapshot and deepLinkPath do.
3. 5.2 omits that restoreLead (lead-trash-service.ts:176-200) depends on `kind` transitively via firstOpenLeadStage (cited at lead-service.ts:1032); the dependency is covered, only not linked.
4. 3.10 "excluído do conjunto sincronizado na produção" means producer side, wording ambiguous.
5. `sales_ops_leads_org_seller_idx` (0022:87) not listed in 5.1.
