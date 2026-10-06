# Run: Edição Leads (Construbom)

- Flow: feature (autopilot, Gate 1 pulado por pedido explícito). Trunk: master. Integration: local, serial, uma branch `feat/*` por slice, merge `--no-ff`.
- Request: uma versão extremamente simples do Sales para a Construbom, ativada pelo Hub na hora de dar acesso, com o Kanban de leads e poucos campos, sem proposta e sem etapas pré-definidas. A FXL não pode mudar em nada.
- Milestone: v4.3.0 (prospectivo; não promovido, Gate 3 humano).
- Reference: `nexo/knowledge/reference/kanban-de-leads.md` (seção Edição Leads), `pessoas-e-funcoes.md`, `sales-ops-routing.md`, `auth-model.md`.
- ADR: `nexo/knowledge/decisions/2026-10-05-sales-editions-from-hub-module.md`.

## Resultado

A edição é derivada por requisição do módulo `sales.edition.leads` em `entitlements.modules`; sem o módulo a org é `full`, idêntica à de hoje.
Na edição leads o gestor vê Operacional > Prospecção, Cadastros > Pessoas (como Vendedores) e Cadastros > Etapas do funil; o vendedor vê só Meus dados > Minha prospecção.
O quadro começa vazio, o lead tem Nome, Data de aniversário, Número, Email, Descrição e Vendedor, e toda rota de proposta, comissão, baixa, catálogo e importação responde `403 edition_capability`.
O playbook `nexo/playbooks/ativar-edicao-leads.md` descreve a ativação no Hub (SKU R$ 0 mais SQL).
`make dev-fake` ganhou as identidades `leads-owner` e `leads-seller` na org `org_fake_leads`.

## Slices

| slice | merge | entrega |
| --- | --- | --- |
| 01 edition-contract | fd3113e | resolvedor puro e capacidades em `shared-utils/sales-edition` |
| 03 lead-contact-columns | e3fc2aa | migração 0027, três colunas nulas em `sales_ops_leads` |
| 02 api-edition-gate | 475fba4 | `salesEdition` no contexto e `requireCapability` por grupo de rotas |
| 05 web-edition-navigation | 35d3fb8 | `profile.edition` e navegação filtrada por edição |
| 04 api-leads-edition | a66f184 | escrita de leads por contato, pessoas só vendedor |
| 08 dev-identity-and-playbook | 4265da2 | identidades fake, seed da org e playbook de ativação |
| 08.1 hermetic-finance-fixture-tests | bc5f9c5 | isolamento dos testes de integração (adicionada na execução) |
| 06 web-leads-contact-ui | b458ec0 | diálogo, cartão, lista e estado vazio do quadro |
| 07 web-pessoas-vendedores | a47be8d | tela Vendedores e correções visuais |
| 07.1 seller-own-lead-defaults | c121f9c | vendedor cria o próprio lead sem escolher a si (adicionada na execução) |

Ordem executada: 01 e 03 (wave 1); 02 e 05 (wave 2); 04, 08 e 08.1 (wave 3); 06, 07 e 07.1 (wave 4).

## Waves e verificação

| wave | slices | unit | integração | resultado |
| --- | --- | --- | --- | --- |
| 1 | 01, 03 | shared-utils 174, auth-fake 41, api 1134, web 1252 | 333 | PASS |
| 2 | 02, 05 | api 1390, web 1437 | 333 | PASS |
| 3 | 04, 08, 08.1 | api 1427, web 1441 | 338 de 346 (FAIL), depois 346 de 346 | FAIL, depois PASS |
| 4 | 06, 07, 07.1 | api 1427, web 1557 (3297 no total) | 348 | PASS, lint 0, build ok, imagem Docker da API ok |

Wave 3 falhou porque o seed de desenvolvimento (rodado pela slice 08 no banco local compartilhado) poluiu a org `org_fake_integrado`: o teste `finance-integration` limpava só depois e não os leads, o consumer contava o outbox inteiro, e o `conversion-ingest` oscilava por linhas de `audit_log` vazadas pelo teste da slice 04.
Não foi revertida, pois era isolamento de teste e ambiente, não produto; a slice 08.1 corrigiu (replan 1, recuperação de wave 1) e o re-verify passou.

## Verify

Tentativas por slice (`budget.json`): todas 1.
A slice 02 teve o primeiro executor travado (sem progresso por 600s) depois de escrever um rascunho de teste; foi redespachada e manteve o rascunho.
Slice 07.1: o verify aplicou 2 mutantes (padrão também no `createLead`; seletor de vendedor sempre visível), os dois ficaram vermelhos e foram revertidos.

## Plan-check

Aprovado com 15 correções vinculantes (C1 a C15) e 8 emendas ao contrato de interfaces (A1 a A8), entre elas reaproveitar o `400 no_open_stage` em vez de um `409 no_stage` novo e passar a edição como argumento explícito aos serviços.
Replans: 2 (08.1 e 07.1).

## Mutation

Rodada manual de feature: 22 de 22 mortos, 0 equivalentes, 0 sobreviventes.
Os mutantes M10, M11 e M15 só são mortos pela suíte de integração com Postgres.

## E2E no navegador

Slice 07, com `make dev-fake`: passou, com correções visuais feitas na hora.
Linhas inativas de Vendedores (cor do texto e larguras fixas); o chrome da edição leads escondia "A pagar este mês"; "Nova proposta" na sidebar e o chip de mês estático; o chip da fase ativa na Lista era branco sobre branco nas DUAS edições (pré-existente na master) e agora é legível.
Achado: o vendedor precisava escolher a si mesmo (403 `seller_scope`, e o formulário fechava perdendo o que foi digitado), o que gerou a slice 07.1.
O resultado do E2E de 07.1 será anexado ao AUDIT pelo orquestrador.

## Orçamento

Dispatches de agente 38 de 64; slices iniciais 8 de 16; total de slices 10 de 24; replans 2 de 3; recuperações de wave 1 de 1 (esgotada); nada estourado.

## Decisões

D1 a D6 no `00-OVERVIEW.md` e no ADR. Segurança: `pnpm audit` com 7 altos, 16 moderados e 1 baixo, todos de ferramentas de desenvolvimento transitivas, idêntico em todas as waves (pré-existente).
Detalhe completo em `AUDIT.md`.

## Não promovido

Autopilot para em master. Gate 3 (`/nexo-ship`) é humano. Ver `AUDIT.md`.
