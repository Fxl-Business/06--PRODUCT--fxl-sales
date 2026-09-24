---
milestone: none
question: Como integrar FXL Sales e FXL Finance em sync de duas vias (propostas ganhas -> financeiro, pago em ambos), possivelmente via FXL Hub?
answer: Direcao certa, mas o plano depende de pecas inexistentes. Recomendado Hub como broker (A3 revisada), dono por campo, liquidacao como fatos imutaveis, v1 restrita a FOR_BUSINESS/BRL/mesma Organization. Ver documento.
---

# Auditoria: sync em duas vias entre FXL Sales e FXL Finance, com o FXL Hub como possível intermediário

Pesquisa somente leitura, feita em 2026-09-22.
Nenhum arquivo dos três repositórios foi alterado.
Três pesquisadores independentes fizeram o levantamento.
Cada um usou uma lente principal: "sales-first", "finance-first" ou "hub-first".
Depois, cada um revisou os relatórios dos outros dois.
Este documento junta os três.
As divergências foram decididas pelos veredictos dessas revisões cruzadas.
Os pontos que ainda estavam em disputa foram conferidos de novo no código, e isso vem indicado.
Depois disso, um revisor crítico apontou correções.
Cada correção foi conferida no código antes de entrar.
As que estavam erradas foram recusadas e estão registradas na seção 9.

Prefixos de caminho:
- `S:` = `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales`
- `F:` = `/Users/cauetpinciara/Documents/fxl/projects/01--PRODUCT--fxl-finance`
- `H:` = `/Users/cauetpinciara/Documents/fxl/projects/16--INTERNAL--fxl-hub`

A spec `H:nexo/plans/platform-v1/05-contratos-entre-applications.md` aparece abreviada como "05" (arquitetura "A3").
O doc `H:nexo/plans/platform-v1/04-fronteira-hub-application.md` aparece como "04".
Toda afirmação que não foi conferida no código está marcada como UNVERIFIED.

---

## 1. Resumo executivo

**Veredito: a direção do plano está certa, mas do jeito que foi escrito ele não funciona.**
O plano conta com peças que não existem.
Ele também usa a palavra "sync" para três coisas diferentes, e cada uma tem um dono diferente.

O que está errado ou mal especificado no plano:
1. **Hoje o Sales não tem como marcar nada como pago.**
   A coluna aceita `paid` (`S:apps/api/src/db/schema.ts:1124`, `:1145`), mas nenhuma rota nem serviço do sales-ops grava esse valor.
   Portanto, "marcar pago no Sales" é uma funcionalidade nova, não uma sincronização.
2. **O Sales apaga o próprio registro financeiro.**
   `updateSale` roda DELETE em todos os receivables, payables, profissionais e itens da venda, sem olhar o status (`S:apps/api/src/domains/sales-ops/service.ts:2466-2479`).
   Depois recria tudo com uuids novos.
   O caminho `won -> open -> editar` é permitido (`service.ts:2534-2540`).
   Com o sync ligado, isso destrói vínculos e linhas pagas.
3. **No Finance, "pago" é um booleano, e a data gravada como pagamento é a data de vencimento** (`F:apps/api/src/domains/manual-entries/service.ts:605-629`).
   Hoje nenhum dos dois lados guarda quando foi pago, quanto foi pago e quem registrou.
4. **"FXL For Business" não é um plano do Hub nem um tipo de Organization.**
   É o `source_type = FOR_BUSINESS` do Finance, que é o modo de lançamento manual.
5. **"Disponível para todos os provedores" não é possível.**
   Numa org de provedor (Conta Azul, Omie etc.), o Finance espelha o ERP.
   Uma linha vinda do Sales seria escondida pela view ou apagada.
6. **O Hub já tem uma spec para exatamente este piloto (A3), mas ela é de mão única e ainda não foi implementada.**
   A regra first-write-wins por `sale:<saleId>` dessa spec não serve para duas vias.
   A 05 também se contradiz sobre dead letter, e a 04 manda os webhooks de domínio para os próprios apps.

Arquitetura recomendada:
- **Transporte:** o Hub como broker, seguindo a A3.
  Ou seja: outbox no produtor, ingest e fila no Hub, e pull com lease e ack no consumidor.
  O Finance também passa a ser produtor.
  Condição: antes, um ADR precisa substituir explicitamente `04:105-107` e resolver a retenção de payload.
  O ponto de conflito é que a 04 entrega os webhooks de domínio a cada app e diz que "não passa payload pelo Hub", enquanto a A3 guarda payload.
- **Dono por campo, não "sync de tudo":**
  - o Sales é dono da Obrigação: existência, valor, vencimento, contraparte, tipo e anulação;
  - o Finance é dono da classificação: categoria, grupo, conta e observações;
  - a Liquidação pode ser registrada pelos dois lados.
- **Liquidação como fatos imutáveis com id global (semântica OR-Set):**
  - "desmarcar pago" é um fato novo de estorno, que cita os pagamentos que o autor viu;
  - o estado "pago" é calculado a partir dos fatos;
  - os dois lados convergem sem relógio comum e sem sequenciador central.
- **Um evento por Obrigação, com `revision` monotônica e `state` no payload.**
  Esse evento substitui o evento por venda com first-write-wins.
  Soma-se a ele um `ledger.checkpoint` por venda, usado na reconciliação.
- **Anulação sobre pagamento vira o estado `disputed`**, e uma pessoa resolve.
  Dinheiro que já se moveu nunca é apagado automaticamente.
- **A v1 fica limitada a:**
  - mesma Organization do Hub nos dois apps;
  - Finance em `FOR_BUSINESS`;
  - moeda BRL;
  - propostas do sales-ops com recorrência finita.
  Os afiliados ficam fora.
- **Sequência:** primeiro os pré-requisitos locais em cada app, depois o Hub (A3 revisada), e a integração por último.
  O Hub roda em produção em `8086325` (SDK `2.2.0`).
  O delta do access-model e do SDK 2.3.0 ainda não foi promovido: `main` está 96 commits à frente de `origin/production`.
  O "DO NOT DEPLOY" do Finance (`F:CLAUDE.md:11`) depende desse delta, porque o Finance recusa tokens sem `contractVersion`.

---

## 2. Como é hoje

### 2.1 FXL Sales

**Tabelas e dinheiro**
- `sales_ops_sales` (`S:apps/api/src/db/schema.ts:787-829`):
  - status em texto livre `draft|open|won|lost|cancelled`, sem CHECK;
  - `won_at` e `lost_at` são `timestamptz`;
  - agregados em centavos inteiros (`total_brl`, `tax_brl`, `net_margin_brl` etc.);
  - `code` é único por org (`:823`);
  - `client_id` é anulável e tem `client_name_snapshot NOT NULL`;
  - `seller_person_id` e `finder_person_id` também são anuláveis e têm snapshots de nome (`:794-799`).
- `sales_ops_receivables` (`:1114-1129`):
  - colunas `label`, `due_date timestamptz`, `amount_brl int`, `method` (`pix|card|boleto|transfer`) e `status` (`open|paid|void`);
  - não tem `paid_at`, valor pago, `updated_at` nem versão.
- `sales_ops_payables` (`:1131-1167`):
  - `kind` em `seller_commission|finder_commission|tax|professional_cost|other_cost`;
  - `beneficiary_name` guarda só o nome;
  - `receivable_id` é FK com `ON DELETE SET NULL`;
  - `sale_professional_id` existe só para `professional_cost`.
- Convenção de dinheiro: "integer (cents) - never numeric/float" (`schema.ts:15`).
- Moeda:
  - `sales_ops_settings.currency` tem default `'BRL'` (`:775`);
  - o schema aceita qualquer string (`service.ts:430`);
  - a UI oferece `USD` (`S:apps/web/src/sales-ops/SalesOpsApp.tsx:3924-3935`).
  - A configuração não tem efeito nenhum: ela é gravada e oferecida no seletor, e nada a lê.
  - A exibição é fixa em BRL: `Intl` usa `currency: 'BRL'` em `SalesOpsApp.tsx:3128-3129` e em `S:apps/web/src/sales-ops/calculations.ts:464-465`.
  - A única outra leitura é o valor inicial do formulário (`SalesOpsApp.tsx:822`).
  - Todas as colunas se chamam `*_brl`.

**Ciclo de vida**
- `SALE_TRANSITIONS` (`service.ts:2534-2540`, conferido):
  - `draft -> open|won|cancelled`
  - `open -> won|lost|cancelled`
  - `won -> open`
  - `lost -> open|cancelled`
  - `cancelled -> open`
- Os receivables nascem na criação e na edição, não no `won` (`buildSaleLedger`, `service.ts:873-904`):
  - as parcelas de valor zero são descartadas ANTES da numeração (`keptInstallments = input.installments.filter(row => row.amountBrl > 0)`), e o rótulo é `${index+1}/${kept.length}` (`:885-891`);
  - por isso, zerar uma parcela renumera todas as seguintes, e `label` não serve como identidade;
  - os ciclos `M${i+1}/${recurring.cycles}` só existem quando `cycles !== null` (`:894-904`);
  - recorrência indefinida não gera nenhuma linha;
  - o teto é de 120 parcelas e 120 ciclos (`:449`, `:547`).
- Os payables nascem no `won` (`materializeWonPayables`, `service.ts:1065-1268`).
  Quem chama é `createSale` com status `won` (`:2397-2433`) e `transitionSale` (`:2594-2635`).
  - Comissões e `tax` são gerados por receivable não anulado, inclusive sobre as linhas `M` limitadas, com `pctOfCents = Math.floor(...)` (`S:packages/shared-utils/src/sale-financials.ts:20-22`).
  - `professional_cost` é gerado só sobre as parcelas.
  - `other_cost` é gerado uma vez só, na data do `won`, com `receivableId: null` e beneficiário `'Outros custos'`.
  - O beneficiário de `tax` é `'Impostos'`.
- A materialização é idempotente por `(kind, receivableId)` e por `(saleProfessionalId, receivableId)`, e ignora as linhas `void` (`:1066-1073`).
- `won -> open` anula apenas os payables `open`; os receivables continuam `open` (`:2636-2650`, conferido).
- Consequência para a identidade: um novo `won` sem edição mantém os ids dos receivables e cria ids novos só para os payables.
  Só `updateSale` renova os ids dos receivables.
- `cancelContract` (`:2671-2736`):
  - exige `won` e mantém a venda em `won`;
  - anula os receivables `open` que vencem depois do corte, e os payables ligados a eles;
  - nunca anula payables com `receivable_id` nulo, ou seja, `other_cost` e o fallback de profissional (`:2712-2722`);
  - não deixa rastro durável na venda: devolve só contagens, e não existe coluna `contract_ended_at`;
  - numa venda com recorrência indefinida não anula nada (não há linhas) e mesmo assim devolve `ok`, porque a regra "não cancelável" é `sale.recurringBrl <= 0 && futureIds.length === 0` (`:2703-2705`);
  - o `effectiveDate` padrão é o dia UTC (`:2687`).
- `updateSale` recusa `won`, `lost` e `cancelled` (`:2458-2460`).
  Depois apaga payables, receivables, `sales_ops_sale_professionals` e `sales_ops_sale_items` e recria tudo (`:2466-2479`).
  Por isso, `sale_professional_id` também muda a cada edição.

