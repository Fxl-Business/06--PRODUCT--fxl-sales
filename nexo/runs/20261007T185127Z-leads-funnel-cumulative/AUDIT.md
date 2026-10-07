# Autopilot audit — run 20261007T185127Z-leads-funnel-cumulative

## Slice 01 — funil Composição vs Acumulado
- [ ] TEST (visual): abrir o app real na edição Leads, ir em `operacional/leads` (ou `meus-dados/leads`) → aba **Funil**, e conferir a olho:
  - no **Acumulado** (default) as barras afunilam de verdade (topo cheio, decrescendo), o `% do topo` lê como retenção;
  - o card **Perdido / Fora do funil** aparece à parte, abaixo das barras, e some ao trocar para **Composição**;
  - o total do rodapé não muda ao alternar Acumulado/Composição e Faturamento/Volume.
  - Por quê só isso: pixel/afunilamento visual não dá pra assertar em happy-dom; o DOM (larguras, shares, aside, toggles) já está coberto por `lead-funnel.test.tsx` (14 casos) e passou no Verify.
  - Onde: `apps/web/src/sales-ops/leads/LeadsFunnelView.tsx`, branch já em `master` (`4f55541`).

## Pronto para shipar
- [ ] /nexo-ship — a fatia está em `master` verde (Gate 2 por agente separado: oracle 14/14, suíte web 1581/1581, lint 0, tsc 0, mutações 2/2). Autopilot não promove; staging/production seguem no release anterior (v4.4.1) até você cortar.