**A documentação diverge do código**
- `S:CLAUDE.md` e `S:nexo/knowledge/reference/propostas.md:46` dizem: "Leaving `won` (revert, lose, cancel) voids only `open` payables and receivables; `paid` rows are never touched".
- `S:apps/web/src/sales-ops/hooks.ts:270-271` promete o mesmo no cancelamento: "leaves paid rows untouched".
- No código, `won` só vai para `open`, o revert não anula receivables e `updateSale` apaga linhas `paid`.
- O estado `paid` que essa invariante protege só é produzido por fixtures de teste (`sale-transitions.integration.test.ts:255`, `:313`, `:712`).
  O código de produção do sales-ops não consegue produzi-lo.

**Datas**
- `dateFromIsoDay` grava `YYYY-MM-DDT00:00:00Z` (`:605-607`).
- `asDateOnly` usa `toISOString().slice(0,10)`, ou seja, o dia em UTC (`:600-603`).
- Esse dia UTC é usado no `wonDate` (`:2628`) e no corte do cancelamento (`:2687`).
- Um `won` feito às 22h em Brasília fica registrado no dia seguinte.

**Auditoria e autorização**
- `audit_log` é uma cadeia global encadeada por hash e só tem `actor_org_id` (`schema.ts:178-203`).
- `writeAuditEntry` trava a última linha da cadeia com `FOR UPDATE` (`S:apps/api/src/domains/audit/service.ts:13-14`).
  Por isso, toda escrita auditada de todas as orgs passa por uma única linha disputada.
- Só são auditadas ações de cadastro e do fluxo de afiliados (`audit/service.ts:31-38`).
  Transições de venda não são auditadas.
- Rotas sem gate de papel em `S:apps/api/src/domains/sales-ops/routes.ts`:
  - `POST /sales` (`:302`), que pode criar direto em `won` e assim materializar payables;
  - `POST /sales/:id/transition` (`:321`);
  - `POST /sales/:id/cancel-contract` (`:336`);
  - `PUT /sales/:id` (`:353`);
  - `PUT /settings` (`:381`), que carrega `currency`, `defaultTaxPct` e `taxRegime`.
  Só pessoas, funções e histórico têm `requireAdmin` (`:95`, `:107`, `:247`, `:263`, `:425`).
  Isso é o achado M18 da revisão do Hub, ainda aberto, e a superfície é maior do que o M18 descreve.

**Tenancy**
- `org_id` é o `workspaceId` do Hub.
- As tabelas de sales-ops têm FORCE RLS (`S:apps/api/drizzle/0008_single_role_rls_context.sql:127-169`).
- `withTenant` abre a transação e define o contexto (`service.ts:1316-1321`).

**Precedentes e sistemas paralelos**
- Webhook de entrada com HMAC em `conversions` (`S:apps/api/src/domains/conversions/hmac-middleware.ts:1-82`).
- `webhook_events` com `UNIQUE(source, event_id)` (`schema.ts:206-221`).
- `S:apps/api/src/jobs/nightly-job.ts` agenda três tarefas `node-cron`: `0 3 * * *` (`:34`), `15 3 * * *` (`:47`) e `30 3 * * *` (`:63`).
  Nenhuma tem eleição de líder.
  Não foi conferido quantas instâncias da API do Sales rodam (UNVERIFIED).
- Existe um segundo sistema de comissão, o de afiliados: `commissions` e `payouts` com `mark-paid` (`schema.ts:399`, `:428`; `S:apps/api/src/domains/payouts/routes.ts:90`).
  Ele é o único escritor de `paid` no Sales hoje (`payouts/service.ts:121`, `:129`; `commissions/service.ts`).
- Não existe outbox.

### 2.2 FXL Finance

**O que é "FXL For Business"**
- Cada org tem um `source_type`: `CONTA_AZUL` (default), `MOBILLS`, `OMIE`, `DATABELLI`, `FOR_BUSINESS` ou `OPEN_MANAGER` (`F:apps/api/src/db/schema/enums.ts:26`, `org-settings.ts:14`).
- `FOR_BUSINESS` é o modo de lançamento manual.
- Também existe um Module do Hub, `finance.for-business` (`F:packages/shared-types/src/modules.ts:13-20`, migração 068).
  Ele só define o `source_type` inicial (`F:apps/api/src/domains/workspace/service.ts:18-21`).
  O gate 402 por módulo foi removido (`F:apps/api/src/domains/manual-entries/routes.ts:8-10`).
- O único gate das rotas manuais é `requireForBusinessSource` (`routes.ts:61`).
- O código do Hub não tem nenhuma ocorrência de "for-business".
  Não foi conferido se o SKU está cadastrado no banco do Hub (UNVERIFIED).
- O Hub tem `workspace_kind` com os valores `company|personal` (`H:packages/hub-db/src/schema.ts:26`, `:185`).
  Isso não tem relação com "For Business", não vai no token e o Finance não lê.

**Lançamentos**
- O For Business grava na camada LEGADA: `contas_pagar` e `contas_receber` (`F:apps/api/src/db/schema/contas-pagar.ts:4-86`, `contas-receber.ts:4-76`).
  - Valores em `decimal(15,2)`, em reais.
  - Contraparte, `categoria`, forma de pagamento e conta bancária são texto.
  - `import_batch_id NOT NULL ON DELETE CASCADE`.
  - Também tem `serie_id`, `serie_tipo`, `extra_data jsonb` e `ano`.
  - Não há id externo nem índice único de idempotência.
- A camada canônica `transactions` (`F:apps/api/src/db/schema/transactions.ts:20-66`, com `paid_status paid|partial|open` e `data_pagamento`) só é gravada pelos syncs do Conta Azul e do Omie.
- `v_transactions_unified` esconde o legado quando existe linha canônica para o mesmo `(org, tipo, ano)` (`unified-view.ts:13-19`).

**Lotes de importação**
- `source_file_kind` é uma coluna de texto com CHECK constraint (`F:migrations/071_import_batches_template_kind.sql:122-128`).
  O `pgEnum` em `F:apps/api/src/db/schema/enums.ts:40-50` existe só para a inferência de tipos do Drizzle, como diz o comentário nas linhas anteriores.
- O índice único parcial `(org_id, source_type, tipo, source_file_kind, ano) WHERE source_file_kind <> 'MANUAL_TEMPLATE'` (`import-batches.ts:42-44`) faz com que cada lote não-template seja único por ano.
- O lote manual é um singleton por `(org, ano, tipo)`, criado por `ensureManualBatch` (`manual-entries/service.ts:148-220`).
  A criação em série separa as linhas por ano (`:517-544`).

**Escrita manual**
- `createPagar` e `createReceber` (`service.ts:494-574`, `:807-883`) geram uuids novos e não aceitam chave de idempotência.
- O fio recebe `valorOriginal: z.number()`, em float (`:84`).
- A criação converte para centavos.
  A edição usa float (`valorOriginal - valorPago` com `.toFixed(2)`, `:607`), o que viola `F:CLAUDE.md:199`.
- A edição recalcula `ano` (`:608`, `:630`), mas nunca troca o `importBatchId`.
  Uma mudança de vencimento que cruza o ano deixa a linha no lote do ano errado.
  É um bug latente que já existe hoje.
- Pago binário: `valorPago = foiPaga ? valorOriginal : 0` e `dataUltimoPagamento = dataVencimento` (`:605-629`).
- O audit de update não registra o estado de pago (`:635-652`).
- Série de 2 a 60 vezes, sem recorrência indefinida (`:72-76`).
- Delete físico, com `escopo=linha|futuras` por `serie_id` (`:699-747`).
- Não há gate de papel: as manual-entries não têm `requireOrgEditor`, então qualquer membro cria, edita, marca como pago e apaga.
  A manual-import tem esse gate (`manual-import/routes.ts:38`).
- As colunas de ajuste já existem: `juros_realizado`, `multa_realizado`, `desconto_realizado` e `valor_recebido_parcela` (`contas-receber.ts:32-35`).

**Detecção de duplicata e "editado depois do import"**
- `F:apps/api/src/domains/manual-import/duplicate-lookup.ts:1-17` casa duplicatas por `(org, ano, data_vencimento)` em SQL e depois aplica a normalização `duplicateKey` em JS.
- `undo-service.ts` tem `countEditedRows` (`:191`), um precedente de "editado desde o import".
- O "desfazer import" só vale para `sourceFileKind = 'MANUAL_TEMPLATE'` (`undo-service.ts:155`, `:234`).

**Status**
- O status é calculado e nunca persistido (`F:packages/shared-utils/src/lancamento-status.ts:18-20`): `a_pagar|pago|vencido|a_receber|recebido|inadimplente`.
- Não existe "cancelado" nem "anulado".
- A divergência de float SG-11-01 no Tático continua ativa (`F:CLAUDE.md:200`).

**Plano de contas e contatos**
- A categoria é identificada pelo nome, que é único por org.
- Renomear uma categoria propaga pelo nome (`categorias-receita/routes.ts:271-300`).
- Apagar uma categoria exige escolher uma de destino (`:160-222`).
- `contatos` é único por `lower(nome)` e não guarda documento (`F:apps/api/src/db/schema/contatos.ts:57-74`).
  O casamento ignora maiúsculas e minúsculas, mas não ignora acentos (`service.ts:280`).

**Proteções que já existem**
- A troca de `source_type` é bloqueada quando há linhas em `contas_*` (`F:apps/api/src/lib/source-type-change.ts:51-58`, conferido).
  Os dois escritores do campo chamam esse guard.
- A exclusão de período é bloqueada para `FOR_BUSINESS` (`F:apps/api/src/domains/periods/guards.ts:30-36`).
- `wipeOtherSources` só apaga `MOBILLS`, `OMIE`, `DATABELLI` e `CONTA_AZUL` (`conta-azul-sync/service.ts:49-52`, conferido).
  `FOR_BUSINESS` não está na lista.

**Tenancy e superfície entre apps**
- `org_id` é o `workspaceId` do Hub, "never re-keyed" (`F:apps/api/src/auth/principal.ts:83-86`).
- A RLS está DORMENTE: a app conecta como dona do banco (`F:CLAUDE.md:86-91`).
  O isolamento existe só na aplicação, com o guard heurístico `orgscope`.
- `/api/fxl/*` continua montada (`F:apps/api/src/index.ts:130`).
  Ela só lê, usa chave estática e recebe `org_id` pela query (`F:apps/api/src/routes/fxl/index.ts:78-93`).
  É o achado M16 e não deve ser reaproveitada.

**Operação**
- Instância única.
- Os crons só rodam com `ENABLE_CRONS`.
- Uma integração já ficou parada em silêncio por 63 dias (`F:CLAUDE.md:241`).
- O app mobile não escreve lançamentos; o único POST dele é o registro de push (`F:apps/mobile/hooks/use-push-registration.ts:49`).

### 2.3 FXL Hub

- **Papel:** IdP, registro de Applications e comércio (`H:CLAUDE.md:1-4`).
- **Estado de produção:**
  - `H:nexo/state.json:20` registra `last_release: v0.11.0`;
  - `origin/production` está em `8086325` (2026-09-07), com `HUB_SDK_VERSION = '2.2.0'` (`packages/hub-sdk/src/index.ts:63` naquele commit);
  - `main` está 96 commits à frente (`git rev-list --count origin/production..main`), com o SDK em `2.3.0` (`H:packages/hub-sdk/src/index.ts:78`);
  - o que falta promover é o delta do SDK 2.3.0 e do access-model, não o Hub em si;
  - não foi conferido se o Coolify realmente implantou esse commit (UNVERIFIED);
  - `nexo/state.json:3-16` tem um `stop_gate` depois de `platform-consertos`, e deploy e promoção de branch são ações exclusivamente humanas.
- **Token contract v1** (`H:token-contract.json`, `H:packages/hub-sdk/src/contract.ts:32`):
  - as claims com peso de segurança são `sub`, `aud`, `workspaceId`, `entitlements` e `roles`;
  - `entitlements = {access, modules}`;
  - não existe token de serviço.
- **`client_credentials` não existe.**
  O STS recusa todo grant que não seja `authorization_code` (`H:apps/auth/src/routes/oauth.ts:525`).
  Um Client `machine` pode ser cadastrado com `['client_credentials']` (`H:apps/api/src/domains/admin/application-service.ts:253-262`), mas não consegue emitir token.
  O ROADMAP diz "Not shipped, deliberately" (`H:nexo/ROADMAP.md:219`).
- **S2S que existe:** HTTP Basic com o `application_client` (`H:apps/api/src/middleware/application-client-auth.ts:112`), usado pelo convite entre aplicativos.
- **Liveness de acesso:** uma única implementação, `hasAccess` (`H:packages/hub-db/src/access-policy.ts:77`).
- **Outbox que já existe:** `sale_events` para o Finders (`H:packages/hub-db/src/schema.ts:815-836`).
  O consumidor dele é um stub (`:817`).
- **Pagamentos:** os "contratos de pagamento" em desenvolvimento são a cobrança da PRÓPRIA FXL via Asaas (ADR 0004, `H:CLAUDE.md:822-849`).
  Eles usam projeção, webhook, reconcile de backstop e CAS contra evento fora de ordem.
  Isso não tem relação com os recebíveis do cliente.
  O que vale reaproveitar é o padrão, não o vocabulário.
- **Fake-dev:** `@fxl-business/hub-sdk-testing@2.3.0` emite claims, e cada app mantém o próprio roster (`H:packages/hub-sdk-testing/src/index.ts:1-30`).
  Os rosters não têm nenhuma org em comum:
  - o Sales usa `org_fake_norte`, `org_fake_sul` e `org_fake_sem_acesso` (`S:packages/auth-fake/src/index.ts:127-129`);
  - o Finance usa `org_fake_acme`, `org_fake_business` e outras (`F:packages/auth-fake/src/index.ts:84-87`, `:188`).
  O Finance já tem `org_fake_outro_produto`, que só tem `app.fxl-sales` (`:213-219`).
  É um caso negativo pronto para "acesso em um app só".
- **A spec A3 (05, 418 linhas):**
  - Integration Event Type com `payload_schema` imutável por versão (`05:45-54`);
  - Integration Contract;
  - Activation por Organization, que na v1 só o super-admin liga (`05:102-152`);
  - reabilitar não ressuscita `disabled_skip` nem faz backfill (`05:150`);
  - outbox, ingest, fila Postgres, pull com lease e ack com `FOR UPDATE SKIP LOCKED` (`05:249-250`, `:404`), `hub_inbox` com PK `(org_id, event_type, idempotency_key)` (`05:268`), sweeper e poda (`05:194-304`);
  - teto de 256KB por payload (`05:211`, `:229`);
  - pull a cada 15 s (`05:202`).
  - O piloto é `fxl-sales.proposal.approved` com `idempotencyKey = sale:<saleId>` e first-write-wins.
    A spec diz que "re-aprovação com plano alterado NÃO re-lança nem atualiza" (`05:264`, `:271`, conferido).
  - O void automático no Finance foi descartado (`05:272-273`).
  - As linhas sincronizadas "nascem com sourceType proprio" (`05:274`, gate G2).
  - Não há backfill (`05:150-152`).
  - Gate G2: o M18 do Sales e a idempotência do Finance antes do enable em produção (`05:394`).
  - Dead letters (`invalid`, `failed_permanent`, `expired`) e os eventos delas, com payload, NUNCA são podados automaticamente (`05:303`).
    O operador pode fazer requeue ou dismiss (`05:331-332`).
- **Status da A3:** não implementada.
  Não existem tabelas `integration_*`.
  `platform-contratos` é o 6º milestone, atrás do `stop_gate`.
- **Contradições internas** (conferidas):
  - `04:105-106`: "Webhooks de dominio: da Application. Segredo e registro no proprio app, precedente `conversions`".
  - `04:107`: "O Hub nao e barramento de eventos; o contrato Sales-Finance ... nao passa payload pelo Hub".
  - A 05, porém, guarda `payload` jsonb em `integration_event` (`05:238`).
  - Dentro da 05: `05:201` diz que uma queda do consumidor "vira apenas fila envelhecendo, nunca perda e nunca dead letter".
    Já `05:292` e `:300` expiram para dead letter `expired` tudo o que ficar `pending` por mais de 30 dias.
  - A 05 fala em SDK 2.4.0 nos critérios de aceite (`05:233`, `:341`, `:399`, `:401`), e o doc 06 renumerou para 2.5.0 (`06-sdk-linha-e-releases.md:32`, `:59-60`).
  - A 05 cita linhas de código já defasadas: `routes.ts:309` hoje é `:321`, e `manual-entries/service.ts:388` hoje é `:494`.

---

## 3. Pontos cinzas

Severidade: Crítica, Alta, Média ou Baixa.

**PC1. "Marcar como pago" não existe no Sales** (Crítica)
- Problema: o two-way conta com uma funcionalidade que o Sales não tem, e ele também não tem as colunas para ela.
- Por que importa: sem ela, a volta Finance -> Sales não tem onde pousar.
  O plano vira uma feature nova com cara de sync.
- Opções:
  - (a) o Sales só exibe o pago que vem do Finance;
  - (b) baixa completa no Sales.
- Recomendação: (b), mas só se o produto quiser baixa no Sales (pergunta Q1).
  Senão, (a) corta o escopo pela metade.
  A tabela de fatos de liquidação é necessária nos dois casos.

**PC2. `updateSale` apaga linhas pagas e troca ids** (Crítica)
- Problema: o DELETE total seguido de recriação atinge receivables, payables, profissionais e itens (`service.ts:2466-2479`).
  Isso quebra qualquer vínculo por id externo e destrói fatos pagos.
  Como `sale_professional_id` também é recriado, nenhuma chave formada a partir dele sobrevive a uma edição.
- Opções:
  - (a) preservar os ids de itens, profissionais e linhas liquidadas quando o plano é regenerado;
  - (b) proibir editar o plano de uma venda que tenha qualquer liquidação;
  - (c) anular e criar, emitindo `voided` e `active` com obrigações novas.
- Recomendação: (b) mais (c).
  Item publicado nunca é apagado fisicamente.
  Uma edição sem liquidação anula os itens velhos e emite itens novos.
  Se o produto quiser manter a identidade de uma parcela que só teve a data alterada, isso exige (a) para itens e profissionais também.
  Vale como fase posterior.

**PC3. Dono de cada campo** (Alta)
- Problema: com "two-way de tudo", toda edição concorrente vira conflito.
- Recomendação: dono por campo (tabela na seção 5.3).
  No Finance, as linhas vinculadas ficam travadas nos campos que pertencem ao Sales: a API responde `409 linked_to_sales` e a UI desabilita o controle.
- A trava precisa cobrir DELETE e as operações de série, não só edições.
  O Finance apaga fisicamente com `escopo=linha|futuras` por `serie_id` (`service.ts:699-747`).
  Uma série vinculada tem `serie_id` derivado do `saleId`, então um único "excluir futuras" apagaria todo o restante sincronizado.

**PC4. Semântica de "pago" nos dois lados** (Crítica)
- Opções:
  - (a) flag com last-writer-wins: perde uma baixa concorrente e depende de relógio;
  - (b) autoridade única;
  - (c) contador de ordem emitido pelo Sales, proposta inicial do finance-first;
  - (d) fatos imutáveis com OR-Set.
- Recomendação: (d).
  O estorno cita os `settlementId` que o autor viu.
  Assim ele nunca apaga uma baixa concorrente que não viu.
  (c) foi descartada porque faz do Sales o sequenciador de um fato gerado no Finance e trava a baixa quando o Sales está fora.
  Detalhes em 5.6.

**PC5. Pagamento parcial e diferença de valor** (Média)
- Problema: hoje os dois lados são binários.
- Recomendação:
  - o fio já nasce com `amountCents` por fato e com `adjustments {discount, interest, fine}`, que o Finance já tem onde gravar;
  - a v1 pode proibir o parcial pela UI sem mudar o contrato;
  - uma diferença de valor vira ajuste na liquidação, nunca edição do valor nominal.

**PC6. Proposta sai de `won` depois do sync** (Crítica)
- Problemas:
  - o revert anula só payables e deixa os receivables `open`;
  - um novo `won` sem edição mantém os ids dos receivables e cria ids novos só para os payables;
  - uma edição entre o revert e o novo `won` renova todos os ids;
  - o Finance não tem estado "anulado".
- Recomendação:
  - revert de venda com qualquer liquidação é bloqueado, ou passa por um fluxo explícito de estorno (Q5);
  - sem liquidação, o revert de uma venda vinculada anula também os receivables e emite `voided` para eles;
  - se o produto preferir manter os receivables vivos durante o revert, o contrato precisa dizer isso, e um novo `won` sem edição reaproveita as mesmas obrigações de receivable, emitindo só os payables novos;
  - nos dois casos, o consumidor nunca pode deduzir "novo `won` = tudo novo", porque anularia receivables ainda válidos;
  - o Finance marca a linha como anulada, sem apagar;
  - um fato de liquidação que chega para uma Obrigação anulada põe a obrigação em `disputed` nos dois apps.

**PC7. `cancelContract` é incompleto e não deixa rastro** (Alta)
- Problemas:
  - não anula `other_cost` nem o fallback de profissional, então depois de um cancelamento uma despesa continua viva no Finance;
  - mantém `status = 'won'`, não grava `contract_ended_at` e só devolve contagens;
  - numa venda com recorrência indefinida não anula nada e ainda devolve `ok`;
  - o `effectiveDate` padrão é o dia UTC (`:2687`).
- Por que importa: um consumidor não consegue descobrir pelo estado que o contrato acabou.
  O job de horizonte da PC8 também precisa saber que deve parar.
- Recomendação:
  - persistir o fim do contrato (coluna `contract_ended_at` com a data efetiva no dia de São Paulo);
  - emitir um fato explícito `fxl-sales.contract.cancelled` com `effectiveDate`;
  - o que é anulado continua sendo decisão de produto (Q6), com `voidReason: contract_cancelled` em cada obrigação anulada.

**PC8. Recorrência indefinida é invisível** (Alta)
- Problemas:
  - `cycles: null` não gera nenhuma linha;
  - o Sales vai até 120 ciclos, e o Finance até 60 por série;
  - comissões e imposto incidem sobre cada ciclo, então uma venda pode gerar centenas de payables.
- Um horizonte móvel materializado no Sales quebra invariantes do Sales:
  - o rótulo é `M${i+1}/${recurring.cycles}` (`service.ts:894-904`), e recorrência indefinida não tem denominador;
  - `S:CLAUDE.md` diz que o `M` de `MN/M` é essencial (`deriveWizardPrefill` o interpreta);
  - a regra "não cancelável" do `cancelContract` (`:2703-2705`) mudaria de sentido;
  - as linhas novas entrariam nos dashboards e resumos do Sales; o impacto exato não foi conferido (UNVERIFIED).
- Opções:
  - (a) mandar a regra e deixar o Finance materializar: dois motores de recorrência que divergem;
  - (b) o Sales materializa linhas reais num horizonte móvel, com um novo esquema de rótulo (por exemplo `M{i}` sem denominador) e ajustes em `deriveWizardPrefill`, em `cancelContract` e nos agregados;
  - (c) o Sales gera projeções só para o fio, sem linhas locais, a partir de um job que conhece `contract_ended_at`;
  - (d) a v1 sincroniza só recorrência finita, e uma venda indefinida numa org conectada aparece como "não sincronizada".
- Recomendação: (d) na v1.
  Depois, (b) ou (c), conforme a decisão do dono (Q3).
  Em qualquer caso, o Finance recebe linha por linha, com `serie_id` derivado do `saleId`, sem depender do teto de 60.

**PC9. Imposto por parcela contra guia mensal** (Alta)
- Problema: o `taxRegime` padrão é `'Simples Nacional'` (`S:apps/api/src/domains/sales-ops/service.ts:431`), recolhido por DAS mensal.
  Um payable `tax` por receivable não corresponde à guia real.
- Opções:
  - (a) sincronizar por parcela;
  - (b) agregar por competência no Finance;
  - (c) não sincronizar `tax` na v1.
- Recomendação: (c) na v1 e (b) depois.
  A decisão é do dono (Q7).

**PC10. "Todos os provedores"** (Alta)
- Problema:
  - numa org de provedor, a view `prefer canonical` esconde as linhas `contas_*` imediatamente;
  - o upload substitui o ano inteiro;
  - `wipeManualImports` roda em todo sync.
- Opções:
  - (a) só `FOR_BUSINESS`;
  - (b) uma projeção somente leitura em org de provedor, sem liquidação;
  - (c) empurrar para o ERP.
- Recomendação: (a).
  A restrição é técnica, não comercial.
  (b) fica para depois, e (c) é outro projeto.

**PC11. Janela de troca de `source_type` antes da primeira linha** (Alta)
- Problema: `hasInputsForOrg` só conta linhas.
  Uma org conectada e ainda vazia pode trocar para Conta Azul.
  As primeiras entregas cairiam numa org de provedor e sumiriam.
- Recomendação:
  - o guard também passa a considerar se existe uma activation viva;
  - quando a org não é `FOR_BUSINESS`, o handler do Finance responde com retenção (`held_reason`, com retry), nunca com `invalid`.

**PC12. Onde o Finance grava e com qual proveniência** (Alta)
- Problemas:
  - gravar em `transactions` ativaria o prefer-canonical e esconderia TODA a contabilidade manual do `(org, tipo, ano)`;
  - um `sourceType` novo por lote colide com o modelo por org, com `OTHER_SOURCE_TYPES` e com a view.
- Recomendação:
  - gravar em `contas_*`, num `import_batch` próprio com `sourceType='FOR_BUSINESS'` e um novo `source_file_kind = 'SALES_SYNC'`;
  - acrescentar esse valor ao CHECK `import_batches_source_file_kind_check` (`F:migrations/071_import_batches_template_kind.sql:122-128`) e à lista do `pgEnum` do Drizzle, numa nova migração;
  - pelo índice não-template, cada lote `SALES_SYNC` é único por `(org, FOR_BUSINESS, tipo, SALES_SYNC, ano)`, ou seja, um lote por ano;
  - quando um `dueDate` revisado cruza o ano, `createSyncedEntries` precisa mover a linha para o lote do novo ano;
  - o `updatePagar` atual não faz isso (`service.ts:608`, `:630`), e o conserto serve também às linhas manuais;
  - nunca incluir o kind em `MANUAL_IMPORT_FILE_KINDS` nem em `OTHER_SOURCE_TYPES`, e cobrir isso com um teste de guarda;
  - o "desfazer import" já é restrito a `MANUAL_TEMPLATE` (`undo-service.ts:155`, `:234`), então um lote `SALES_SYNC` já está protegido por construção; basta um teste que fixe isso;
  - adicionar as colunas `external_source`, `external_id` e `external_version`, com índice único `(org_id, external_source, external_id)`.
- Isso contraria a 05: `05:274` diz que as linhas sincronizadas "nascem com sourceType proprio".
  A escolha deste documento provavelmente é a certa, por causa do `source_type` por org e da view.
  Mesmo assim, precisa entrar explicitamente na revisão da 05 (seção 8.2, Hub item 2).

**PC13. Estado "anulado" no Finance** (Alta)
- Problema: não basta uma coluna.
  `deriveLancamentoStatus`, que é compartilhada entre servidor e cliente, a view `pgView(...).existing()` e todos os agregados, inclusive o Tático, precisam excluir essas linhas.
- Recomendação: é o item mais caro no Finance.
  Precisa ser dimensionado como fase própria.

**PC14. Categoria e conta** (Média)
- Problema: a categoria é texto, e renomear e apagar funcionam pelo nome.
- Recomendação:
  - o mapeamento fica no Finance e é configurado ao conectar: `kind` do payable e Área ou tipo produto/serviço do receivable -> UUID da categoria e conta padrão;
  - o nome é resolvido no momento da escrita;
  - se uma categoria mapeada for apagada, o sync pausa com erro visível;
  - o Sales nunca conhece o plano de contas.

**PC15. Contraparte** (Média)
- Problemas:
  - casar por `lower(nome)` junda homônimos e quebra com acento ou renomeação;
  - payables de comissão guardam só o nome;
  - os receivables são devidos pelo cliente, e `sales_ops_sales.client_id` é anulável, com `client_name_snapshot` obrigatório;
  - `seller_person_id` e `finder_person_id` também são anuláveis e têm snapshot (`S:apps/api/src/db/schema.ts:794-799`).
- Recomendação:
  - o fio leva `counterparty {ref?, displayName, role}`, com `role` em `client|seller|finder|professional|tax|other`;
  - `ref` é opcional; quando existe, é o `clientId` ou o `personId` resolvido pela venda; quando não existe, vale o snapshot do nome;
  - quando um cliente cadastrado depois for ligado à venda, o Sales emite uma nova `revision` da obrigação com o `ref` preenchido, e o Finance atualiza o vínculo sem duplicar o contato;
  - o Finance guarda um vínculo `(sourceApp, sourceRef) -> contato_id`, e o nome serve só como sugestão inicial;
  - não enviar CPF/CNPJ se não for necessário (LGPD).

**PC16. Identidade estável e ordem** (Alta)
- Problema: a A3 não garante ordem total (`05:276-280`).
- Recomendação:
  - `obligationRef` = id da linha no Sales, mais `revision` monotônica por item;
  - o consumidor só aplica se a `revision` for maior que a gravada;
  - `voided` é terminal;
  - nunca usar `label` como chave, porque ele é renumerado quando uma parcela é zerada (`service.ts:885-891`);
  - nunca usar `sale_professional_id` em chave semântica enquanto `updateSale` o recriar (PC2);
  - a chave semântica de um payable, quando for preciso casar por conteúdo, é `(saleId, kind, receivable obligationRef, papel e pessoa do profissional)`, e não a tupla de ids internos;
  - um novo `won` gera obrigações novas só para o que o Sales realmente recriou (PC6).

**PC17. Tamanho do evento** (Alta)
- Problema: um snapshot por venda (mais de 700 obrigações possíveis) passa de 256KB e seria recusado.
- Recomendação: um evento por Obrigação.
  O checkpoint leva só digests compactos por item e é paginado quando precisar.

**PC18. A chave da A3 transforma o uso normal em alarme** (Alta)
- Problema: com `sale:<saleId>`, o ciclo permitido `won -> open -> editar -> won` gera `conflict` no outbox e `idempotency_conflict` no Hub.
  A spec trata isso como "bug do produtor" (`05:209-210`, `:236`, conferido).
- Recomendação: revisar a 05, com chaves `obligation:<id>:rev:<n>` e `settlement:<ref>`.

**PC19. Backfill** (Média)
- Problemas:
  - a A3 não faz backfill;
  - vendas antigas que já foram digitadas à mão no Finance virariam duplicata;
  - nenhum dos lados tem fatos de pagamento anteriores confiáveis.
- Recomendação:
  - backfill explícito, com data de corte e prévia (linhas, valores e possíveis duplicatas por valor, vencimento e contraparte);
  - a prévia reaproveita `duplicate-lookup.ts` (`(org, ano, data_vencimento)` mais `duplicateKey`) em vez de inventar um casamento novo;
  - UI de vinculação no Finance ("este lançamento manual é esta parcela");
  - o backfill envia só obrigações; pagamentos antigos entram como fatos marcados `recordedBy: 'backfill'`.

**PC20. Conectar, desconectar e reconectar** (Média)
- Problema: a A3 marca `disabled_skip` e não reentrega (`05:150`), o que gera divergência silenciosa.
- Recomendação: seção 6.

**PC21. Expiração de `pending` e a contradição da 05** (Alta)
- Problema:
  - `05:292` e `:300` expiram para `expired` tudo o que ficar `pending` por mais de 30 dias;
  - isso contradiz `05:201`, que promete "nunca perda e nunca dead letter" numa queda do consumidor;
  - a expiração não é silenciosa: `expired` é uma dead letter visível, nunca podada automaticamente (`05:303`), e o operador pode fazer requeue (`05:331`);
  - mesmo assim, para dinheiro com vários escritores, um `settlement.recorded` que fique em dead letter mantém os dois lados divergentes até alguém agir.
- Recomendação:
  - resolver a contradição na revisão da 05 (seção 8.2, Hub item 2);
  - para entregas retidas por `held_reason`, não expirar, ou expirar só depois de um alerta ativo;
  - o checkpoint e a reconciliação são obrigatórios na v1;
  - `expired` exige alerta real (G4) antes do enable.

**PC22. Payload financeiro retido no Hub** (Alta)
- Problemas:
  - quando um evento não tem nenhuma entrega, o payload é anulado aos 30 dias, e só os metadados ficam até os 90 (`05:301`);
  - o problema real de retenção é `05:303`: dead letters e os eventos delas, com payload, nunca são podados automaticamente, então nomes e valores ficam no Hub indefinidamente até um operador descartar;
  - isso contradiz `04:107`;
  - com o two-way, o volume dobra.
- Recomendação:
  - ADR de charter, com uma linha própria sobre a retenção das dead letters (por exemplo, anular o payload de uma dead letter depois de N dias, mantendo hash e metadados);
  - payload mínimo, com referências e nome de exibição, sem documento;
  - o produtor só enfileira quando a activation estiver viva;
    isso exige que o SDK exponha o estado da activation ao produtor, com cache, e é um detalhe de design a fechar no ADR.

**PC23. Segurança e papéis** (Alta)
- Problemas:
  - no Sales, `POST /sales`, `POST /sales/:id/transition`, `POST /sales/:id/cancel-contract`, `PUT /sales/:id` e `PUT /settings` não têm gate de papel (`routes.ts:302`, `:321`, `:336`, `:353`, `:381`);
    na prática, qualquer membro pode criar uma venda já `won` e gerar despesas no Finance, ou mudar `currency`, `defaultTaxPct` e `taxRegime`;
  - no Finance, `manual-entries` não tem gate de papel;
  - no Finance, a RLS está dormente, então o handler é a única barreira de tenant;
  - `/api/fxl` é inseguro.
- Recomendação:
  - `requireAdmin` (ou um papel explícito de operador financeiro) em todas as rotas do Sales acima e na baixa do Sales;
  - `requireOrgEditor` em manual-entries e na baixa do Finance;
  - o handler do Finance lê o `orgId` do envelope autenticado pelo Hub, nunca do corpo, e passa pelo `orgscope`;
  - teste cruzado entre orgs;
  - nunca estender `/api/fxl` para escrita.

**PC24. Moeda e datas** (Média)
- Recomendação:
  - o fio leva `amountCents` inteiro e `currency: 'BRL'` literal;
  - a opção USD do Sales sai da UI e do schema, o que é barato, porque a configuração não tem efeito nenhum (Q10);
  - datas `YYYY-MM-DD` com semântica civil em `America/Sao_Paulo`;
  - o Sales corrige `asDateOnly` e o `effectiveDate` padrão do cancelamento para o dia de São Paulo;
  - o Finance converte por string (`centavosParaDecimalString`), nunca por float, e corrige o float do `updatePagar`, que é pré-requisito do "Desvincular".

**PC25. Latência e três estados na tela** (Média)
- Problema: o pull de 15 s (15 a 60 s de ponta a ponta), a falta de "anulado" e o SG-11-01 podem mostrar o mesmo dinheiro em três estados diferentes.
- Recomendação:
  - um badge por linha: "Sincronizado", "Pendente", "Em disputa", "Desvinculado";
  - consertar o SG-11-01 antes;
  - o dono aceitar consistência eventual (Q9).

**PC26. Auditoria** (Média)
- Problema: no Sales, o `audit_log` é uma cadeia única e global, e `writeAuditEntry` trava a última linha com `FOR UPDATE` (`audit/service.ts:13-14`).
  Auditar todo `won`, revert, cancelamento e baixa de todas as orgs põe todas as escritas financeiras de todos os tenants atrás de uma única linha disputada.
- Opções:
  - (a) aceitar e medir a contenção sob carga realista;
  - (b) introduzir cadeias por org (`prev_hash` por `actor_org_id`), com migração da verificação da cadeia.
- Recomendação: (b), por robustez e escala.
  (a) só vale como medição antes da decisão.
  Além disso:
  - o Finance audita as escritas do sync com um ator de máquina (`integration:app.fxl-sales`), inclui o estado de pago no antes e depois, e grava o `eventId`;
  - o `hub_inbox.result` liga as duas pontas.

**PC27. Cardinalidade entre orgs** (Média)
- Recomendação: na v1, só a mesma Organization do Hub.
  Um vínculo entre orgs diferentes (holding) exige consentimento dos dois lados e abre risco de vazamento; fica adiado.

**PC28. Escopo das comissões** (Baixa)
- Recomendação: na v1, só `sales_ops_payables`.
  Afiliados (`commissions` e `payouts`) só entram por decisão explícita (Q8).

**PC29. Observabilidade** (Média)
- Problema: o painel "Contratos" da A3 está atrás do G3.
- Recomendação:
  - heartbeat e `last_sync_at` visíveis nos dois apps;
  - contadores de pendente, dead letter e disputa;
  - logs só com ids.

**PC30. Portabilidade do Finance** (Média, UNVERIFIED)
- Problema: se o export e o import de `org-portability` não carregarem as colunas `external_*` e as tabelas de fatos, uma reidratação quebra os vínculos.
- Recomendação: incluir no escopo e cobrir com teste.

**PC31. Jobs periódicos e múltiplas instâncias** (Média)
- Problema: os crons do Sales (`nightly-job.ts:34`, `:47`, `:63`) não têm eleição de líder, e não se sabe quantas instâncias da API rodam (UNVERIFIED).
  O dispatcher da 05 usa `SKIP LOCKED` e aguenta várias instâncias.
  Os jobs novos propostos aqui (checkpoint noturno, horizonte de recorrência) não aguentam, a menos que isso seja especificado.
- Recomendação: todo job novo pega trabalho com `FOR UPDATE SKIP LOCKED` por venda, ou usa um advisory lock, e é idempotente por `(saleId, asOf)`.

**PC32. Visibilidade do vendedor sobre estado vindo do Finance** (Média)
- Problema: `CommissionsView` soma `payable.status === 'paid'` (`SalesOpsApp.tsx:3038-3044`).
  Hoje o resultado é sempre 0, porque nada grava `paid` no sales-ops.
  Quando as liquidações voltarem do Finance, `paidOn` e `adjustments` gerados lá passam a aparecer no Sales.
  Não foi conferido se `meus-dados` filtra os payables pelo vendedor no servidor (UNVERIFIED).
- Recomendação: conferir e, se preciso, garantir o filtro no servidor, dentro do `withTenant`, antes de responder "Sim" à Q18.

---

## 4. Opções de arquitetura

| Opção | Como funciona | Prós | Contras | Veredito |
|---|---|---|---|---|
| (a) App a app, API mais webhooks | HMAC por par, precedente `conversions`, e é o que `04:105-106` prescreve para webhooks de domínio | Menos peças; alinhado com a letra da 04 | N x M segredos, endpoints de entrada e verificadores; o consumidor é onde a frota erra (H1/M10); sem painel; um 3º app multiplica os pares; push exige endpoint público em cada consumidor (`05:201`) | Rejeitar, e o ADR precisa substituir `04:105-107` explicitamente |
| (b) Hub como broker (A3) | Outbox no app, ingest no Hub, fila Postgres, pull, lease e ack | Já desenhada e revisada; o produtor nunca recebe token nem endereço do consumidor; revogação imediata; um 3º app só precisa de registro e handler; o outbox segura quando o Hub cai (`05:289`) | 5 tabelas, sweeper, admin e SDK 2.5.0 no Hub; payload financeiro retido, inclusive indefinidamente em dead letter; latência de pull; depende de G1 a G4 | **Recomendar, revisada para duas vias** |
| (c) Hub como registro e emissor de token S2S, dados diretos | `client_credentials` e chamadas diretas | Síncrono, bom para consulta | Rejeitada pela própria 05 (A2, 54 a 58 pontos, `05:180-191`): tenant no token sem conferir membership, revogação com janela de TTL, verificador novo no consumidor; o STS vira dependência de toda escrita | Rejeitar; reabrir só se surgir necessidade real de consulta síncrona |
| (d) Serviço de razão compartilhado | Um terceiro sistema dono das obrigações | Verdade única | Migração enorme; o Finance deixa de ser dono do próprio domínio; mais um serviço crítico | Não agora; revisitar com 3 ou mais produtores financeiros |
| (e1) Finance como sistema de registro | O Sales cria no Finance e lê de volta | Sem conflito | A maioria das orgs de Sales não terá Finance; o Sales quebra sem ele | Rejeitar |
| (e2) Dono por campo sobre (b) | Sales dono da obrigação, Finance da classificação, liquidação por fatos | Converge sem relógio; os dois apps funcionam sozinhos | Tabela de fatos nos dois lados e um redutor compartilhado | **Recomendar como modelo de domínio** |

**Recomendação: (b) como transporte e (e2) como domínio.**
- O Hub é um bom intermediário aqui por três motivos:
  - já é a autoridade de Organization e acesso (`hasAccess`);
  - já autentica Applications (`applicationClientAuth`);
  - um terceiro app consumiria os mesmos fatos sem novos pares.
- A objeção do finance-first ao Hub no caminho dos dados foi retirada na revisão cruzada, porque a A3 não é síncrona.
- Continuam valendo duas condições:
  - o ADR que substitui `04:105-107`;
  - a política de retenção de payload, inclusive nas dead letters.

**Responsabilidades no Hub**
- Registro de Event Types e schemas imutáveis.
- Contracts e Activations por Organization, com checagem de `hasAccess` nas duas Applications e, se houver cobrança, de um Module.
- Opcionalmente, checagem de `workspace_kind = company`.
- Ingest validado, fila, entrega, dead letter e poda.
- Painel operacional.
- Broker de desenvolvimento (seção 5.10).
- Schemas canônicos neutros `fxl.obligation.*` e `fxl.settlement.*`, para que N produtores alimentem um mesmo consumidor.

**Responsabilidades nos apps**
- Todo o domínio: gerar obrigações, redutor de liquidação, trava de campos, mapeamento de categoria e contato, estado anulado e disputa.
- Outbox transacional e inbox.
- Checagem de `FOR_BUSINESS` (o Hub não conhece esse conceito).
- UI de sincronização, reconciliação e resolução de disputa.

**O que o Hub NÃO deve fazer**
- Guardar estado financeiro canônico.
- Resolver conflito.
- Mapear categoria.
- Virar um "Hub gordo" (`04:36`).

---

## 5. Proposta de contrato

### 5.1 Envelope

Campos: `{eventId, eventType, schemaVersion, organizationId, producer, occurredAt, idempotencyKey, payload}`.
- O `organizationId` vem do envelope autenticado pelo Hub.
- O consumidor nunca confia num `org_id` do payload.
- O token contract NÃO muda: `HUB_TOKEN_CONTRACT_VERSION = 1` (`05:357`).

### 5.2 Entidades

- **Obligation**
  - `obligationRef` = `fxl-sales:<id>`, `direction` (`receivable|payable`)
  - `kind` (`sale_installment|sale_recurring|seller_commission|finder_commission|professional_cost|tax|other_cost`)
  - `amountCents` (inteiro > 0), `currency: 'BRL'`, `dueDate` (`YYYY-MM-DD`, São Paulo), `method?`
  - `counterparty {ref?, displayName, role}`
  - `source {saleId, saleCode, displayLabel, fundedByObligationRef?, areaIds[]}`; o `displayLabel` (`N/M`, `MN/M`) é só para exibição, nunca identidade
  - `revision`, `state` (`active|voided`), `voidReason?`, `effectiveDate?`
- **ContractCancellation**
  - `saleRef`, `effectiveDate`, `recordedBy`
- **Settlement**
  - `settlementRef` = `<originApp>:<uuid>`, `obligationRef`
  - `kind` (`full`; `partial` fica reservado para uma v2)
  - `amountCents`, `paidOn` (data real), `adjustments {discount, interest, fine}`, `accountHint?`
  - `recordedBy {app, accountId}` (`backfill` quando for o caso)
- **SettlementReversal**
  - `reversalRef`, `obligationRef`, `reverses: settlementRef[]` (os fatos que o autor VIU), `recordedBy`
- **LedgerCheckpoint**
  - `saleRef`, `asOf`, `page`, `items [{obligationRef, revision, state, amountCents, settlementDigest}]`, `hash`

### 5.3 Dono por campo

| Campo | Dono | No outro lado |
|---|---|---|
| Existência, valor nominal, vencimento, contraparte, tipo, rótulo e série, anulação | Sales | Somente leitura no Finance (409, controle desabilitado), inclusive para DELETE de linha e de série |
| Categoria, grupo, centro de custo, conta ou carteira, observações | Finance | Nunca volta ao Sales |
| Liquidação (pago, data real, valor, ajustes, estorno) | Os dois, por fatos | Convergência por união |
| Vínculo (Desvincular) | Finance, como ação explícita e auditada | O Sales mostra "Desvinculado" |

### 5.4 Catálogo de eventos

A PK do `hub_inbox` é `(org_id, event_type, idempotency_key)` (`05:268`).
Se `issued` e `revised` fossem tipos separados com a mesma chave `obligation:<id>:rev:<n>`, a mesma revisão passaria duas vezes pelo inbox.
Por isso, a obrigação usa um único tipo de evento, com `state` no payload.
Isso também elimina o problema de ordem entre `issued` e `revised`.

| Evento | Produtor | Chave de idempotência | Semântica |
|---|---|---|---|
| `fxl-sales.obligation.upserted` v1 | Sales | `obligation:<id>:rev:<n>` | aplica se a `revision` for maior; `state: voided` é terminal; `voided` com fato ativo vira `disputed`; mudança de valor ou vencimento é recusada na origem se houver fato ativo |
| `fxl-sales.contract.cancelled` v1 | Sales | `contract-cancel:<saleId>:<effectiveDate>` | registra o fim do contrato; as anulações vêm como `upserted` com `voidReason: contract_cancelled` |
| `fxl-sales.settlement.recorded` v1 e `fxl-finance.settlement.recorded` v1 | cada um | `settlement:<ref>` | união |
| `fxl-sales.settlement.reversed` v1 e `fxl-finance.settlement.reversed` v1 | cada um | `reversal:<ref>` | remove só os `reverses` citados |
| `fxl-sales.ledger.checkpoint` v1 | Sales | `checkpoint:<saleId>:<asOf>:<page>` | compara e abre pendência, sem alterar nada |

A emissão acontece na mesma transação de negócio em:
- `createSale(won)`;
- `transitionSale`;
- `cancelContract`;
- `updateSale` (como anulação mais obrigações novas);
- a baixa local.
Rascunho, `open` e `lost` não emitem nada (Q2).

### 5.5 Invariantes

Cada invariante vira um teste oráculo com nome, nos dois repos.
- I1. A soma dos `amountCents` das Obrigações `active` de uma venda é igual ao subconjunto sincronizado de `computeSaleFinancials`.
  O subconjunto é definido por kinds sincronizados x horizonte, e uma função com nome no pacote de contrato calcula isso.
  Na v1 o subconjunto exclui `tax` (PC9), recorrência indefinida (PC8) e afiliados (PC28).
  O Finance nunca recalcula.
- I2. Item publicado nunca é apagado fisicamente, nem no Sales nem no Finance.
- I3. A `revision` só cresce, por item.
  `voided` é terminal.
  Uma mudança de valor ou vencimento depois de um fato ativo é recusada na origem.
- I4. Nenhum fato de liquidação é apagado; o estorno é um fato novo.
- I5. O estado de pago é uma função pura dos fatos, calculada por um único redutor publicado no pacote de contrato.
- I6. Aplicar um fato remoto nunca gera um fato local (anti-eco por `recordedBy.app`).
- I7. Uma Obrigação `voided` com fato ativo fica `disputed`, nunca `open` ou `paid` em silêncio.
- I8. A `organizationId` é a mesma nos dois lados.
  A activation só existe com `hasAccess` nas duas Applications, Finance em `FOR_BUSINESS` e moeda BRL.
- I9. Centavos inteiros no fio.
  Datas `YYYY-MM-DD` em São Paulo.
  Nenhum caminho em float no consumidor.
- I10. O handler roda na mesma transação do `hub_inbox` e filtra por `org_id`.
- I11. Nenhuma identidade de contrato deriva de `label` ou de `sale_professional_id`.

### 5.6 Regras de conflito para "pago"

- O estado é pago se existe algum fato `full` sem estorno.
- `paidOn` é o menor entre os fatos ativos.
- Dois `full` concorrentes resultam em pago, com o marcador informativo "registrado em duplicidade".
- Um estorno só remove os `settlementRef` que cita.
  Uma baixa concorrente que o autor do estorno não viu continua valendo, e a UI mostra "pago novamente em <app>".
- Uma liquidação numa obrigação `voided` resulta em `disputed`.
  Resolver exige uma pessoa: estornar o pagamento ou reativar a obrigação com um novo `upserted`.
- Offline: cada app aceita a baixa localmente e propaga depois.

### 5.7 Idempotência, ordem e entrega

- Três pontos de idempotência, conforme a A3: o outbox (`UNIQUE org, type, key`), o ingest (hash) e o `hub_inbox`.
- No Finance, o índice único `(org_id, external_source, external_id)`.
- Entrega pelo menos uma vez, com lease de 300 s, backoff e dead letter visível que nunca é podada.
- A ordem não importa: `revision` resolve as obrigações, e OR-Set resolve os fatos.

### 5.8 Versionamento

- Schema imutável por versão, com publicação dupla (`05:45-54`).
- O consumidor aceita as versões N e N-1 e recusa versão desconhecida com erro explícito, no padrão de `SUPPORTED_HUB_CONTRACT_VERSION` (`F:apps/api/src/auth/contract.ts:45-71`).
- Adicionar `partial` ou mudar uma semântica exige v2.

### 5.9 Reconciliação

- Um checkpoint noturno por venda `won` alterada, e também sob demanda.
- O job é seguro com várias instâncias (PC31).
- O Finance devolve as divergências como pendências.
- A correção automática só acontece quando o dono do campo é inequívoco.
- Segue o padrão "projeção mais backstop" da ADR 0004.

### 5.10 Fake-dev

- Sales e Finance são processos separados com bancos separados.
  Um broker em processo dentro de um app não pode ser consultado pelo outro.
- Opções:
  - (a) um processo de broker de desenvolvimento independente, publicado pelo `hub-sdk-testing`, com schema próprio num Postgres local e as mesmas regras de ingest, pull e ack;
  - (b) a API real do Hub rodando localmente.
- Recomendação: (a).
  O broker é iniciado por um alvo de make compartilhado, e os dois apps apontam para ele por uma única variável de ambiente.
  Ele é ativado no boot, como o `auth-fake`, nunca por request, e fica só como devDependency, com guard de isolamento.
- Uma org de fixture comum aos dois rosters (por exemplo `org_fake_integrated`), com seeds coerentes, para que `make dev-fake` nos dois repos concorde na mesma org.
  Hoje os rosters não têm nenhuma org em comum.
- `org_fake_outro_produto` do Finance (`F:packages/auth-fake/src/index.ts:213-219`) serve de caso negativo "acesso em um app só".

### 5.11 Testes de contrato entre repos

- Um pacote versionado com os schemas, os exemplos "golden", o redutor de liquidação e a função do subconjunto sincronizado (I1), publicado junto com o SDK.
- Teste do produtor: todo payload emitido valida contra a versão fixada.
- Teste do consumidor: replay dos exemplos golden.
- Guard de imutabilidade do schema.
- Teste do redutor com todas as permutações de ordem.

### 5.12 Segurança

- Credencial por Application e ambiente (Basic `application_client`).
- A autoridade por org é conferida no ingest e no pull.
- Payload mínimo, sem documento.
- Logs só com ids.
- `orgscope` no handler do Finance.
- Gates de papel nos dois apps (PC23).

---

## 6. Ciclo de vida da conexão

1. **Conectar**
   - Na v1, quem liga é o operador; na v2, o owner ou admin, com tela de consentimento no Hub (Q4).
   - Pré-condições:
     - `hasAccess` nas duas Applications;
     - Finance em `FOR_BUSINESS`;
     - moeda BRL;
     - mapeamento de categorias configurado no Finance;
     - opcionalmente, um Module pago e `workspace_kind = company`.
   - A partir daí, o guard de `source_type` passa a considerar a activation viva.
2. **Backfill**
   - Explícito, disparado no Sales, com data de corte e prévia de linhas, valores e possíveis duplicatas (reaproveitando `duplicate-lookup.ts`).
   - Só obrigações.
   - Vinculação manual das linhas já digitadas no Finance.
   - Relatório antes de aplicar.
3. **Operação normal**
   - Eventos por item, checkpoint noturno e badges por linha.
   - Heartbeat e `last_sync_at` nos dois apps.
4. **Desconectar**
   - Os eventos param.
   - As linhas no Finance continuam, marcadas "desvinculadas por desativação", e ficam editáveis.
     Isso exige antes o conserto do float do `updatePagar`.
   - O Sales guarda os refs externos.
   - Os fatos de liquidação são preservados nos dois lados.
5. **Reconectar**
   - Reconciliação completa por checkpoint antes de voltar ao fluxo de eventos, nunca replay cego (a A3 não reentrega `disabled_skip`, `05:150`).
   - Linhas desvinculadas que foram editadas nesse intervalo viram pendência, detectadas no padrão de `countEditedRows`.
6. **Perda de entitlement ou de `FOR_BUSINESS`**
   - A entrega fica retida (`held_reason`), sem ir para dead letter.
   - Isso vale para acesso perdido, org arquivada no Finance (`org_settings.archived_at`) e troca de source.
   - Alerta antes da expiração de 30 dias, que precisa ser reconciliada com `05:201` (PC21).
   - Se a situação continuar, é tratada como desconexão.

---

## 7. Perguntas de produto em aberto para o dono

| # | Pergunta | Padrão recomendado |
|---|---|---|
| Q1 | Onde o usuário dá baixa de verdade? O Sales precisa ter "marcar como pago"? | Sim nos dois, por fatos. Se o uso real for só no Finance, o Sales apenas exibe na v1 |
| Q2 | Uma proposta `open` aparece no Finance como previsão? | Não; só `won` |
| Q3 | Recorrência indefinida: sincronizar na v1? Se sim, com linhas reais no Sales ou projeções só no fio, e com qual horizonte? | Fora da v1; depois, 12 meses móveis |
| Q4 | Quem liga a integração? Ela é paga? | Operador na v1; owner ou admin na v2; incluída no For Business, sem Module novo, até haver motivo comercial |
| Q5 | Revert de venda com parcela já paga: bloquear ou estornar? E, sem pagamento, o revert anula os receivables? | Bloquear quando há pagamento, com estorno explícito e manual; sem pagamento, anular os receivables também |
| Q6 | O cancelamento de contrato deve anular `other_cost` e o custo de profissional pago de uma vez? | Decidir explicitamente; padrão: não anular, com aviso |
| Q7 | Imposto: por parcela, por competência ou fora da v1? | Fora da v1 |
| Q8 | As comissões de afiliados entram? | Não |
| Q9 | Latência de 15 a 60 s é aceitável? | Sim, com badge "Pendente" |
| Q10 | Remover a opção USD do Sales? | Sim; a configuração não tem efeito hoje |
| Q11 | O gate é `source_type`, `workspace_kind` do Hub ou um Module? | `FOR_BUSINESS` no Finance mais `hasAccess` dos dois lados |
| Q12 | Sempre a mesma Organization? Existe caso de holding? | Mesma org na v1 |
| Q13 | Backfill desde quando? | Sem backfill automático; data escolhida na conexão |
| Q14 | Comissão vence na data da parcela ou depois do recebimento? | Manter a data da parcela na v1 |
| Q15 | Pagamento parcial na v1? | Não, mas o fio já suporta |
| Q16 | O que o Finance pode editar numa linha vinculada? | Só a classificação e as observações; nada de excluir linha ou série |
| Q17 | Desconectar mantém as linhas no Finance? | Sim, desvinculadas |
| Q18 | Comissão e custo pagos pelo Finance aparecem para o vendedor em `meus-dados`? | Sim, só o estado, depois de confirmar o filtro por vendedor no servidor (PC32) |
| Q19 | Quem pode ganhar, reverter, cancelar e editar propostas e configurações financeiras no Sales? | Só admin (ou um papel financeiro explícito) |

---

## 8. Riscos e pré-requisitos

### 8.1 Riscos

| Risco | Severidade |
|---|---|
| Perda de linhas pagas e de vínculos pelo `updateSale` (ledger, profissionais e itens) | Crítica |
| Construir duas vias sobre a A3 sem revisá-la (first-write-wins, alarme de conflito no uso normal, expiração contraditória) | Crítica |
| Rotas financeiras sem gate de papel no Sales: qualquer membro gera despesas no Finance | Alta |
| Cadeia longa de dependências no Hub (promoção do delta 2.3.0, G1 a G4, SDK 2.5.0) | Alta |
| Custo do estado "anulado" no Finance (view, status, Tático) subestimado | Alta |
| Recorrência indefinida quebrando rótulos e regras do Sales se entrar sem desenho | Alta |
| Contenção na cadeia global do `audit_log` quando as escritas financeiras forem auditadas | Média |
| Vazamento entre tenants com RLS dormente no Finance | Média |
| PII retida no Hub indefinidamente em dead letters, contra `04:107` | Média |
| Drift entre cópias do redutor e do schema sem pacote único | Média |
| Jobs novos duplicados com várias instâncias do Sales | Média |
| Três estados visíveis para o mesmo dinheiro (latência, SG-11-01) | Média |
| O Hub virar "gordo" | Estratégica |

### 8.2 Pré-requisitos por repo

**Sales**
1. Gate de papel em `POST /sales`, transition, cancel-contract, `PUT /sales/:id`, `PUT /settings` e na baixa.
2. `updateSale` sem delete físico de item publicado, incluindo profissionais e itens.
3. Colunas `paid_on`, `updated_at` e `revision`, e a tabela de fatos de liquidação.
4. Baixa e estorno (se Q1 = sim).
5. Auditoria das transições e liquidações, com cadeia por org ou medição da cadeia global.
6. `asDateOnly` e o `effectiveDate` padrão no dia de São Paulo.
7. Moeda travada em BRL (remover USD).
8. `contract_ended_at` persistido pelo `cancelContract`.
9. Recorrência indefinida: decisão e desenho de rótulo antes de qualquer horizonte.
10. Corrigir `CLAUDE.md`, `propostas.md` e o comentário de `hooks.ts:270-271` juntos.
11. Outbox, e jobs seguros com várias instâncias.

**Finance**
1. Colunas `external_*` com índice único.
2. `createSyncedEntries` fora do CRUD, em centavos, que troca o lote quando o ano muda.
3. `SALES_SYNC` no CHECK de `source_file_kind` e no `pgEnum`, com teste de guarda contra wipes e undo.
4. Trava de campos, de DELETE e de operações de série, e "Desvincular".
5. Estado anulado em `deriveLancamentoStatus`, na view e nos agregados.
6. Tabela de fatos e data real de pagamento.
7. `requireOrgEditor` em manual-entries.
8. Estado de pago no audit.
9. Conserto do float do `updatePagar` e da troca de lote quando o ano muda.
10. Guard de `source_type` que considere a activation.
11. Vínculo externo de contato e mapeamento de categoria por UUID.
12. Conserto do SG-11-01.
13. Inbox.

**Hub**
1. ADR de charter que substitui explicitamente `04:105-107` pela A3 e define a retenção de payload, inclusive nas dead letters (`05:303`).
2. Revisão da 05 para duas vias:
   - chaves por item, `revision` e um tipo único `obligation.upserted`;
   - Finance como produtor;
   - checkpoint;
   - alerta de `expired` e a resolução da contradição entre `05:201` e `05:292`;
   - emissão só com activation viva e payload mínimo;
   - troca de "sourceType proprio" (`05:274`) por `FOR_BUSINESS` mais `SALES_SYNC`.
3. Reancorar as linhas de código citadas e acertar 2.4.0 contra 2.5.0 nos critérios de aceite.
4. G1 a G4.
5. As tabelas `integration_*` e o SDK 2.5.0.
6. Schemas canônicos, broker de desenvolvimento como processo independente e pacote de contrato.

### 8.3 Sequência sugerida

- **Fase 0 (decisão):** respostas às perguntas da seção 7, ADR de charter no Hub e revisão da 05.
- **Fase 1 (saúde local, independente da integração):**
  - Sales: gates de papel, fim do delete físico, auditoria, fuso, moeda, `contract_ended_at` e correção da documentação;
  - Finance: `requireOrgEditor`, float e troca de lote do `updatePagar`, pago no audit, SG-11-01.
- **Fase 2 (modelo de liquidação local):** tabela de fatos e redutor nos dois apps, baixa no Sales e data real de pagamento no Finance.
  Cada app já ganha valor sozinho com isso.
- **Fase 3 (lado consumidor do Finance):** `external_*`, lote `SALES_SYNC`, estado anulado, trava de campos, mapeamento e vínculos.
- **Fase 4 (Hub):** A3 revisada, SDK, broker de desenvolvimento e pacote de contrato, depois que o delta 2.3.0 for promovido.
- **Fase 5 (piloto):** Sales -> Finance só com obrigações de recorrência finita, numa org, com checkpoint.
- **Fase 6:** liquidação nas duas vias e disputa.
- **Fase 7:** conexão pelo owner, backfill assistido, recorrência indefinida (se decidida) e, se for o caso, um Module pago.

---

## 9. Divergências entre pesquisadores e correções da revisão crítica

### 9.1 Divergências entre os três pesquisadores

| Tema | Posições | Como foi decidido |
|---|---|---|
| Troca de `source_type` no Finance | sales-first: livre. finance-first e hub-first: bloqueada | Bloqueada quando há linhas (`source-type-change.ts:51-58`, conferido). O sales-first admitiu o erro. Sobra a lacuna da org vazia (PC11), que os três aceitaram |
| Por que "todos os provedores" não funciona | Wipe de outras fontes contra a view que esconde o legado | As duas coisas somam; o motivo decisivo é a view. `FOR_BUSINESS` não está em `OTHER_SOURCE_TYPES` (conferido) |
| Arquitetura (b) contra (c) | finance-first: (c). Os outros: (b) | O finance-first retirou (c) ao ler a 05 (A2 rejeitada em `05:180-191`). A objeção dele sobre payload no Hub virou condição (ADR). `04:105-107` e `05:238` se contradizem (conferido) |
| Ordenação de "pago" contra "desfazer" | finance-first: contador emitido pelo Sales. sales-first e hub-first: OR-Set | OR-Set: não precisa de sequenciador e funciona com o Sales fora. O finance-first adotou "fato novo de estorno" na posição revisada |
| Grão do evento | sales-first: snapshot por venda. hub-first: por item | Por item: o snapshot passa de 256KB (`05:211`, `:229`, conferido). O checkpoint aproveita a ideia do snapshot, mas compacto e paginado |
| Casamento de contato | "lower" contra "byte a byte" | Ignora maiúsculas, não ignora acentos (`service.ts:280`) |
| "O Hub não conhece For Business" | hub-first contra os outros | O Module `finance.for-business` existe só no Finance e só define o `source_type` inicial. O Hub tem `workspace_kind`, sem relação |
| Moeda do Sales | UNVERIFIED nos três | Qualquer string é aceita e a UI oferece USD, mas a configuração não tem efeito: nem cálculo nem exibição a leem (`Intl` fixo em BRL em `SalesOpsApp.tsx:3128-3129` e `calculations.ts:464-465`) |
| `/api/fxl` no HEAD | UNVERIFIED no hub-first | Confirmado e inseguro |
| App mobile como escritor | UNVERIFIED no sales-first | Não escreve lançamentos |
| Onde o Finance grava | Implícito nos três | Em `contas_*` com lote `SALES_SYNC` e `sourceType='FOR_BUSINESS'`, nunca em `transactions` (prefer-canonical) |
| Números de linha | Pequenas diferenças | Mesmo código. `service.ts:2466-2479` e `:2636-2650` conferidos |

### 9.2 Correções da revisão crítica

Aplicadas depois de conferidas no código:
- "O Hub nem está em produção" estava errado.
  O Hub roda em `origin/production` `8086325` (SDK `2.2.0`), `last_release: v0.11.0` (`H:nexo/state.json:20`), e `main` está 96 commits à frente.
  O que falta é promover o delta 2.3.0.
  O deploy real no Coolify segue UNVERIFIED.
  O `F:CLAUDE.md:11` diz literalmente "until the Hub is in production", mas o bloqueio concreto é o `contractVersion` e o registro de `app.fxl-finance`, que dependem desse delta.
- A moeda "só afeta a exibição" estava errada: a configuração não tem efeito nenhum (seções 2.1 e 9.1).
- PC21: a expiração não é silenciosa (`05:292`, `:303`, `:331`).
  O achado real é a contradição entre `05:201` e `05:292`, agora incluída.
- PC22: a poda de 30 dias anula o payload de eventos sem entrega (`05:301`).
  O problema real é a retenção indefinida das dead letters (`05:303`).
- `04:105-106` também prescreve webhooks de domínio no próprio app; o ADR precisa substituir `04:105-107`.
- I1 foi reescrito como igualdade sobre o subconjunto sincronizado.
- PC8: foram registrados os efeitos do horizonte móvel sobre rótulos, `deriveWizardPrefill`, a regra `not_cancellable` (`:2703-2705`) e os agregados.
- PC6/PC16: um novo `won` sem edição preserva os ids dos receivables (`:2636-2650`, `:1066-1073`).
- PC2: `updateSale` também apaga profissionais e itens (`:2472-2479`), então `sale_professional_id` não é estável.
- PC16: `label` renumera quando uma parcela é zerada (`:885-891`).
- PC15: foi incluído o lado do cliente, com `client_id` anulável e snapshot (`schema.ts:794-799`).
- PC23: a superfície sem gate inclui `POST /sales`, `PUT /sales/:id` e `PUT /settings` (`routes.ts:302`, `:353`, `:381`).
- PC26: a cadeia global do `audit_log` serializa todos os tenants (`audit/service.ts:13-14`).
- Crons: são três tarefas (`nightly-job.ts:34`, `:47`, `:63`), sem eleição de líder (PC31).
  O revisor citou "pelo menos duas"; a terceira, `30 3 * * *`, foi encontrada na conferência.
- PC12: um `dueDate` que cruza o ano deixa a linha no lote errado (`manual-entries/service.ts:608`, `:630`).
  A função de lote se chama `ensureManualBatch` (`:148-220`), e não `getOrCreateManualBatch :150-190` como o revisor citou.
- PC19: reaproveitar `duplicate-lookup.ts` e `countEditedRows`.
  O undo já é restrito a `MANUAL_TEMPLATE` (`undo-service.ts:155`, `:234`).
- PC3: a trava precisa cobrir DELETE e as operações de série.
- PC12 contra `05:274`: a troca de "sourceType proprio" foi listada como mudança na 05.
  O revisor citou `05:273`; a frase está em `:274`.
- 5.4: tipo único `obligation.upserted` por causa da PK do `hub_inbox` (`05:268`).
- 5.10: o broker de desenvolvimento precisa ser um processo independente; `org_fake_outro_produto` (`F:packages/auth-fake/src/index.ts:213-219`) é um caso negativo pronto.
- Q18: seller visibility (PC32).
  `CommissionsView` soma `paid` (`SalesOpsApp.tsx:3038-3044`).
  O filtro por vendedor no servidor segue UNVERIFIED.
- 2.1: a invariante "paid rows untouched" (`hooks.ts:270-271`, `propostas.md:46`) só é exercitada por fixtures de teste (`sale-transitions.integration.test.ts:255`, `:313`, `:712`).
- 2.1 e PC7: `cancelContract` não deixa rastro durável, devolve `ok` sem anular nada em recorrência indefinida e usa o dia UTC por padrão (`:2687`, `:2703-2705`).

Recusada:
- **"`source_file_kind` é um enum do Postgres, não um CHECK; incluir no CHECK está errado; precisa de `ALTER TYPE ... ADD VALUE`".**
  Isso está errado.
  O comentário em `F:apps/api/src/db/schema/enums.ts`, logo acima de `:40`, diz: "Declared as pgEnum for Drizzle type inference; the DB uses a text CHECK constraint (migration 019 + 035 + 037 + 047 + 071) rather than a named Postgres enum type".
  `F:migrations/071_import_batches_template_kind.sql:122-128` define `import_batches_source_file_kind_check` como `CHECK (source_file_kind IN (...))`.
  O texto original ("incluir no CHECK") estava certo.
  A ressalva sobre `ALTER TYPE` em transação e no PGlite não se aplica.
  Do mesmo apontamento, ficou a parte correta: a identidade do lote é `(org, FOR_BUSINESS, tipo, kind, ano)`, um lote por ano.

### 9.3 Itens que continuam UNVERIFIED

- Se o SKU `finance.for-business` está cadastrado no banco do Hub.
- Se o Coolify realmente implantou `8086325`.
- Se `org-portability` preserva colunas externas.
- Se o Finance bloqueia `FOR_BUSINESS` em orgs `personal`.
- Se existem clientes com Sales e Finance em Organizations diferentes.
- Quantas instâncias da API do Sales rodam em produção.
- Se `meus-dados` filtra payables por vendedor no servidor.
- O impacto das linhas de horizonte nos dashboards e resumos do Sales.
- A latência real do pull, que só dá para medir depois que a A3 existir.
---

## 10. Decisões do dono (2026-09-23)

- Q1: sim, o Sales ganha "marcar como pago" (baixa real, com data de pagamento).
- PC2: premissa alterada. Editar uma venda ALTERA as linhas existentes (receivables, payables, profissionais, itens); nunca apaga e recria. Vale independente da integração.
- PC3: o dono vai levar ao Finance a necessidade de "data de pagamento" real (lançamento pendente pago depois), não só pago/não pago.
- PC4/PC5: escopo restrito ao modo `FOR_BUSINESS` do Finance; provedores (Conta Azul, Omie etc.) ficam fora.
- Q3: recorrência indefinida fora.
- Q5: venda com parcela paga que sai de `won` exige estorno manual.
- Q11: o gate é o For Business.
- Restrição nova de infra: não guardar payload financeiro no banco do Hub e não crescer infra agora (sem fila gerenciada, sem serviço novo). Correção do dono: staging roda em Hetzner via Coolify (o que `H:CLAUDE.md:21` descreve), mas PRODUÇÃO roda na AWS; os CLAUDE.md dos três repos estão desatualizados nesse ponto.
  O desenho abaixo usa só o Postgres de cada app, então vale igual nos dois ambientes e não exige serviço AWS novo (SQS, EventBridge).
  Consequência: a opção (b)/A3 (fila e payload no Hub) sai. Entra "Hub como plano de controle, apps como plano de dados": o Hub guarda só registro de event types, Contrato e Activation e responde autorização; cada app expõe um feed lido do próprio outbox e o outro app puxa por cursor direto do produtor.
- Restrição nova de produto: os dois apps continuam usáveis sozinhos. A trava de campos vale SOMENTE para linhas vinculadas (nascidas no Sales numa org conectada); lançamentos manuais do Finance e toda org não conectada ficam 100% livres.
- Produção: APIs em EC2 sempre ligadas (confirmado pelo dono). A rotina de pull roda dentro do processo da API, sem agendador externo.
  Ela deve ser segura com várias instâncias desde o início (cursor por par produtor/org travado com `SELECT ... FOR UPDATE SKIP LOCKED` ou advisory lock, aplicação idempotente pelo inbox), mesmo que hoje exista uma instância só, porque staging (uma instância) nunca mostraria esse bug.

---

## 11. Contrato consolidado v0 (2026-09-23)

Esta seção substitui as seções 4, 5 e 6 onde elas conflitarem.
Ela incorpora as decisões da seção 10 e a resposta do Finance sobre baixas reais (desenho `lancamento_baixas`, aprovado no repo do Finance em 2026-09-23).
É um rascunho: a versão definitiva do contrato vai morar no Hub (registro de event types e pacote de contrato), e esta seção deixa de valer quando o ADR do Hub for aprovado.

### 11.1 Decisões consolidadas

- Escopo: orgs com `source_type = FOR_BUSINESS` no Finance e acesso vivo às duas Applications no Hub, sempre a mesma Organization do Hub nos dois apps.
- Provedores (Conta Azul, Omie etc.) ficam fora.
- Recorrência indefinida fica fora.
- Imposto fica fora da v1 (padrão da Q7, ainda não confirmado pelo dono).
- Comissões de afiliados ficam fora.
- Os dois apps continuam 100% usáveis sozinhos; toda regra desta seção vale só para linhas vinculadas numa org conectada.
- Liquidação é um fato imutável (baixa ou estorno), nunca um flag sobrescrito, nos dois apps.
- v1 só tem baixa integral: o valor da baixa é o valor em aberto inteiro.
- Data de pagamento é a data real, `YYYY-MM-DD` no dia de São Paulo, nunca no futuro, recusada na origem e no destino.
- Com mais de uma baixa ativa, a data exibida é a MAIOR (alinhado ao redutor do Finance, `reduzirLiquidacao`); isso substitui o "menor" da seção 5.6.
- Venda com baixa ativa em qualquer linha não pode sair de `won`; o usuário estorna antes, manualmente (Q5).
- Linha com baixa ativa não pode ter valor ou vencimento alterados, em nenhum dos dois apps; estorna antes (I3).
- Editar uma venda altera as linhas existentes, preservando ids; nunca apaga e recria (PC2).
- Linhas vindas do Sales só são editadas no Sales.
  No Finance elas não podem ser editadas nem excluídas, e não existe "Desvincular" por enquanto.
  O Finance mostra um link "Editar no Sales" que abre a proposta.
  Continuam permitidos no Finance: registrar e estornar baixas (sincronizado) e os campos que só existem no Finance (categoria, conta bancária, observações), que nunca vão ao Sales.
  Esta última permissão é uma interpretação e precisa ser confirmada pelo dono.
- Desconectar a org é a única forma de desvincular: as linhas ficam no Finance como lançamentos manuais comuns (a confirmar com o dono).
- Infra: produção em EC2 sempre ligada, staging no Coolify. Nenhum serviço novo (sem SQS, EventBridge, Redis). Nenhum payload financeiro no banco do Hub.

### 11.2 Topologia: Hub como plano de controle, apps como plano de dados

- O Hub guarda só metadados:
  - registro de event types com schema JSON imutável por versão;
  - Contratos (Application produtora, Application consumidora, event types);
  - Activations por Organization (quem ligou, quando, estado);
  - os endereços de cada Application por ambiente (API do feed e `app_url` do web, que já existe em `H:packages/hub-db/src/schema.ts:354`).
- Cada app produtor grava os eventos num outbox, na mesma transação do ato de negócio, e expõe um feed de leitura por cursor.
- Cada app consumidor puxa o feed do produtor diretamente, aplica numa transação com a tabela inbox (idempotência) e guarda o cursor.
- Sales e Finance são os dois produtor e consumidor.
- A autorização de cada leitura é decidida pelo Hub: o produtor nunca confia no consumidor sem o Hub confirmar que existe Contrato, Activation viva e `hasAccess` das duas Applications na org, no mesmo ambiente.
  Nenhum segredo é compartilhado entre os apps.
  Revogação efetiva em no máximo 60 s.
  O formato (ticket opaco com introspecção no Hub ou token curto assinado) é decisão do ADR do Hub.
- O Hub fora do ar pausa a sincronização; nenhum app para de funcionar e nada se perde (o outbox guarda).
- A rotina de pull roda dentro do processo da API e é segura com várias instâncias (lock por par produtor/org).

### 11.3 Feed

- `GET <api do produtor>/integration/v1/feed?organizationId=&after=<cursor>&limit=` devolve eventos em ordem crescente de posição.
- Armadilha obrigatória: uma sequência `bigserial` atribuída no INSERT não é ordem de commit, e um leitor pode pular um evento cuja transação commitou depois de uma posição maior.
  O feed precisa garantir que nenhuma posição apareça abaixo do cursor depois de lida (por exemplo, posição atribuída por um publicador único sob advisory lock depois do commit, ou contador por org travado na transação).
  O pacote de contrato deve trazer a implementação e o teste dessa garantia, não cada app reinventar.
- Retenção no produtor: eventos ficam no outbox até todos os consumidores ativos passarem deles, e no mínimo 30 dias.

### 11.4 Entidades e eventos (revisão da 5.2 e 5.4)

- `fxl-sales.obligation.upserted` v1 (Sales produz):
  - `obligationRef` = `fxl-sales:<id da linha>`, estável porque o PC2 preserva ids;
  - `direction` (`receivable|payable`), `kind`, `amountCents`, `currency: 'BRL'`, `dueDate`, `method?`;
  - `counterparty {displayName, role}`;
  - `source {saleId, saleCode, displayLabel, deepLinkPath}`, onde `deepLinkPath` é o caminho relativo da proposta no web do Sales; o Finance monta a URL com o `app_url` do Sales vindo do Hub;
  - `revision` monotônica por linha, `state` (`active|voided`), `voidReason?`.
- `fxl-sales.settlement.recorded` e `fxl-finance.settlement.recorded` v1: `settlementRef` (`<app>:<uuid>`), `obligationRef`, `amountCents`, `paidOn`, `recordedBy {app, displayName}`.
- `fxl-sales.settlement.reversed` e `fxl-finance.settlement.reversed` v1: `reversalRef`, `reversesSettlementRef`, `reversedOn`, `reason?`, `recordedBy`.
- `fxl-sales.ledger.checkpoint` v1: igual à seção 5.4.
- Mapeamento no Finance: baixa = linha de `lancamento_baixas` com `tipo = 'baixa'`; estorno = `tipo = 'estorno'` com `estorna_baixa_id`; `origem = 'sales'` marca fato remoto e nunca é republicado (anti-eco, I6); o ref remoto ganha coluna própria única por org na etapa de integração.
- Corrida residual: se o Finance registra uma baixa ao mesmo tempo em que o Sales anula a linha, a linha fica `disputed` e uma pessoa resolve (I7).
- Duas baixas integrais concorrentes (uma em cada app): as duas ficam registradas, a linha fica paga e é marcada "registrada em duplicidade" para alguém estornar uma delas.
