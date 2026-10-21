# Levantamento de entidades - FXL Vendas CRM unificado

Run: `20261021T011348Z-vendas-crm-unificado`. Slice: `04-levantamento-entidades` (fase 1a, somente leitura).
Base do levantamento: o código da branch de integração da run depois das slices 01, 02 e 03 (nenhum arquivo de produto foi alterado por este documento).
Este documento é a entrada obrigatória da fase 1b (modelo de dados) e só vale depois de um Verify `sonnet` separado conferir cada citação e cada classificação de risco.

## 1. Resumo de riscos

| # | Entidade | Tabelas principais | Risco | Decisão | Motivo em uma linha |
| --- | --- | --- | --- | --- | --- |
| 1 | Lead do CRM | `sales_ops_leads`, `sales_ops_lead_products` | médio | configurável (núcleo fixo) | Muitos leitores e locks por quadro, mas o modelo novo entra em tabelas novas e `sale_id` isola o ledger |
| 2 | Lead legado de indicação | `leads` | alto | fixo, não unificar | Risco alto por definição; único escritor é o webhook de conversão, com PII e INSERT público |
| 3 | Etapa | `sales_ops_lead_stages` | médio | configurável em tabela nova, tabela antiga intacta | O CHECK e o índice único da 0022 impedem várias saídas por org |
| 4 | Funil | (não existe tabela) | baixo | configurável (novo) | Hoje o funil é implícito: as etapas da org; tudo que se cria é aditivo |
| 5 | Cliente / Empresa | `sales_ops_clients` | médio | fixo, com campo de referência | FKs de leads e propostas, reconhecimento na importação e nome no evento do Finance |
| 6 | Contato | (colunas do lead, `sales_ops_clients.contact`) | baixo | fixo (nome e contato) mais campos configuráveis | Não existe tabela de contato; colunas planas lidas pela busca do quadro |
| 7 | Pessoa / Vendedor / Responsável | `sales_ops_people`, `sales_ops_funcoes`, `sales_ops_person_funcoes` | médio | fixo | Escopo de vendedor no servidor, vínculo com conta Hub e snapshots em propostas |
| 8 | Produto / Serviço | `sales_ops_products`, `sales_ops_areas`, `sales_ops_product_funcao_costs` | médio | fixo (referenciável) | Padrões comerciais alimentam propostas e comissões; no lead entra como referência |
| 9 | Proposta / Orçamento / Venda | `sales_ops_sales`, `sales_ops_sale_items`, `sales_ops_sale_professionals` | alto | fixo, não alterar | `status`, totais e `code` materializam o ledger e entram no evento do Finance |
| 10 | Recebível / A pagar / Liquidação | `sales_ops_receivables`, `sales_ops_payables`, `sales_ops_settlements` | alto | fixo, não alterar | Risco alto por definição; fatos imutáveis, gatilhos `FXS01` e `FXS02` e eventos consumidos pelo Finance |
| 11 | Comissão / Finder / Indicação / Click / Conversão | `finders`, `referral_links`, `clicks`, `conversions`, `commissions`, `payouts` | alto | fixo, não alterar | Dinheiro, webhook HMAC, redirect público e RLS cruzada; fora do escopo do CRM |
| 12 | Importação | (sem tabela; `apps/api/src/domains/import`) | médio | configurável (fase 4) | Uma definição única de planilha; depende de `kind` das etapas e de `createLead` e `moveLead` |
| 13 | Auditoria / histórico | `audit_log` | baixo | fixo, novas ações aditivas | Enum aditivo; o histórico de etapa do lead ainda não existe e entra em tabela nova |

Classificados `alto` por definição do pedido (fixos, não unificar, não alterar, pendência): linha 2 (unificar `leads` legado com `sales_ops_leads`) e linha 10 (`sales_ops_payables`, `sales_ops_receivables`, `sales_ops_settlements` e os eventos `fxl-sales.obligation.*` e `fxl-sales.settlement.*`).
Classificados `alto` por julgamento deste levantamento: linhas 9 e 11 (motivos em cada seção).

## 2. Legenda e método

- Risco `baixo`: a mudança prevista é somente aditiva, com poucos leitores e sem efeito em dinheiro.
- Risco `médio`: a mudança prevista é aditiva, mas há muitos leitores, regras de concorrência ou FKs que a fase 1b precisa respeitar.
- Risco `alto`: caminho conservador. Não unificar, não alterar, registrar como pendência na seção 4.
- Toda citação tem a forma `[identificador](caminho:linha)`: o arquivo existe e a linha citada contém o identificador.
- Citações de teste usam o título do primeiro caso do arquivo.
- Termos: "tabela antiga" é `sales_ops_lead_stages`; "modo full" é a edição `full`; "modo leads" é a edição `leads` (Construbom).

## 3. Entidades

### 3.1 Lead do CRM (`sales_ops_leads`)

#### Onde vive hoje
- A tabela `sales_ops_leads` nasceu na migração 0022: [CREATE TABLE "sales_ops_leads"](apps/api/drizzle/0022_sales_ops_leads.sql:49).
- Os produtos do lead são uma tabela filha: [CREATE TABLE "sales_ops_lead_products"](apps/api/drizzle/0022_sales_ops_leads.sql:69).
- A migração 0027 acrescentou telefone, e-mail e nascimento: [ADD COLUMN "contact_phone"](apps/api/drizzle/0027_lead_contact_fields.sql:18).
- A migração 0028 acrescentou a exclusão lógica: [ADD COLUMN "deleted_at"](apps/api/drizzle/0028_lead_soft_delete.sql:26).
- Um lead vive só em `sales_ops_leads` e nunca em `sales_ops_sales`; `sale_id` liga o lead convertido à proposta: ["sale_id" uuid](apps/api/drizzle/0022_sales_ops_leads.sql:63).

#### Schema Drizzle
- Tabela: [export const salesOpsLeads = pgTable(](apps/api/src/db/schema.ts:1000).
- Nome obrigatório do contato: [contactName: text('contact_name').notNull()](apps/api/src/db/schema.ts:1005).
- Telefone, e-mail e nascimento (nulos): [contactPhone: text('contact_phone')](apps/api/src/db/schema.ts:1013), [contactEmail: text('contact_email'),](apps/api/src/db/schema.ts:1014), [contactBirthDate: date('contact_birth_date'](apps/api/src/db/schema.ts:1015).
- Empresa por FK lógica e por snapshot: [clientId: uuid('client_id')](apps/api/src/db/schema.ts:1023) e [clientNameSnapshot: text('client_name_snapshot').notNull()](apps/api/src/db/schema.ts:1024).
- Valor estimado em centavos: [estimatedValueBrl: integer('estimated_value_brl')](apps/api/src/db/schema.ts:1030).
- Vendedor: [sellerPersonId: uuid('seller_person_id')](apps/api/src/db/schema.ts:1037).
- Etapa e posição: [stageId: uuid('stage_id').notNull()](apps/api/src/db/schema.ts:1039), [stageChangedAt: timestamp('stage_changed_at'](apps/api/src/db/schema.ts:1044), [position: integer('position').notNull().default(0)](apps/api/src/db/schema.ts:1045).
- Motivo de perda e proposta: [lostReason: text('lost_reason')](apps/api/src/db/schema.ts:1046), [saleId: uuid('sale_id'),](apps/api/src/db/schema.ts:1051).
- Exclusão lógica: [deletedAt: timestamp('deleted_at'](apps/api/src/db/schema.ts:1064).
- Índice composto alvo de FKs: [uniqueIndex('sales_ops_leads_org_id_id_idx')](apps/api/src/db/schema.ts:1070).
- Índice por coluna do quadro: [index('sales_ops_leads_org_stage_position_idx')](apps/api/src/db/schema.ts:1071).
- Índice único parcial uma proposta por lead: [uniqueIndex('sales_ops_leads_org_sale_idx')](apps/api/src/db/schema.ts:1074).
- CHECK de valor e de exclusão: [check('sales_ops_leads_estimated_value_check'](apps/api/src/db/schema.ts:1109), ['sales_ops_leads_deleted_pair_check'](apps/api/src/db/schema.ts:1114).
- Filha de produtos: [export const salesOpsLeadProducts = pgTable(](apps/api/src/db/schema.ts:1138).

#### API
- Roteador montado em `/leads`: [salesOpsRouter.route('/leads', leadsRouter)](apps/api/src/domains/sales-ops/routes.ts:328).
- Os gates de capability cobrem `summary`, `sales`, `settlements`, `products`, `clients`, `areas`, `funcoes`, `import` e `history`, e não `/leads` nem `/lead-stages`: [salesOpsRouter.use('/import/*', requireCapability('import'))](apps/api/src/domains/sales-ops/routes.ts:91).
- Rotas: [leadsRouter.get('/', async](apps/api/src/domains/sales-ops/leads/lead-routes.ts:138), [leadsRouter.post('/', async](apps/api/src/domains/sales-ops/leads/lead-routes.ts:153), [leadsRouter.get('/deleted', requireAdmin](apps/api/src/domains/sales-ops/leads/lead-routes.ts:178), [leadsRouter.get('/summary', async](apps/api/src/domains/sales-ops/leads/lead-routes.ts:194), [leadsRouter.get('/:id', async](apps/api/src/domains/sales-ops/leads/lead-routes.ts:204), [leadsRouter.patch('/:id', async](apps/api/src/domains/sales-ops/leads/lead-routes.ts:212), [leadsRouter.post('/:id/move', async](apps/api/src/domains/sales-ops/leads/lead-routes.ts:241), [leadsRouter.post('/:id/delete', async](apps/api/src/domains/sales-ops/leads/lead-routes.ts:260), [leadsRouter.post('/:id/restore', async](apps/api/src/domains/sales-ops/leads/lead-routes.ts:270).
- Dois contratos de escrita escolhidos pela edição: [leadFieldSet(c.get('salesEdition') ?? 'full') === 'contact'](apps/api/src/domains/sales-ops/leads/lead-routes.ts:98).
- Schemas: [export const CreateLeadSchema](apps/api/src/domains/sales-ops/leads/lead-schemas.ts:80), [export const MoveLeadSchema](apps/api/src/domains/sales-ops/leads/lead-schemas.ts:88), [export const ContactLeadFieldsSchema](apps/api/src/domains/sales-ops/leads/lead-schemas.ts:209).
- Serviço (concorrência e escopo): [export async function lockLeadBoard](apps/api/src/domains/sales-ops/leads/lead-service.ts:1008), [function leadSellerCondition](apps/api/src/domains/sales-ops/leads/lead-service.ts:802), [export async function resolveCallerPersonId](apps/api/src/domains/sales-ops/leads/lead-service.ts:140), [export async function provisionLeadsSellerPerson](apps/api/src/domains/sales-ops/leads/lead-service.ts:321), [export function liveLeadCondition](apps/api/src/domains/sales-ops/leads/lead-service.ts:522).
- Escritas: [export function createLead(](apps/api/src/domains/sales-ops/leads/lead-service.ts:909), [export function createContactLead(](apps/api/src/domains/sales-ops/leads/lead-service.ts:940), [export function updateLead(](apps/api/src/domains/sales-ops/leads/lead-service.ts:1140), [export function updateContactLead(](apps/api/src/domains/sales-ops/leads/lead-service.ts:1151), [export async function moveLead(](apps/api/src/domains/sales-ops/leads/lead-service.ts:1261).
- Leituras: [export async function listLeads(](apps/api/src/domains/sales-ops/leads/lead-service.ts:650), [export async function summarizeLeadStages(](apps/api/src/domains/sales-ops/leads/lead-service.ts:732), [export async function getLead(](apps/api/src/domains/sales-ops/leads/lead-service.ts:773).
- A conversão exige `saleId` ao entrar na etapa `conversion`, e o motivo ao entrar em `lost`: [if (destination.kind === 'conversion')](apps/api/src/domains/sales-ops/leads/lead-service.ts:1309), [LeadInputError('sale_required_for_conversion')](apps/api/src/domains/sales-ops/leads/lead-service.ts:1310), [LeadInputError('lost_reason_required')](apps/api/src/domains/sales-ops/leads/lead-service.ts:1306).
- Lixeira: [export function deleteLead(](apps/api/src/domains/sales-ops/leads/lead-trash-service.ts:77) e [export function restoreLead(](apps/api/src/domains/sales-ops/leads/lead-trash-service.ts:148).
- Seeds de desenvolvimento escrevem leads: [salesOpsLeads: readonly LeadRow](apps/api/scripts/seed/plan.ts:545).

#### Web
- Quadro, lista e funil: [export function LeadsBoard(](apps/web/src/sales-ops/leads/LeadsBoard.tsx:290), [export function LeadsFunnelView(](apps/web/src/sales-ops/leads/LeadsFunnelView.tsx:55), [export function LeadCard(](apps/web/src/sales-ops/leads/LeadCard.tsx:161).
- Formulários (dois, um por edição): [export function LeadDialog(](apps/web/src/sales-ops/leads/LeadDialog.tsx:82) e [export function ContactLeadDialog(](apps/web/src/sales-ops/leads/ContactLeadDialog.tsx:97).
- Mover e excluir: [export function MoveLeadDialog(](apps/web/src/sales-ops/leads/MoveLeadDialog.tsx:64), [export function LeadDeleteDialog](apps/web/src/sales-ops/leads/LeadDeleteDialog.tsx:40).
- Containers e dados: [export function LeadsBoardContainer(](apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx:128), [export function useLeadsBoard(](apps/web/src/sales-ops/leads/hooks.ts:99), [export const leadsApi](apps/web/src/sales-ops/leads/api.ts:146).
- Tipos: [export type SalesOpsLead =](apps/web/src/sales-ops/leads/types.ts:62).
- Montagem no shell: [<LeadsBoardContainer](apps/web/src/sales-ops/SalesOpsApp.tsx:2377).
- Conversão em proposta pelo wizard (cerca de escrita): [BOARD-WRITE-FENCE:START conversion-handlers](apps/web/src/sales-ops/SalesOpsApp.tsx:1548).
- Rota do quadro: `operacional/leads` e `meus-dados/leads`; a etapa ativa viaja na URL como terceiro segmento: [export function buildLeadStagePath](apps/web/src/sales-ops/navigation.ts:268).

#### Eventos e outbox
- Nenhum evento de integração é emitido por lead. Os construtores de evento só conhecem obrigação e baixa: [export function buildObligationUpsertedEvents](apps/api/src/domains/integration/events.ts:202), [export function buildSettlementRecordedEvent](apps/api/src/domains/integration/events.ts:225).
- A movimentação de etapa não grava em `audit_log`; só a exclusão e a restauração gravam `lead.deleted` e `lead.restored`: [action: 'lead.deleted'](apps/api/src/domains/sales-ops/leads/lead-trash-service.ts:127), ['lead.restored',](apps/api/src/domains/audit/service.ts:51).
- O oráculo de que lead não toca o ledger: `leads-no-financial-impact.test.ts` - [leads move no existing financial number](apps/api/test/rls/leads-no-financial-impact.test.ts:43).

#### RLS
- Duas políticas, FORCE, em `sales_ops_leads`: [ALTER TABLE sales_ops_leads FORCE ROW LEVEL SECURITY](apps/api/drizzle/0022_sales_ops_leads.sql:107), [CREATE POLICY sales_ops_leads_tenant_isolation](apps/api/drizzle/0022_sales_ops_leads.sql:108), [CREATE POLICY sales_ops_leads_admin_context](apps/api/drizzle/0022_sales_ops_leads.sql:112).
- Idem para a filha: [CREATE POLICY sales_ops_lead_products_tenant_isolation](apps/api/drizzle/0022_sales_ops_leads.sql:118).
- Todas as FKs são compostas com `org_id` à frente: [sales_ops_leads_org_stage_fk](apps/api/drizzle/0022_sales_ops_leads.sql:90), [sales_ops_leads_org_client_fk](apps/api/drizzle/0022_sales_ops_leads.sql:91), [sales_ops_leads_org_seller_fk](apps/api/drizzle/0022_sales_ops_leads.sql:92), [sales_ops_leads_org_sale_fk](apps/api/drizzle/0022_sales_ops_leads.sql:93).

#### Testes
- `leads-rls.test.ts` - [sales operations leads persistence and RLS](apps/api/test/rls/leads-rls.test.ts:38)
- `leads-schema-migration.test.ts` - [leads schema migration 0022](apps/api/test/rls/leads-schema-migration.test.ts:39)
- `lead-contact-fields-migration.test.ts` - [lead contact fields migration 0027](apps/api/test/rls/lead-contact-fields-migration.test.ts:34)
- `lead-soft-delete-migration.test.ts` - [lead soft delete migration 0028](apps/api/test/rls/lead-soft-delete-migration.test.ts:23)
- `leads-lixeira.test.ts` - [sales operations leads: the lixeira](apps/api/test/rls/leads-lixeira.test.ts:136)
- `leads-move-concurrency.test.ts` - [sales operations leads: concurrent board writes never deadlock and keep columns dense](apps/api/test/rls/leads-move-concurrency.test.ts:69)
- `leads-seller-scope.test.ts` - [sales operations leads: seller scope, movement and isolation](apps/api/test/rls/leads-seller-scope.test.ts:61)
- `leads-unassigned-claim.test.ts` - [sales operations leads: the unassigned pool and claim-on-write](apps/api/test/rls/leads-unassigned-claim.test.ts:49)
- `leads-stage-summary.test.ts` - [sales operations leads: per-stage summary](apps/api/test/rls/leads-stage-summary.test.ts:43)
- `leads-edition.test.ts` - [sales operations leads edition: contact leads, vendedor-only pessoas, no system etapa](apps/api/test/rls/leads-edition.test.ts:89)
- `leads-api-contract.test.ts` - [leadsApi](apps/web/src/sales-ops/leads/__tests__/leads-api-contract.test.ts:32)
- `lead-dialog.test.tsx` - [LeadDialog](apps/web/src/sales-ops/leads/__tests__/lead-dialog.test.tsx:156)
- `contact-lead-dialog.test.tsx` - [ContactLeadDialog](apps/web/src/sales-ops/leads/__tests__/contact-lead-dialog.test.tsx:172)
- `lead-conversion.test.tsx` - [a lead becomes a proposta, and the card moves only afterwards](apps/web/src/sales-ops/leads/__tests__/lead-conversion.test.tsx:479)
- `board-write-surface.test.ts` - [the board write surface](apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts:208)

#### O que quebra se virar campo dinâmico
- Mover `stage_id`, `position`, `stage_changed_at`, `sale_id`, `seller_person_id` ou `deleted_*` para JSON ou EAV perde FK composta, índice de quadro, índice único parcial e CHECK: [name: 'sales_ops_leads_org_stage_fk'](apps/api/src/db/schema.ts:1087) e [uniqueIndex('sales_ops_leads_org_sale_idx')](apps/api/src/db/schema.ts:1074).
- O cursor de paginação é o par `(position, id)` validado por regex: [const CURSOR_RE](apps/api/src/domains/sales-ops/leads/lead-schemas.ts:103); um campo dinâmico não ordena por esse par.
- O resumo por etapa agrupa e soma no SQL: [.groupBy(salesOpsLeads.stageId)](apps/api/src/domains/sales-ops/leads/lead-service.ts:750). `estimated_value_brl` precisa continuar numérico e indexável.
- O escopo do vendedor é um predicado SQL único: [function leadSellerCondition](apps/api/src/domains/sales-ops/leads/lead-service.ts:802). Tornar o vendedor dinâmico exigiria reescrever leitura e claim.
- A busca do quadro lê nome, telefone e e-mail de colunas planas: [export](apps/web/src/sales-ops/leads/board-search.ts:9).
- A empresa mantém `client_name_snapshot NOT NULL`; tornar Cliente dinâmico exige manter a coluna como campo padrão não removível.
- Os produtos do lead já são filha (`sales_ops_lead_products`), o precedente natural de campo de referência Produto: [export const salesOpsLeadProducts = pgTable(](apps/api/src/db/schema.ts:1138).

#### Recomendação
- Núcleo fixo (colunas atuais): `id`, `org_id`, `contact_name`, `stage_id`, `position`, `stage_changed_at`, `seller_person_id`, `sale_id`, `lost_reason`, `deleted_*`, `created_at`, `updated_at`.
- Contato (telefone e e-mail) permanece como coluna porque o pedido exige "nome e contato" e a busca do quadro as lê.
- Configurável (campos dinâmicos tipados): descrição, nascimento, valor estimado, produtos, empresa como campo de referência padrão não removível, e quaisquer campos novos da org.
- A fase 1b cria o lead unificado em tabelas novas e mantém `sales_ops_leads` intacta; a fase 1c só copia.

#### Risco
- **médio**: muitos leitores (seção 5.3), locks por quadro (`lockLeadBoard`) e escopo de vendedor no servidor, mas a mudança é aditiva e o vínculo com o ledger passa só por `sale_id`.

### 3.2 Lead legado de indicação (`leads`)

#### Onde vive hoje
- Tabela `leads` do produto de afiliados, criada na migração inicial: [ALTER TABLE leads ENABLE ROW LEVEL SECURITY](apps/api/drizzle/0000_fancy_klaw.sql:158).
- É uma tabela diferente de `sales_ops_leads`: guarda o cliente final que veio de um clique de finder e converteu, com PII (nome, e-mail, telefone, CPF).
- O único escritor em todo o código é a ingestão de conversão: [await tx.insert(leads).values({](apps/api/src/domains/conversions/service.ts:254).
- Nenhum arquivo de API ou web lê a tabela `leads`; só `conversions` guarda o hash do e-mail (ver `hashCustomerEmail`): [export function hashCustomerEmail](apps/api/src/domains/conversions/service.ts:101).

#### Schema Drizzle
- Tabela: [export const leads = pgTable(](apps/api/src/db/schema.ts:233).
- Colunas de PII: [customerCpf: text('customer_cpf')](apps/api/src/db/schema.ts:243), [customerEmail: text('customer_email')](apps/api/src/db/schema.ts:241), [customerPhone: text('customer_phone')](apps/api/src/db/schema.ts:242).
- Status livre de produto de afiliado: [status: text('status').notNull(), // 'clicked'](apps/api/src/db/schema.ts:244).
- Soft FKs para clique e link: [clickId: text('click_id'), // soft FK](apps/api/src/db/schema.ts:238), [linkId: uuid('link_id'), // soft FK](apps/api/src/db/schema.ts:239).
- Anonimização: [anonymizedAt: timestamp('anonymized_at'](apps/api/src/db/schema.ts:245).
- Índice: [index('leads_org_id_idx')](apps/api/src/db/schema.ts:251).

#### API
- Escritor único: [export async function ingestConversion(](apps/api/src/domains/conversions/service.ts:115).
- Montado em `/api/v1/conversions` atrás de HMAC: [app.route('/api/v1/conversions', conversionsRouter)](apps/api/src/server.ts:102).
- O webhook valida o corpo com PII: [export const WebhookBodySchema](apps/api/src/domains/conversions/service.ts:43).
- Não existe rota de listagem nem de edição de `leads`.

#### Web
- Nenhuma tela lê `leads` diretamente. As telas de conversão do admin leem `conversions`: [export](apps/web/src/admin/conversions/ConversionsPage.tsx:21).

#### Eventos e outbox
- A ingestão grava `audit_log` com `conversion.recorded`: [entityType: 'conversion'](apps/api/src/domains/conversions/service.ts:291).
- Não emite eventos de integração com o Finance.

#### RLS
- FORCE e três políticas, entre elas a de INSERT público do webhook: [CREATE POLICY leads_tenant_isolation ON leads](apps/api/drizzle/0008_single_role_rls_context.sql:32), [CREATE POLICY leads_admin_context ON leads](apps/api/drizzle/0008_single_role_rls_context.sql:37), [CREATE POLICY leads_insert_webhook ON leads](apps/api/drizzle/0008_single_role_rls_context.sql:42).
- O INSERT do webhook é `WITH CHECK (true)` (cross-tenant por desenho); qualquer unificação teria que preservar essa política.

#### Testes
- `conversion-ingest.test.ts` - [conversion ingest + commission + audit (Phase 05)](apps/api/test/rls/conversion-ingest.test.ts:32)
- `conversion-webhook-contract.test.ts` - [conversion webhook contract (Phase 06 T13, D-M/D-N/D-O)](apps/api/test/rls/conversion-webhook-contract.test.ts:44)
- `conversions-commissions-rls.test.ts` - [conversions/commissions split-RLS (D10/D-G)](apps/api/test/rls/conversions-commissions-rls.test.ts:20)
- `cross-tenant.test.ts` - [RLS: cross-tenant isolation](apps/api/test/rls/cross-tenant.test.ts:25)
- `service.test.ts` - [resolveAttribution (last-touch within window)](apps/api/src/domains/conversions/__tests__/service.test.ts:23)

#### O que quebra se virar campo dinâmico
- Unificar `leads` com `sales_ops_leads` mistura PII de LGPD (CPF, anonimização) com o CRM de vendas e troca a política de INSERT público por tenant-only: quebra o webhook de conversão.
- `sales_ops_leads.stage_id` é NOT NULL com FK para etapa; um lead de indicação não tem etapa nem vendedor: [stageId: uuid('stage_id').notNull()](apps/api/src/db/schema.ts:1039).
- O status `clicked | lead | converted | churned` não mapeia para `kind` de etapa (`normal | conversion | lost`).
- `sales_ops_leads` exige `contact_name NOT NULL`, enquanto `leads.customer_name` é nulável: [customerName: text('customer_name')](apps/api/src/db/schema.ts:240).
- Não há leitor de `leads`, logo não há ganho de unificar agora e o custo de migração é todo risco.

#### Recomendação
- Fixo. Não unificar. Não alterar a tabela, as políticas nem `ingestConversion`.
- Se um dia o CRM precisar ver indicações, ler `conversions` e `clicks` por uma visão nova, nunca copiando PII.

#### Risco
- **alto** por definição do pedido (unificar `leads` com `sales_ops_leads`). Caminho conservador: pendência registrada na seção 4.

### 3.3 Etapa (`sales_ops_lead_stages`)

#### Onde vive hoje
- Tabela criada na 0022: [CREATE TABLE "sales_ops_lead_stages"](apps/api/drizzle/0022_sales_ops_leads.sql:34).
- Semente das 4 etapas padrão, sem tabela de funil: [export const LEAD_STAGE_SEEDS](apps/api/src/domains/sales-ops/leads/stages-seed.ts:22).
- Não existe versão por funil: as etapas são por organização (`org_id`).

#### Schema Drizzle
- Tabela: [export const salesOpsLeadStages = pgTable(](apps/api/src/db/schema.ts:927).
- Colunas: [kind: text('kind').notNull().default('normal')](apps/api/src/db/schema.ts:945), [isSystem: boolean('is_system')](apps/api/src/db/schema.ts:952), [position: integer('position').notNull().default(0)](apps/api/src/db/schema.ts:959).
- Restrições da 0022 (detalhe na seção 5.1): [uniqueIndex('sales_ops_lead_stages_org_kind_idx')](apps/api/src/db/schema.ts:982), [check('sales_ops_lead_stages_kind_check'](apps/api/src/db/schema.ts:985), [check('sales_ops_lead_stages_system_kind_check'](apps/api/src/db/schema.ts:986), [uniqueIndex('sales_ops_lead_stages_org_name_idx')](apps/api/src/db/schema.ts:976).

#### API
- Rotas: [leadStagesRouter.get('/lead-stages', async](apps/api/src/domains/sales-ops/leads/stage-routes.ts:33), [leadStagesRouter.post('/lead-stages', requireAdmin](apps/api/src/domains/sales-ops/leads/stage-routes.ts:52), [leadStagesRouter.patch('/lead-stages/:id', requireAdmin](apps/api/src/domains/sales-ops/leads/stage-routes.ts:62), [leadStagesRouter.post('/lead-stages/reorder', requireAdmin](apps/api/src/domains/sales-ops/leads/stage-routes.ts:40).
- Montagem: [salesOpsRouter.route('/', leadStagesRouter)](apps/api/src/domains/sales-ops/routes.ts:322).
- Serviço: [export function listLeadStages(](apps/api/src/domains/sales-ops/leads/stage-service.ts:83), [export function createLeadStage(](apps/api/src/domains/sales-ops/leads/stage-service.ts:87), [export function updateLeadStage(](apps/api/src/domains/sales-ops/leads/stage-service.ts:127), [export function reorderLeadStages(](apps/api/src/domains/sales-ops/leads/stage-service.ts:217).
- Criação sempre `normal` e não-sistema: [isSystem: false, kind: 'normal'](apps/api/src/domains/sales-ops/leads/stage-service.ts:112).
- Etapas de sistema não podem ser renomeadas nem arquivadas: [if (current.isSystem](apps/api/src/domains/sales-ops/leads/stage-service.ts:144).
- Semente idempotente: [export async function ensureLeadStages(](apps/api/src/domains/sales-ops/leads/stages-seed.ts:62) e [export async function ensureLeadStagesForOrg(](apps/api/src/domains/sales-ops/leads/stages-seed.ts:92).
- Chamadores de `ensureLeadStages` e `ensureLeadStagesForOrg` fora da definição: [ensureLeadStages(](apps/api/src/domains/import/routes.ts:52), [ensureLeadStages(](apps/api/src/domains/sales-ops/leads/stage-service.ts:84), [ensureLeadStages(](apps/api/src/domains/sales-ops/leads/stages-seed.ts:93), [ensureLeadStagesForOrg(](apps/api/src/domains/sales-ops/routes.ts:97).
- Schemas de entrada que não aceitam `kind`, `position`, `isSystem`: [export const LeadStageSchema](apps/api/src/domains/sales-ops/leads/schemas.ts:17).

#### Web
- Tela Cadastros > Etapas: [isSystem](apps/web/src/sales-ops/leads/LeadStagesView.tsx:286) e container [export function LeadStagesContainer](apps/web/src/sales-ops/leads/LeadStagesContainer.tsx:28).
- Cores por `kind` por lookup de objeto: [const KIND_COLORS](apps/web/src/sales-ops/leads/board-ui.ts:251), [export function stageIsNormal](apps/web/src/sales-ops/leads/board-ui.ts:274).
- Conversão e perda por `kind`: [export function conversionStage](apps/web/src/sales-ops/leads/calculations.ts:62), [export function lostStage](apps/web/src/sales-ops/leads/calculations.ts:69), [export function stageRequiresReason](apps/web/src/sales-ops/leads/calculations.ts:80), [export function stageOpensConversion](apps/web/src/sales-ops/leads/board-move.ts:40).
- Tipos: [export type LeadStageKind](apps/web/src/sales-ops/leads/types.ts:25).

#### Eventos e outbox
- Nenhum evento de integração. Movimentos de etapa não escrevem em `audit_log`.

#### RLS
- [CREATE POLICY sales_ops_lead_stages_tenant_isolation](apps/api/drizzle/0022_sales_ops_leads.sql:98), [CREATE POLICY sales_ops_lead_stages_admin_context](apps/api/drizzle/0022_sales_ops_leads.sql:102), [ALTER TABLE sales_ops_lead_stages FORCE ROW LEVEL SECURITY](apps/api/drizzle/0022_sales_ops_leads.sql:97).

#### Testes
- `lead-stages-rls.test.ts` - [sales operations lead stages persistence and RLS](apps/api/test/rls/lead-stages-rls.test.ts:27)
- `lead-stages-contract.test.ts` - [sales operations lead stage contract](apps/api/src/domains/sales-ops/__tests__/lead-stages-contract.test.ts:11)
- `lead-stages-routes.test.ts` - [Sales Ops lead stage routes](apps/api/src/domains/sales-ops/__tests__/lead-stages-routes.test.ts:79)
- `leads-schema-migration.test.ts` - [leads schema migration 0022](apps/api/test/rls/leads-schema-migration.test.ts:39)
- `lead-stages-view.test.tsx` - [etapas cadastro](apps/web/src/sales-ops/leads/__tests__/lead-stages-view.test.tsx:222)
- `board-ui.test.ts` - [stageColors](apps/web/src/sales-ops/leads/__tests__/board-ui.test.ts:7)
- `board-move.test.ts` - [moveTargetsFor](apps/web/src/sales-ops/leads/__tests__/board-move.test.ts:93)

#### O que quebra se virar campo dinâmico
- Tornar `kind` dinâmico remove o CHECK e o índice único parcial, e a regra "uma conversão e uma perda por org" deixa de existir no banco.
- Os leitores de `kind` (seção 5.2) assumem exatamente três valores: importação, quadro, funil, cores, movimentação.
- `is_system` é amarrado a `kind <> 'normal'` pelo CHECK: [check('sales_ops_lead_stages_system_kind_check'](apps/api/src/db/schema.ts:986).
- Vários funis por org exigem repetir nomes de etapa; o índice único `(org_id, name)` da tabela antiga proíbe: [uniqueIndex('sales_ops_lead_stages_org_name_idx')](apps/api/src/db/schema.ts:976).

#### Recomendação
- Configurável, mas em tabela nova de etapas por funil com `type`, `behavior` e `exit_kind`; a tabela antiga fica intacta e é a fonte de compatibilidade até a fase 2.
- `kind` antigo mapeia por backfill: `conversion` para etapa de tipo orçamento, `lost` para saída perdida, `normal` para normal.

#### Risco
- **médio**: muitos leitores de `kind` e de `stage_id`, mas a solução aditiva é clara (tabela nova) e não toca dinheiro.

### 3.4 Funil

#### Onde vive hoje
- Não existe entidade nem tabela de funil. O "funil" é o conjunto de `sales_ops_lead_stages` da organização, ordenado por `position`: [.orderBy(asc(salesOpsLeadStages.position), asc(salesOpsLeadStages.name))](apps/api/src/domains/sales-ops/leads/stage-service.ts:247).
- A visão de funil (gráfico) existe só no web e agrega por etapa: [export function buildLeadFunnel](apps/web/src/sales-ops/leads/calculations.ts:258), [export function buildCumulativeFunnel](apps/web/src/sales-ops/leads/calculations.ts:317).

#### Schema Drizzle
- Nenhuma tabela própria. O que existe é [export const salesOpsLeadStages = pgTable(](apps/api/src/db/schema.ts:927) sem coluna de funil.
- Constante única do funil CRM padrão (slice 03): [export const DEFAULT_PIPELINE_STAGES](packages/shared-utils/src/default-pipeline.ts:29); a mesma constante é comparada com a migração pelo teste `default-pipeline-parity.test.ts` - [default pipeline parity with the legacy lead stage seed](apps/api/src/domains/sales-ops/leads/__tests__/default-pipeline-parity.test.ts:73).

#### API
- Resumo por etapa: [leadsRouter.get('/summary', async](apps/api/src/domains/sales-ops/leads/lead-routes.ts:194) e [export async function summarizeLeadStages(](apps/api/src/domains/sales-ops/leads/lead-service.ts:732).
- Listagem por etapa (um pedido por coluna): [conditions.push(eq(salesOpsLeads.stageId, query.stageId))](apps/api/src/domains/sales-ops/leads/lead-service.ts:663).
- Não há API de funis, transições nem tipos de etapa.

#### Web
- Seletor de visão `Quadro | Lista | Funil`: [export function LeadsBoard(](apps/web/src/sales-ops/leads/LeadsBoard.tsx:290) e [export function LeadsFunnelView(](apps/web/src/sales-ops/leads/LeadsFunnelView.tsx:55).
- Rota do funil: [export function buildLeadFunnelPath](apps/web/src/sales-ops/navigation.ts:272).
- Agregados vindos do resumo: [export function useLeadStageSummary(](apps/web/src/sales-ops/leads/hooks.ts:170).

#### Eventos e outbox
- Nenhum.

#### RLS
- Sem tabela, sem política. As novas tabelas da fase 1b usam o molde da 0022: [CREATE POLICY sales_ops_lead_stages_tenant_isolation](apps/api/drizzle/0022_sales_ops_leads.sql:98).

#### Testes
- `lead-funnel.test.tsx` - [buildLeadFunnel](apps/web/src/sales-ops/leads/__tests__/lead-funnel.test.tsx:92)
- `leads-calculations.test.ts` - [leads calculations](apps/web/src/sales-ops/leads/__tests__/leads-calculations.test.ts:55)
- `leads-stage-summary.test.ts` - [sales operations leads: per-stage summary](apps/api/test/rls/leads-stage-summary.test.ts:43)
- `lead-board-totals.test.tsx` - [per-stage aggregates (pure)](apps/web/src/sales-ops/leads/__tests__/lead-board-totals.test.tsx:216)

#### O que quebra se virar campo dinâmico
- Não se aplica a campo; o que quebra é a suposição de funil único: URL por etapa, resumo por etapa e cores por `kind` leem a lista única de etapas da org (seção 5.2 e 5.3).
- A rota usa o terceiro segmento para o id da etapa: [const stageId = view === 'leads' && params.saleId ? params.saleId : undefined](apps/web/src/sales-ops/navigation.ts:353).

#### Recomendação
- Configurável: tabela de funis (pipelines) por org, etapas pertencentes a um funil, transições explícitas, funil padrão semeado de forma idempotente.

#### Risco
- **baixo**: entidade nova e puramente aditiva; os riscos estão nas etapas e no lead.

### 3.5 Cliente / Empresa (`sales_ops_clients`)

#### Onde vive hoje
- Criada na migração 0007 junto com a RLS: [ALTER TABLE sales_ops_clients FORCE ROW LEVEL SECURITY](apps/api/drizzle/0007_marvelous_valeria_richards.sql:165).
- A 0022 acrescentou o índice único `(org_id, id)` que serve de alvo das FKs compostas do lead: [sales_ops_clients_org_id_id_idx](apps/api/drizzle/0022_sales_ops_leads.sql:78).
- Um cliente não tem `status`, portanto não pode ser arquivado nem excluído por rota (o roteador não tem verbo DELETE).

#### Schema Drizzle
- Tabela: [export const salesOpsClients = pgTable(](apps/api/src/db/schema.ts:747).
- Campos fixos: [legalName: text('legal_name')](apps/api/src/db/schema.ts:754), [document: text('document')](apps/api/src/db/schema.ts:755), [legalRepName: text('legal_rep_name')](apps/api/src/db/schema.ts:757), [contact: text('contact')](apps/api/src/db/schema.ts:753).
- Alvo de FK: [uniqueIndex('sales_ops_clients_org_id_id_idx')](apps/api/src/db/schema.ts:765).
- Referências de entrada: a proposta guarda a FK e o snapshot: [clientId: uuid('client_id').references(() => salesOpsClients.id)](apps/api/src/db/schema.ts:803), [clientNameSnapshot: text('client_name_snapshot').notNull(),](apps/api/src/db/schema.ts:804).
- O lead guarda FK composta e snapshot (seção 3.1).

#### API
- Rotas, sob `requireCapability('clients')`: [salesOpsRouter.use('/clients/*', requireCapability('clients'))](apps/api/src/domains/sales-ops/routes.ts:88), [salesOpsRouter.get('/clients', async](apps/api/src/domains/sales-ops/routes.ts:214), [salesOpsRouter.post('/clients', async](apps/api/src/domains/sales-ops/routes.ts:219), [salesOpsRouter.patch('/clients/:id', async](apps/api/src/domains/sales-ops/routes.ts:228).
- Serviço: [export async function listClients(](apps/api/src/domains/sales-ops/service.ts:2286), [export async function createClient(](apps/api/src/domains/sales-ops/service.ts:2301), [export async function updateClient(](apps/api/src/domains/sales-ops/service.ts:2320); contrato [export const ClientSchema](apps/api/src/domains/sales-ops/service.ts:355).
- Criar cliente não exige admin: o vendedor cria por nome no modo leads.
- Reconhecimento de cliente existente na importação: [export function recognizeClientRows](apps/api/src/domains/import/client-recognition.ts:26).
- O bootstrap carrega a lista de clientes: [export async function getSalesOpsSnapshot(](apps/api/src/domains/sales-ops/service.ts:3147).

#### Web
- Lista e diálogo: [function ClientsView(](apps/web/src/sales-ops/SalesOpsApp.tsx:3820), [export function ClientDialog(](apps/web/src/sales-ops/SalesOpsApp.tsx:5854).
- Criação inline pelo nome (modo leads): [async function createClientByName(](apps/web/src/sales-ops/SalesOpsApp.tsx:1474) e o texto do picker: [export function clientPickerCopy](apps/web/src/sales-ops/leads/client-picker-copy.ts:18).

#### Eventos e outbox
- O nome do cliente viaja no evento de obrigação como contraparte do recebível: [clientName: sale.clientNameSnapshot](apps/api/src/domains/sales-ops/service.ts:2564) e [displayName: source.clientName](apps/api/src/domains/integration/events.ts:162).
- O Finance, portanto, recebe o NOME do cliente como texto, nunca o id do cliente; renomear o campo ou torná-lo dinâmico não muda o contrato desde que o snapshot continue sendo gravado na proposta.

#### RLS
- [CREATE POLICY sales_ops_clients_tenant_isolation ON sales_ops_clients](apps/api/drizzle/0008_single_role_rls_context.sql:117), [CREATE POLICY sales_ops_clients_admin_context ON sales_ops_clients](apps/api/drizzle/0008_single_role_rls_context.sql:122).

#### Testes
- `client-legal-fields.test.ts` - [sales operations client legal fields persistence](apps/api/test/rls/client-legal-fields.test.ts:11)
- `client-recognition.test.ts` - [documentDigits](apps/api/src/domains/import/__tests__/client-recognition.test.ts:37)
- `client-dialog-legal-fields.test.tsx` - [client dialog legal fields](apps/web/src/sales-ops/__tests__/client-dialog-legal-fields.test.tsx:103)
- `client-picker-copy.test.ts` - [client picker copy](apps/web/src/sales-ops/leads/__tests__/client-picker-copy.test.ts:9)
- `cross-tenant.test.ts` - [RLS: cross-tenant isolation](apps/api/test/rls/cross-tenant.test.ts:25)

#### O que quebra se virar campo dinâmico
- Tornar o cliente um valor solto no lead remove a FK composta `sales_ops_leads_org_client_fk` e a rastreabilidade para a proposta: [name: 'sales_ops_leads_org_client_fk'](apps/api/src/db/schema.ts:1092).
- A importação reconhece cliente por dígitos do documento e nome (`recognizeClientRows`); dados soltos em JSON não são recuperáveis por essa regra.
- A proposta exige `client_name_snapshot NOT NULL`, lido pelo evento do Finance e pelas listas.
- Campos legais do cliente (razão social, documento, representante) entram em contrato e exibição de proposta; devem continuar colunas.

#### Recomendação
- Fixo (tabela e colunas atuais). No lead, Cliente vira o campo de referência padrão não removível que aponta para `sales_ops_clients`.
- Campos extras do cliente (segmento, origem, etc.) podem ser configuráveis em tabela de valores nova, sem tocar as colunas atuais.

#### Risco
- **médio**: FKs de lead e de proposta, regra de reconhecimento da importação e nome no evento do Finance; a mudança prevista não altera a tabela.

### 3.6 Contato

#### Onde vive hoje
- Não existe tabela de contato. Hoje o contato é: (a) colunas do lead `contact_name`, `contact_phone`, `contact_email`, `contact_birth_date` (migrações 0022 e 0027); (b) o texto livre `contact` do cliente.
- Fonte: [ADD COLUMN "contact_email"](apps/api/drizzle/0027_lead_contact_fields.sql:19) e ["contact_name" text NOT NULL](apps/api/drizzle/0022_sales_ops_leads.sql:52).

#### Schema Drizzle
- Colunas do lead: [contactName: text('contact_name').notNull()](apps/api/src/db/schema.ts:1005), [contactPhone: text('contact_phone')](apps/api/src/db/schema.ts:1013), [contactEmail: text('contact_email'),](apps/api/src/db/schema.ts:1014), [contactBirthDate: date('contact_birth_date'](apps/api/src/db/schema.ts:1015).
- Campo do cliente: [contact: text('contact')](apps/api/src/db/schema.ts:753).
- Pessoas (equipe) têm e-mail próprio: [contactEmail: text('contact_email'),](apps/api/src/db/schema.ts:458); essa tabela é a equipe interna e NÃO é o contato do lead.

#### API
- Validação de telefone, e-mail e nascimento: [const ContactEmailSchema](apps/api/src/domains/sales-ops/leads/lead-schemas.ts:180), [const ContactBirthDateSchema](apps/api/src/domains/sales-ops/leads/lead-schemas.ts:197), [export const ContactLeadFieldsSchema](apps/api/src/domains/sales-ops/leads/lead-schemas.ts:209).
- Escritas do contrato `contact`: [export function createContactLead(](apps/api/src/domains/sales-ops/leads/lead-service.ts:940), [export function updateContactLead(](apps/api/src/domains/sales-ops/leads/lead-service.ts:1151).
- O contrato "full" é `.strict()` e rejeita as chaves de contato: [export const CreateLeadSchema](apps/api/src/domains/sales-ops/leads/lead-schemas.ts:80).

#### Web
- Rascunho e payload do contato: [export function buildContactLeadPayload](apps/web/src/sales-ops/leads/contact-lead.ts:109), [export function leadContactLine](apps/web/src/sales-ops/leads/contact-lead.ts:149), [export function validateContactLeadDraft](apps/web/src/sales-ops/leads/contact-lead.ts:86).
- Busca do quadro: [export function matchesBoardSearch](apps/web/src/sales-ops/leads/board-search.ts:9).
- Diálogo: [export function ContactLeadDialog(](apps/web/src/sales-ops/leads/ContactLeadDialog.tsx:97).

#### Eventos e outbox
- Nenhum. O contato do lead nunca chega ao Finance.

#### RLS
- As colunas herdam as políticas de `sales_ops_leads` (seção 3.1). Não há tabela nova.

#### Testes
- `contact-lead.test.ts` - [validateContactLeadDraft](apps/web/src/sales-ops/leads/__tests__/contact-lead.test.ts:78)
- `contact-lead-dialog.test.tsx` - [ContactLeadDialog](apps/web/src/sales-ops/leads/__tests__/contact-lead-dialog.test.tsx:172)
- `leads-contact-board.test.tsx` - [contact board, Quadro](apps/web/src/sales-ops/leads/__tests__/leads-contact-board.test.tsx:186)
- `lead-contact-fields-migration.test.ts` - [lead contact fields migration 0027](apps/api/test/rls/lead-contact-fields-migration.test.ts:34)

#### O que quebra se virar campo dinâmico
- Telefone e e-mail como campos dinâmicos quebram a busca do quadro e a linha de contato do cartão, que leem as colunas diretamente.
- O pedido do dono exige nome e contato como únicos campos obrigatórios; precisam continuar colunas validadas por schema.
- Hoje telefone e e-mail são opcionais: [const ContactPhoneSchema](apps/api/src/domains/sales-ops/leads/lead-schemas.ts:178). A obrigatoriedade de "contato" é decisão de produto para a fase 1b/2 (pelo menos um de telefone ou e-mail) e não existe no código atual.

#### Recomendação
- Fixo: `contact_name`, `contact_phone`, `contact_email`. Configurável: nascimento, cargo, canal preferido e demais campos do contato como campos dinâmicos simples.
- Uma entidade Contato separada do lead (muitos contatos por empresa) fica como pergunta aberta (seção 6), não como requisito desta fase.

#### Risco
- **baixo**: não há tabela a alterar; o caminho aditivo é manter as colunas e acrescentar campos.

### 3.7 Pessoa / Vendedor / Responsável (`sales_ops_people`)

#### Onde vive hoje
- Criada na 0007; as funções vieram na 0012; o vínculo com conta Hub na 0023: [CREATE TABLE "sales_ops_funcoes"](apps/api/drizzle/0012_sales_ops_funcoes.sql:1), [ADD COLUMN "hub_account_id" text](apps/api/drizzle/0023_lead_seller_identity.sql:24).
- Existe também a tabela legada `sellers` (convites Hub, sem `org_id`, sem RLS) e a legada `finders`, que NÃO são a pessoa do CRM: [export const sellers = pgTable('sellers'](apps/api/src/db/schema.ts:86).

#### Schema Drizzle
- Pessoa: [export const salesOpsPeople = pgTable(](apps/api/src/db/schema.ts:452), vínculo Hub [hubAccountId: text('hub_account_id')](apps/api/src/db/schema.ts:471), índice parcial [uniqueIndex('sales_ops_people_org_hub_account_idx')](apps/api/src/db/schema.ts:501).
- Espelhos obsoletos: [isSeller: boolean('is_seller')](apps/api/src/db/schema.ts:479), [isFinder: boolean('is_finder')](apps/api/src/db/schema.ts:484).
- Funções: [export const salesOpsFuncoes = pgTable(](apps/api/src/db/schema.ts:539), associação [export const salesOpsPersonFuncoes = pgTable(](apps/api/src/db/schema.ts:585).
- Quem usa a pessoa: proposta (vendedor e finder) [sellerPersonId: uuid('seller_person_id').references(() => salesOpsPeople.id)](apps/api/src/db/schema.ts:805), profissionais da proposta [personId: uuid('person_id').references(() => salesOpsPeople.id)](apps/api/src/db/schema.ts:870), lead [name: 'sales_ops_leads_org_seller_fk'](apps/api/src/db/schema.ts:1097).

#### API
- Rotas de pessoas (escrita só admin) e funções: [salesOpsRouter.get('/people', async](apps/api/src/domains/sales-ops/routes.ts:107), [salesOpsRouter.post('/people', requireAdmin](apps/api/src/domains/sales-ops/routes.ts:122), [salesOpsRouter.patch('/people/:id', requireAdmin](apps/api/src/domains/sales-ops/routes.ts:140), [salesOpsRouter.post('/funcoes', requireAdmin](apps/api/src/domains/sales-ops/routes.ts:280), [salesOpsRouter.patch('/funcoes/:id', requireAdmin](apps/api/src/domains/sales-ops/routes.ts:296).
- Serviço: [export async function createPerson(](apps/api/src/domains/sales-ops/service.ts:1666), [export async function updatePerson(](apps/api/src/domains/sales-ops/service.ts:1713), [export function planPersonFuncoes(](apps/api/src/domains/sales-ops/service.ts:433), [export async function ensureSystemFuncoes(](apps/api/src/domains/sales-ops/service.ts:1601), [export const SYSTEM_FUNCAO_SLUGS](apps/api/src/domains/sales-ops/service.ts:383).
- Escopo do vendedor no lead: [export async function resolveCallerPersonId](apps/api/src/domains/sales-ops/leads/lead-service.ts:140) e [export async function provisionLeadsSellerPerson](apps/api/src/domains/sales-ops/leads/lead-service.ts:321).
- No modo leads, `POST/PATCH /people` forçam a função vendedor (oráculo): `people-routes-edition.test.ts` - [Sales Ops people routes per sales edition](apps/api/src/domains/sales-ops/__tests__/people-routes-edition.test.ts:85).
- Convite de vendedor pelo Hub: [async function inviteSellerRow](apps/api/src/domains/sellers/admin-service.ts:202).

#### Web
- Telas: [export function PessoasView(](apps/web/src/sales-ops/SalesOpsApp.tsx:3985), [export function FuncoesView(](apps/web/src/sales-ops/SalesOpsApp.tsx:4100), [export function PersonDialog(](apps/web/src/sales-ops/SalesOpsApp.tsx:6139).
- Vendedores no modo leads: [export](apps/web/src/sales-ops/people/VendedoresView.tsx:62).
- Função por slug (nunca pelos espelhos): [export function hasFuncao](apps/web/src/sales-ops/calculations.ts:37).
- Papéis vêm das claims do Hub, não do banco: [export function getRolesFromHubClaims](apps/web/src/auth/claims.ts:21).

#### Eventos e outbox
- O nome do vendedor e dos beneficiários vira contraparte nos eventos de obrigação a pagar: [displayName: input.row.beneficiaryName](apps/api/src/domains/integration/events.ts:163).
- O tipo do a pagar (comissão de vendedor, de finder, custo de profissional, imposto, outro) vira o `role` da contraparte: [export function roleForPayableKind(](apps/api/src/domains/integration/events.ts:96).

#### RLS
- [CREATE POLICY sales_ops_people_tenant_isolation ON sales_ops_people](apps/api/drizzle/0008_single_role_rls_context.sql:143), [CREATE POLICY sales_ops_people_admin_context ON sales_ops_people](apps/api/drizzle/0008_single_role_rls_context.sql:148); funções: [CREATE POLICY sales_ops_funcoes_tenant_isolation](apps/api/drizzle/0012_sales_ops_funcoes.sql:31).

#### Testes
- `funcoes-rls.test.ts` - [sales operations funções persistence and RLS](apps/api/test/rls/funcoes-rls.test.ts:44)
- `funcoes-schema-migration.test.ts` - [funções schema migration 0012](apps/api/test/rls/funcoes-schema-migration.test.ts:16)
- `funcoes-concurrency.test.ts` - [sales operations funções write concurrency](apps/api/test/rls/funcoes-concurrency.test.ts:38)
- `leads-seller-scope.test.ts` - [sales operations leads: seller scope, movement and isolation](apps/api/test/rls/leads-seller-scope.test.ts:61)
- `funcoes-contract.test.ts` - [sales operations funções contract](apps/api/src/domains/sales-ops/__tests__/funcoes-contract.test.ts:16)
- `pessoas-funcoes-view.test.tsx` - [pessoas cadastro](apps/web/src/sales-ops/__tests__/pessoas-funcoes-view.test.tsx:228)
- `vendedores-routing.test.tsx` - [/cadastros/pessoas in the full edition](apps/web/src/sales-ops/__tests__/vendedores-routing.test.tsx:319)

#### O que quebra se virar campo dinâmico
- O escopo de vendedor do lead depende de `hub_account_id` único por org e de `resolveCallerPersonId`; um campo dinâmico não oferece essa unicidade.
- Comissões e snapshots de propostas guardam `seller_name_snapshot` e `finder_name_snapshot`; a pessoa é referenciada por FK e não pode virar texto.
- As funções `vendedor` e `finder` são de sistema e travadas: [export const SYSTEM_FUNCAO_SLUGS](apps/api/src/domains/sales-ops/service.ts:383).

#### Recomendação
- Fixo. No lead, "Responsável" é campo de referência padrão para `sales_ops_people` (função vendedor), com o vendedor preenchido pela empresa escolhida quando houver.
- Não criar tabela nova de pessoas.

#### Risco
- **médio**: escopo de leitura por vendedor no servidor, vínculo com a conta Hub e uso em propostas e a pagar; a mudança prevista só referencia a tabela.

### 3.8 Produto / Serviço (`sales_ops_products`), áreas e custos por função

#### Onde vive hoje
- Produtos na 0007, áreas na 0010, padrões de proposta na 0013: [CREATE POLICY sales_ops_areas_tenant_isolation](apps/api/drizzle/0010_sales_ops_areas.sql:15), [CREATE TABLE "sales_ops_product_funcao_costs"](apps/api/drizzle/0013_produtos_servicos_defaults.sql:28).
- Armadilha de nome: a tabela legada `products` é o catálogo de afiliados do módulo finder, outra coisa: [export const products = pgTable(](apps/api/src/db/schema.ts:127).

#### Schema Drizzle
- Produto: [export const salesOpsProducts = pgTable(](apps/api/src/db/schema.ts:617), discriminador [kind: text('kind').notNull().default('product')](apps/api/src/db/schema.ts:625).
- Áreas: [export const salesOpsAreas = pgTable(](apps/api/src/db/schema.ts:507).
- Custos por função: [export const salesOpsProductFuncaoCosts = pgTable(](apps/api/src/db/schema.ts:711).
- O item de proposta guarda FK e snapshots: [productNameSnapshot: text('product_name_snapshot').notNull()](apps/api/src/db/schema.ts:849).
- O produto do lead: [export const salesOpsLeadProducts = pgTable(](apps/api/src/db/schema.ts:1138).

#### API
- Rotas sob `requireCapability('catalog')`: [salesOpsRouter.use('/products/*', requireCapability('catalog'))](apps/api/src/domains/sales-ops/routes.ts:85), [salesOpsRouter.get('/products', async](apps/api/src/domains/sales-ops/routes.ts:159), [salesOpsRouter.post('/products', async](apps/api/src/domains/sales-ops/routes.ts:166), [salesOpsRouter.patch('/products/:id', async](apps/api/src/domains/sales-ops/routes.ts:184), [salesOpsRouter.get('/areas', async](apps/api/src/domains/sales-ops/routes.ts:238).
- Serviço: [export async function createProduct(](apps/api/src/domains/sales-ops/service.ts:2180), [export async function updateProduct(](apps/api/src/domains/sales-ops/service.ts:2217), [export async function listProductFuncaoCosts(](apps/api/src/domains/sales-ops/service.ts:2090), [export const ProductSchema](apps/api/src/domains/sales-ops/service.ts:352), [export function resolveProductKind(](apps/api/src/domains/sales-ops/service.ts:247).
- Resolução de produtos do lead: [async function resolveLeadProducts(](apps/api/src/domains/sales-ops/leads/lead-service.ts:470).
- Expurgo noturno de arquivados: [export async function purgeArchivedCadastros](apps/api/src/domains/sales-ops/purge-service.ts:311).

#### Web
- Telas e diálogos: [export function ProductsView(](apps/web/src/sales-ops/SalesOpsApp.tsx:3584), [export function ProductDialog(](apps/web/src/sales-ops/SalesOpsApp.tsx:4685), [export function AreasView(](apps/web/src/sales-ops/SalesOpsApp.tsx:3886).
- `kind` do produto só por `isServiceProduct`: [export function isServiceProduct](apps/web/src/sales-ops/calculations.ts:72); valor próprio só por [export function productBaseValueBrl](apps/web/src/sales-ops/calculations.ts:132).

#### Eventos e outbox
- O produto não aparece em nenhum evento de integração; o evento de obrigação carrega só proposta, valor, data, contraparte e método: [export type ReceivableRowForEvent](apps/api/src/domains/integration/events.ts:37).

#### RLS
- [CREATE POLICY sales_ops_products_tenant_isolation ON sales_ops_products](apps/api/drizzle/0008_single_role_rls_context.sql:156), [CREATE POLICY sales_ops_areas_admin_context](apps/api/drizzle/0010_sales_ops_areas.sql:19), [CREATE POLICY sales_ops_product_funcao_costs_tenant_isolation](apps/api/drizzle/0013_produtos_servicos_defaults.sql:71).

#### Testes
- `product-funcao-costs-rls.test.ts` - [produtos & serviços defaults, função costs and tenancy](apps/api/test/rls/product-funcao-costs-rls.test.ts:54)
- `produtos-servicos-schema-migration.test.ts` - [produtos & serviços schema migration 0013](apps/api/test/rls/produtos-servicos-schema-migration.test.ts:77)
- `areas-rls.test.ts` - [sales operations areas persistence and RLS](apps/api/test/rls/areas-rls.test.ts:40)
- `produtos-servicos-contract.test.ts` - [produtos & serviços write contract](apps/api/src/domains/sales-ops/__tests__/produtos-servicos-contract.test.ts:24)
- `product-commission-contract.test.ts` - [sales operations product commission contract](apps/api/src/domains/sales-ops/__tests__/product-commission-contract.test.ts:17)
- `produtos-servicos-view.test.tsx` - [produtos e serviços view](apps/web/src/sales-ops/__tests__/produtos-servicos-view.test.tsx:172)
- `product-service-dialog.test.tsx` - [product and service dialog](apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx:372)

#### O que quebra se virar campo dinâmico
- Os padrões comerciais (valores de setup e mensal, plano de pagamento, comissões por cenário, custos por função) alimentam o wizard da proposta e `computeSaleFinancials`; campos soltos não passam pelas validações do `ProductSchema`.
- `kind` tem CHECK que mantém `open_price` coerente: [sales_ops_products_kind_open_price_check](apps/api/src/db/schema.ts:629).
- A FK do item de proposta e do produto do lead é restrict; o expurgo noturno depende do erro `23503` para pular produtos referenciados.

#### Recomendação
- Fixo (tabela atual). No lead, Produto e Serviço são campos de referência que apontam para `sales_ops_products` (o lead já usa `sales_ops_lead_products`).
- Campos extras do produto configuráveis só em tabela de valores nova; nunca nas colunas de padrão comercial.

#### Risco
- **médio**: o catálogo alimenta o cálculo da proposta e a comissão; como a mudança prevista só referencia a tabela, não passa de médio.

### 3.9 Proposta / Orçamento / Venda (`sales_ops_sales`, itens, profissionais)

#### Onde vive hoje
- Criadas na 0007 e ampliadas por 0011 (ciclo de vida), 0014 (funções do profissional), 0017 (divisão de pagamento), 0018 (identidade do a pagar) e 0024 (`removed_at`): [ALTER COLUMN "status" SET DEFAULT 'open'](apps/api/drizzle/0011_proposal_lifecycle_schema.sql:1), [ADD COLUMN "removed_at" timestamp with time zone](apps/api/drizzle/0024_sales_ops_settlements.sql:65).
- O estado da proposta é `draft | open | won | lost | cancelled`; só `won` materializa a pagar.

#### Schema Drizzle
- Proposta: [export const salesOpsSales = pgTable(](apps/api/src/db/schema.ts:796), estado [status: text('status').notNull().default('open')](apps/api/src/db/schema.ts:809), código [code: text('code').notNull(),](apps/api/src/db/schema.ts:802), ganho [wonAt: timestamp('won_at'](apps/api/src/db/schema.ts:810).
- Totais e margem em centavos: [totalBrl: integer('total_brl').notNull(),](apps/api/src/db/schema.ts:817), [netMarginBrl: integer('net_margin_brl')](apps/api/src/db/schema.ts:827).
- Snapshots: [sellerNameSnapshot: text('seller_name_snapshot').notNull()](apps/api/src/db/schema.ts:806), [finderNameSnapshot: text('finder_name_snapshot')](apps/api/src/db/schema.ts:808).
- Itens: [export const salesOpsSaleItems = pgTable(](apps/api/src/db/schema.ts:840); profissionais: [export const salesOpsSaleProfessionals = pgTable(](apps/api/src/db/schema.ts:862), divisão [costSplitBp: jsonb('cost_split_bp')](apps/api/src/db/schema.ts:897).
- Alvo de FK do lead: [uniqueIndex('sales_ops_sales_org_id_id_idx')](apps/api/src/db/schema.ts:836).

#### API
- Rotas (escrita financeira só admin; criação aberta por causa da conversão de lead): [salesOpsRouter.get('/sales', async](apps/api/src/domains/sales-ops/routes.ts:333), [salesOpsRouter.post('/sales', async](apps/api/src/domains/sales-ops/routes.ts:344), [salesOpsRouter.post('/sales/:id/transition', requireAdmin](apps/api/src/domains/sales-ops/routes.ts:373), [salesOpsRouter.post('/sales/:id/cancel-contract', requireAdmin](apps/api/src/domains/sales-ops/routes.ts:391), [salesOpsRouter.put('/sales/:id', requireAdmin](apps/api/src/domains/sales-ops/routes.ts:411).
- Gate de capability `proposals`: [salesOpsRouter.use('/sales/*', requireCapability('proposals'))](apps/api/src/domains/sales-ops/routes.ts:83).
- Serviço: [export async function createSale(](apps/api/src/domains/sales-ops/service.ts:2575), [export async function updateSale(](apps/api/src/domains/sales-ops/service.ts:2736), [export async function transitionSale(](apps/api/src/domains/sales-ops/service.ts:2879), [export async function cancelContract(](apps/api/src/domains/sales-ops/service.ts:3019), [export const SALE_TRANSITIONS](apps/api/src/domains/sales-ops/service.ts:2860).
- Montagem do ledger: [export function buildSaleLedger(](apps/api/src/domains/sales-ops/service.ts:1007), [export function materializeWonPayables(](apps/api/src/domains/sales-ops/service.ts:1201).
- Edição em lugar: [export function planSaleEdit](apps/api/src/domains/sales-ops/ledger-reconcile.ts:393), [export async function applySaleEditPlan](apps/api/src/domains/sales-ops/sale-edit-writes.ts:115).
- Contratos: [export const CreateSaleSchema](apps/api/src/domains/sales-ops/service.ts:637), [export const UpdateSaleSchema](apps/api/src/domains/sales-ops/service.ts:682), [export const SaleProfessionalSchema](apps/api/src/domains/sales-ops/service.ts:583).
- Margem única: [export function computeSaleFinancials](packages/shared-utils/src/sale-financials.ts:52).

#### Web
- Lista, detalhe e wizard: [export function SalesView(](apps/web/src/sales-ops/SalesOpsApp.tsx:2818), [function SaleDetailDialog(](apps/web/src/sales-ops/SalesOpsApp.tsx:3067), [export function SaleWizardDialog(](apps/web/src/sales-ops/SalesOpsApp.tsx:6722); o corpo do wizard vai de [function SaleWizardDialogBody(](apps/web/src/sales-ops/SalesOpsApp.tsx:6786) até o fim do arquivo de 9.7 mil linhas.
- Pré-preenchimento vindo do lead: [leadPrefill={saleWizard?.mode](apps/web/src/sales-ops/SalesOpsApp.tsx:2507).
- Rota do detalhe: [export const SALES_OPS_ROUTE_PATTERN](apps/web/src/sales-ops/navigation.ts:55), [export function buildSaleDetailPath](apps/web/src/sales-ops/navigation.ts:277).

#### Eventos e outbox
- A proposta é a origem de todo evento de obrigação: o objeto `source` leva `saleId`, `saleCode` e `clientName`: [clientName: sale.clientNameSnapshot](apps/api/src/domains/sales-ops/service.ts:2564).
- O caminho de emissão fica na transação do negócio e é gated por org: [async function emitSaleObligationEvents(](apps/api/src/domains/sales-ops/service.ts:2479), [if (!isProducerFlowLive(orgId)) return;](apps/api/src/domains/sales-ops/service.ts:2487).
- O link profundo exigido pelo schema v1 é `/operacional/vendas/<saleId>`: [export function deepLinkPathForSale](apps/api/src/domains/integration/events.ts:33).

#### RLS
- [CREATE POLICY sales_ops_sales_tenant_isolation ON sales_ops_sales](apps/api/drizzle/0008_single_role_rls_context.sql:208), [CREATE POLICY sales_ops_sale_items_tenant_isolation ON sales_ops_sale_items](apps/api/drizzle/0008_single_role_rls_context.sql:182), [CREATE POLICY sales_ops_sale_professionals_tenant_isolation ON sales_ops_sale_professionals](apps/api/drizzle/0008_single_role_rls_context.sql:195).

#### Testes
- `proposal-schema-migration.test.ts` - [proposal schema migration 0011](apps/api/test/rls/proposal-schema-migration.test.ts:15)
- `proposal-write.test.ts` - [proposal write backend (create v2 + update + payable materialization)](apps/api/test/rls/proposal-write.test.ts:35)
- `update-sale-in-place.test.ts` - [updateSale edits a proposta in place](apps/api/test/rls/update-sale-in-place.test.ts:60)
- `sale-professional-funcoes.test.ts` - [proposta profissionais: funcao binding, party tenancy and won payables](apps/api/test/rls/sale-professional-funcoes.test.ts:42)
- `sale-transitions.integration.test.ts` - [transitionSale](apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts:167)
- `ledger-reconcile.test.ts` - [checkEditableStatusChange](apps/api/src/domains/sales-ops/__tests__/ledger-reconcile.test.ts:79)
- `sale-margin-parity.test.ts` - [sale margin parity - API ledger](apps/api/src/domains/sales-ops/__tests__/sale-margin-parity.test.ts:71)
- `sale-wizard-edit.test.tsx` - [sale wizard edit path](apps/web/src/sales-ops/__tests__/sale-wizard-edit.test.tsx:357)
- `sales-transition-actions.test.tsx` - [sales transition row actions](apps/web/src/sales-ops/__tests__/sales-transition-actions.test.tsx:248)

#### O que quebra se virar campo dinâmico
- `status`, `total_brl`, `code`, snapshots e `won_at` determinam a pagar, o recebível, a margem e o evento do Finance; campo dinâmico não passa por `computeSaleFinancials` nem pelas travas de baixa (`sale_has_active_settlements`).
- O código `PROP-...` e o contador `sequence` têm índice único por org: [uniqueIndex('sales_ops_sales_org_sequence_idx')](apps/api/src/db/schema.ts:833).
- A identidade das linhas na edição é por id (`planSaleEdit`); linhas dinâmicas sem id estável corromperiam a reconciliação.
- Mudar "Proposta versus Vendido" para depender da etapa do lead NÃO deve alterar `sales_ops_sales.status`; o lead só referencia a proposta por `sale_id`.

#### Recomendação
- Fixo. Não alterar colunas, estado nem rotas. O CRM apenas referencia a proposta (campo de referência Venda) e continua criando-a pelo mesmo `POST /sales`.

#### Risco
- **alto** (julgamento deste levantamento): o estado e os totais materializam o ledger e o evento do Finance, e o wizard tem milhares de linhas com regras travadas por testes. Caminho conservador: não alterar; pendência na seção 4.

### 3.10 Recebível / A pagar / Liquidação

#### Onde vive hoje
- Receber e pagar nasceram na 0007; `revision` e `updated_at` na 0024, que também cria a tabela imutável de baixas: [CREATE TABLE "sales_ops_settlements"](apps/api/drizzle/0024_sales_ops_settlements.sql:69).
- Baixa e estorno são fatos imutáveis; um gatilho recusa UPDATE e DELETE: [CREATE TRIGGER "sales_ops_settlements_immutable"](apps/api/drizzle/0024_sales_ops_settlements.sql:111), SQLSTATE [USING ERRCODE = 'FXS01'](apps/api/drizzle/0024_sales_ops_settlements.sql:108); o estorno precisa espelhar a baixa: [USING ERRCODE = 'FXS02'](apps/api/drizzle/0024_sales_ops_settlements.sql:133).

#### Schema Drizzle
- [export const salesOpsReceivables = pgTable(](apps/api/src/db/schema.ts:1163), [export const salesOpsPayables = pgTable(](apps/api/src/db/schema.ts:1192), [export const salesOpsSettlements = pgTable(](apps/api/src/db/schema.ts:1275).
- Estado em cache da linha: [status: text('status').notNull().default('open'), // 'open' | 'paid' | 'void'](apps/api/src/db/schema.ts:1175).
- Tipo do fato: [type: text('type').notNull(), // 'baixa' | 'estorno'](apps/api/src/db/schema.ts:1284).

#### API
- Escritor único de `sales_ops_settlements`: [export async function applyBaixaTx(](apps/api/src/domains/sales-ops/settlements.ts:430) e [export async function applyEstornoTx(](apps/api/src/domains/sales-ops/settlements.ts:509).
- Rotas só admin: [salesOpsRouter.post('/settlements', requireAdmin](apps/api/src/domains/sales-ops/routes.ts:441), [salesOpsRouter.post('/settlements/:id/reverse', requireAdmin](apps/api/src/domains/sales-ops/routes.ts:451), [salesOpsRouter.get('/sales/:id/settlements', requireAdmin](apps/api/src/domains/sales-ops/routes.ts:469).
- Regra única de liquidação, espelho do Finance: [export function reduzirLiquidacao](packages/shared-utils/src/liquidacao.ts:118), [export function validarNovaBaixa](packages/shared-utils/src/liquidacao.ts:182), [export function validarEstorno](packages/shared-utils/src/liquidacao.ts:206).
- Revisão em toda mudança de coluna: [export function receivableRevisionBump](apps/api/src/domains/sales-ops/ledger-revision.ts:8), [export function payableRevisionBump](apps/api/src/domains/sales-ops/ledger-revision.ts:13).
- Identidade do a pagar: [export function payableIdentityKey](apps/api/src/domains/sales-ops/ledger-reconcile.ts:220).
- Anomalia derivada (baixa duplicada): [export function deriveSettlementAnomaly(](apps/api/src/domains/sales-ops/settlements.ts:614).
- A lista e as ordens no web: [export function compareReceivables](apps/web/src/sales-ops/ledger-order.ts:15), [export function comparePayables](apps/web/src/sales-ops/ledger-order.ts:39).

#### Web
- Interface de baixa e estorno em pasta própria: [export](apps/web/src/sales-ops/settlements/MarkPaidDialog.tsx:39), [export](apps/web/src/sales-ops/settlements/ReverseSettlementDialog.tsx:29), [export](apps/web/src/sales-ops/settlements/SettlementHistory.tsx:29).
- Comissões derivam de a pagar: [export function CommissionsView(](apps/web/src/sales-ops/SalesOpsApp.tsx:3418).

#### Eventos e outbox
O que o FXL Finance consome do Sales (pull direto do feed `GET /integration/v1/feed`, sem payload no Hub):
- Feed: [router.get('/feed', async](apps/api/src/domains/integration/feed-routes.ts:45); outbox em [export const integrationOutbox = pgTable(](apps/api/src/db/schema.ts:1419).
- `fxl-sales.obligation.upserted`: [export const EVENT_OBLIGATION_UPSERTED](apps/api/src/domains/integration/events.ts:18); payload montado em [export function toObligationPayload(](apps/api/src/domains/integration/events.ts:135) com `obligationRef`, `direction` (receivable ou payable), `kind`, `amountCents`, `currency` BRL, `dueDate`, `source` (`saleId`, `saleCode`, `displayLabel`, `deepLinkPath`), `revision`, `state` (`active` ou `voided`), `method` (só recebível), `counterparty` (`displayName`, `role`) e `voidReason`.
- O `kind` do recebível é derivado do rótulo da parcela (`sale_recurring` quando o rótulo é recorrente, `sale_installment` nos demais): [function kindOf(](apps/api/src/domains/integration/events.ts:117); o `kind` do a pagar é o `PayableKind` do Sales: [export type PayableKind =](apps/api/src/domains/sales-ops/service.ts:1142). Portanto o formato do rótulo da parcela é parte do contrato com o Finance.
- A chave de idempotência inclui a revisão da linha: [idempotencyKey:](apps/api/src/domains/integration/events.ts:193).
- O imposto é excluído do conjunto sincronizado na produção: [syncedObligationSubset(input.obligations.map(toObligationCandidate))](apps/api/src/domains/integration/events.ts:177); linhas com valor menor que 1 centavo não emitem: [obligation.row.amountBrl < 1](apps/api/src/domains/integration/events.ts:183).
- `fxl-sales.settlement.recorded`: [export const EVENT_SETTLEMENT_RECORDED](apps/api/src/domains/integration/events.ts:19) com `settlementRef`, `obligationRef`, `amountCents`, `paidOn`, `recordedBy`; construtor [export function buildSettlementRecordedEvent(](apps/api/src/domains/integration/events.ts:225).
- `fxl-sales.settlement.reversed`: [export const EVENT_SETTLEMENT_REVERSED](apps/api/src/domains/integration/events.ts:20) com `reversalRef`, `reversesSettlementRef`, `amountCents`, `reversedOn`, `reason`, `recordedBy`; construtor [export function buildSettlementReversedEvent(](apps/api/src/domains/integration/events.ts:249).
- Referências: `obligationRef` e `settlementRef` são `fxl-sales:<uuid da linha>`, nunca rótulo: [export function obligationRef(](apps/api/src/domains/integration/events.ts:24), [export function settlementRef(](apps/api/src/domains/integration/events.ts:27).
- Emissão sempre na mesma transação do ato de negócio e só quando o fluxo produtor da org está ligado: [export function isProducerFlowLive](apps/api/src/domains/integration/producer-gate.ts:9), [if (policy.mode === 'manual' && isProducerFlowLive(orgId))](apps/api/src/domains/sales-ops/settlements.ts:496).
- O Sales também consome do Finance: eventos `fxl-finance.settlement.recorded` e `fxl-finance.settlement.reversed` de `app.fxl-finance`: [export const FINANCE_SETTLEMENT_RECORDED](apps/api/src/domains/integration/consumer-mapping.ts:12), [export const FINANCE_APP_ID](apps/api/src/domains/integration/consumer-mapping.ts:23), [export function createFinanceConsumer(](apps/api/src/domains/integration/consumer.ts:237).
- Tabelas de transporte: [CREATE TABLE "integration_outbox"](apps/api/drizzle/0025_integration_transport.sql:25).
- Qualquer mudança nesses nomes, campos, chaves de idempotência ou nas tabelas é mudança de contrato com o Finance: risco alto, proibida nesta run.

#### RLS
- Receber, pagar, baixas: [CREATE POLICY sales_ops_receivables_tenant_isolation ON sales_ops_receivables](apps/api/drizzle/0008_single_role_rls_context.sql:169), [CREATE POLICY sales_ops_payables_tenant_isolation ON sales_ops_payables](apps/api/drizzle/0008_single_role_rls_context.sql:130), [CREATE POLICY sales_ops_settlements_tenant_isolation](apps/api/drizzle/0024_sales_ops_settlements.sql:142), [CREATE POLICY sales_ops_settlements_admin_context](apps/api/drizzle/0024_sales_ops_settlements.sql:146).
- Transporte: [CREATE POLICY integration_outbox_tenant_isolation](apps/api/drizzle/0025_integration_transport.sql:66).

#### Testes
- `settlements-schema.test.ts` - [sales_ops_settlements schema (migration 0024)](apps/api/test/rls/settlements-schema.test.ts:117)
- `settlements-schema-migration.test.ts` - [migration 0024 on a database populated at 0023](apps/api/test/rls/settlements-schema-migration.test.ts:46)
- `professional-payable-migration.integration.test.ts` - [phased professional payable identity migration](apps/api/test/rls/professional-payable-migration.integration.test.ts:428)
- `settlements.integration.test.ts` - [POST /settlements (baixa)](apps/api/src/domains/sales-ops/__tests__/settlements.integration.test.ts:256)
- `settlements.test.ts` - [attachSettlementState](apps/api/src/domains/sales-ops/__tests__/settlements.test.ts:38)
- `producer-emission.integration.test.ts` - [producer emission (connected org)](apps/api/src/domains/sales-ops/__tests__/producer-emission.integration.test.ts:117)
- `events.test.ts` - [obligation builders](apps/api/src/domains/integration/__tests__/events.test.ts:37)
- `consumer.integration.test.ts` - [finance settlement consumer applies once, is idempotent, versions, disputes and never echoes](apps/api/src/domains/integration/__tests__/consumer.integration.test.ts:189)
- `feed-route.integration.test.ts` - [GET /integration/v1/feed](apps/api/src/domains/integration/__tests__/feed-route.integration.test.ts:82)
- `liquidacao.test.ts` - [liquidacao parity with Finance](packages/shared-utils/src/__tests__/liquidacao.test.ts:356)
- `settlement-history.test.tsx` - [SettlementHistoryList](apps/web/src/sales-ops/settlements/__tests__/settlement-history.test.tsx:97)

#### O que quebra se virar campo dinâmico
- Tudo: o valor, o vencimento, a revisão e o estado são lidos pelo Finance, pelo redutor de liquidação, pelos gatilhos e pelas travas de edição.
- Os gatilhos `FXS01` e `FXS02` e as FKs compostas `ON DELETE RESTRICT` dependem das colunas fixas.
- O consumidor aplica fatos remotos pelas mesmas funções com `policy.mode = 'finance'`; qualquer campo novo precisa passar por elas.

#### Recomendação
- Fixo e intocado. Nenhuma alteração de schema, evento, rota ou regra nesta run.

#### Risco
- **alto** por definição do pedido (`sales_ops_payables`, `sales_ops_receivables`, `sales_ops_settlements` e eventos `fxl-sales.obligation.*` e `fxl-sales.settlement.*`). Pendência na seção 4.

### 3.11 Comissão / Finder / Indicação / Click / Conversão

#### Onde vive hoje
- Há DUAS noções de comissão: (a) comissão de venda do Sales Ops, derivada em `sales_ops_payables` (tipos `seller_commission` e `finder_commission`), tratada em 3.10; (b) o módulo legado de afiliados com tabelas próprias, descrito aqui.
- Tabelas do módulo legado: `finders`, `referral_links`, `clicks`, `conversions`, `commissions`, `payouts`, mais o catálogo legado `apps`, `products`, `price_bands`, `commission_rules`.

#### Schema Drizzle
- [export const finders = pgTable(](apps/api/src/db/schema.ts:46), [export const referralLinks = pgTable(](apps/api/src/db/schema.ts:260), [export const clicks = pgTable(](apps/api/src/db/schema.ts:298), [export const conversions = pgTable(](apps/api/src/db/schema.ts:335), [export const commissions = pgTable(](apps/api/src/db/schema.ts:387), [export const payouts = pgTable('payouts'](apps/api/src/db/schema.ts:431).
- Catálogo legado: [export const apps = pgTable('apps'](apps/api/src/db/schema.ts:107), [export const products = pgTable(](apps/api/src/db/schema.ts:127), [export const priceBands = pgTable(](apps/api/src/db/schema.ts:147), [export const commissionRules = pgTable('commission_rules'](apps/api/src/db/schema.ts:170).
- Idempotência do webhook: [idempotencyKey: text('idempotency_key').notNull().unique()](apps/api/src/db/schema.ts:343).

#### API
- Montagem: [app.route('/api/v1/conversions', conversionsRouter)](apps/api/src/server.ts:102), [app.route('/api/v1/admin/commissions', commissionsAdminRouter)](apps/api/src/server.ts:117), [app.route('/api/v1/admin/payouts', payoutsAdminRouter)](apps/api/src/server.ts:123), [app.route('/api/v1/links', linksRouter)](apps/api/src/server.ts:142), [app.route('/r', referralsRouter)](apps/api/src/server.ts:145), [app.route('/api/v1/finder', finderRouter)](apps/api/src/server.ts:149), [app.route('/api/v1/finders', findersPublicRouter)](apps/api/src/server.ts:94).
- O webhook roda atrás de verificação HMAC antes de ler o corpo: [app.use('/api/v1/conversions', hmacVerifyMiddleware)](apps/api/src/server.ts:100).
- Serviços: [export async function ingestConversion(](apps/api/src/domains/conversions/service.ts:115), [export function buildCommissionRows](apps/api/src/domains/commissions/service.ts:121), [export async function lockCommission](apps/api/src/domains/commissions/service.ts:214), [export async function createPayoutBatch](apps/api/src/domains/payouts/service.ts:46), [export async function createLink(](apps/api/src/domains/links/service.ts:122), [export async function handleReferralClick](apps/api/src/domains/referrals/click-handler.ts:23), [export async function approveFinder](apps/api/src/domains/finders/admin-service.ts:84).
- No modo leads o módulo é bloqueado por capability: [finderRouter.use('*', requireCapability('finders'))](apps/api/src/domains/finder/routes.ts:29) e [linksRouter.use('*', requireCapability('finders'))](apps/api/src/domains/links/routes.ts:15).

#### Web
- Telas administrativas: [export](apps/web/src/admin/finders/AdminFindersPage.tsx:28), [export](apps/web/src/admin/commissions/CommissionsPage.tsx:34), [export](apps/web/src/admin/payouts/PayoutsPage.tsx:38), [export](apps/web/src/admin/conversions/ConversionsPage.tsx:21).
- Telas do finder: [export](apps/web/src/finder/dashboard/FinderDashboardPage.tsx:9), [export](apps/web/src/finder/clicks/ClicksPage.tsx:9).
- As árvores legadas `/admin/*`, `/finder/*`, `/seller/*` não mudam por regra do repositório.

#### Eventos e outbox
- Grava `audit_log` (`conversion.recorded`, `commission.created`, `commission.approve`, `commission.reverse`, `payout.mark_paid`): ['payout.mark_paid',](apps/api/src/domains/audit/service.ts:35).
- Não emite eventos de integração com o Finance.

#### RLS
- Políticas com INSERT público e leitura por tenant: [CREATE POLICY conversions_insert_webhook ON conversions](apps/api/drizzle/0008_single_role_rls_context.sql:84), [CREATE POLICY clicks_insert_public ON clicks](apps/api/drizzle/0008_single_role_rls_context.sql:67), [CREATE POLICY referral_links_public_lookup ON referral_links](apps/api/drizzle/0008_single_role_rls_context.sql:60), [CREATE POLICY commissions_tenant ON commissions](apps/api/drizzle/0008_single_role_rls_context.sql:104).
- `payouts` não tem RLS por desenho: [NO RLS on payouts](apps/api/drizzle/0004_huge_warbird.sql:146).

#### Testes
- `conversion-ingest.test.ts` - [conversion ingest + commission + audit (Phase 05)](apps/api/test/rls/conversion-ingest.test.ts:32)
- `conversions-commissions-rls.test.ts` - [conversions/commissions split-RLS (D10/D-G)](apps/api/test/rls/conversions-commissions-rls.test.ts:20)
- `referral-links-public-lookup.test.ts` - [RLS: referral_links public-lookup (D-E)](apps/api/test/rls/referral-links-public-lookup.test.ts:24)
- `list-finder-links-cross-tenant.test.ts` - [listFinderLinks cross-tenant isolation (D-D)](apps/api/test/rls/list-finder-links-cross-tenant.test.ts:23)
- `service.test.ts` - [calculateSetupCommission](apps/api/src/domains/commissions/__tests__/service.test.ts:18)
- `csv-gen.test.ts` - [buildCsvBuffer (payout CSV byte contract, D4)](apps/api/src/domains/payouts/__tests__/csv-gen.test.ts:24)
- `service.test.ts` - [validatePriceBand](apps/api/src/domains/links/__tests__/service.test.ts:10)
- `click-handler.test.ts` - [handleReferralClick](apps/api/src/domains/referrals/__tests__/click-handler.test.ts:86)
- `finder-state-machine.integration.test.ts` - [approveFinder](apps/api/src/domains/finders/__tests__/finder-state-machine.integration.test.ts:55)

#### O que quebra se virar campo dinâmico
- Dinheiro (comissões, repasses), webhook HMAC idempotente, redirecionamento público `/r/:code` e RLS cruzada dependem de colunas fixas e de políticas específicas.
- Campos dinâmicos no CRM não devem tocar essas tabelas; qualquer "origem de indicação" do lead deve ser um campo de referência que apenas leia.

#### Recomendação
- Fixo. Fora do escopo do CRM unificado; nenhuma alteração.

#### Risco
- **alto** (julgamento deste levantamento): módulo de dinheiro de terceiros, PII e políticas públicas, que contém o lead legado classificado alto por definição. Pendência na seção 4.

### 3.12 Importação

#### Onde vive hoje
- Sem tabela própria e sem migração. O código fica em `apps/api/src/domains/import/` e `apps/web/src/sales-ops/import/`.
- A definição única da planilha é [export const WORKBOOK_SHEETS](apps/api/src/domains/import/workbook-schema.ts:80) (abas Áreas, Funções, Produtos, Custos por produto, Pessoas, Clientes, Etapas, Leads, Propostas, Itens da proposta, Profissionais da proposta, Parcelas, Pagamentos).

#### Schema Drizzle
- Nenhuma tabela. A importação grava pelos serviços do domínio: [createLead, moveLead, type LeadScope](apps/api/src/domains/import/executor.ts:46).
- Leitura de etapas do catálogo: [kind: salesOpsLeadStages.kind](apps/api/src/domains/import/catalog.ts:173).

#### API
- Rotas só admin, sob `requireCapability('import')`: [salesOpsRouter.use('/import/*', requireCapability('import'))](apps/api/src/domains/sales-ops/routes.ts:91), [importRouter.get('/template', requireAdmin](apps/api/src/domains/import/routes.ts:91), [importRouter.post('/preview', requireAdmin](apps/api/src/domains/import/routes.ts:105), [importRouter.post('/commit', requireAdmin](apps/api/src/domains/import/routes.ts:117).
- Semeia etapas e funções antes de ler o catálogo: [await ensureLeadStages(tx, orgId)](apps/api/src/domains/import/routes.ts:52).
- Planejamento puro: [export function planImport](apps/api/src/domains/import/plan/index.ts:18); leads: [type StageKind](apps/api/src/domains/import/plan/leads.ts:31).
- O plano de leads decide por `kind` da etapa: [if (kind === 'conversion')](apps/api/src/domains/import/plan/leads.ts:184), [if (kind === 'lost' && motivo === null)](apps/api/src/domains/import/plan/leads.ts:198).
- A lista de etapas oferecida na planilha modelo exclui a etapa de conversão: [.filter((s) => s.kind !== 'conversion')](apps/api/src/domains/import/template.ts:191).
- Reconhecimento de cliente existente: [export function recognizeClientRows](apps/api/src/domains/import/client-recognition.ts:26).
- Execução em uma transação, tudo ou nada: [export class ImportExecutionError](apps/api/src/domains/import/executor.ts:139); bloqueio de org conectada ao Finance: [if (needsProducerGate(operation) && isProducerFlowLive(orgId))](apps/api/src/domains/import/executor.ts:220).
- Auditoria única ao final: [action: 'import.completed'](apps/api/src/domains/import/executor.ts:453).
- Limites: [export const MAX_TOTAL_ROWS](apps/api/src/domains/import/workbook-schema.ts:40), [export const MAX_UPLOAD_BYTES](apps/api/src/domains/import/workbook-schema.ts:41).

#### Web
- Tela e container: [export](apps/web/src/sales-ops/import/ImportContainer.tsx:9), [export](apps/web/src/sales-ops/import/ImportView.tsx:69), textos [export](apps/web/src/sales-ops/import/import-copy.ts:4).
- Montagem: [<ImportContainer />](apps/web/src/sales-ops/SalesOpsApp.tsx:2395).

#### Eventos e outbox
- Nenhum evento direto. Um pagamento importado é uma baixa por `applyBaixaTx` com política `manual`, e por isso é bloqueado quando a org está conectada ao Finance: [throw new ImportExecutionError(operation, 'producer_flow_live')](apps/api/src/domains/import/executor.ts:221).

#### RLS
- Sem tabela própria; tudo roda dentro de `withTenant` com a RLS das tabelas de destino.

#### Testes
- `import-routes.integration.test.ts` - [import routes (real router, real database)](apps/api/src/domains/import/__tests__/import-routes.integration.test.ts:297)
- `executor.integration.test.ts` - [executeImportPlan](apps/api/src/domains/import/__tests__/executor.integration.test.ts:339)
- `plan-leads.test.ts` - [planLeads](apps/api/src/domains/import/__tests__/plan-leads.test.ts:35)
- `template-example.test.ts` - [example dataset](apps/api/src/domains/import/__tests__/template-example.test.ts:26)
- `workbook-schema.test.ts` - [workbook schema](apps/api/src/domains/import/__tests__/workbook-schema.test.ts:45)
- `client-recognition.test.ts` - [documentDigits](apps/api/src/domains/import/__tests__/client-recognition.test.ts:37)
- `import-view.test.tsx` - [import view](apps/web/src/sales-ops/import/__tests__/import-view.test.tsx:149)

#### O que quebra se virar campo dinâmico
- A aba `Leads` tem colunas fixas na definição única; colunas dinâmicas por org exigem gerar a definição em tempo de execução (fase 4) sem copiar nomes à mão.
- O plano de leads e o modelo dependem dos três `kind`; novos tipos de etapa (ganho, perdido, pausado) exigem mapeamento explícito (seção 5.2).
- O reconhecimento de cliente depende das colunas `document` e `name` do cliente.

#### Recomendação
- Configurável na fase 4: mapeamento de colunas para campos e etapas, mantendo uma definição única, criação-apenas e o bloqueio de org conectada.
- Até lá, não alterar. A fase 1b não pode quebrar `plan/leads.ts` nem o modelo (leitura antiga continua funcionando até a fase 2).

#### Risco
- **médio**: muitos testes de ida e volta e dependência de `kind`; a mudança é de código, não de dados.

### 3.13 Auditoria / histórico

#### Onde vive hoje
- Tabela global `audit_log` com cadeia de hash, criada na migração inicial: [CREATE TABLE "audit_log"](apps/api/drizzle/0000_fancy_klaw.sql:20); índice por org na 0019: [CREATE INDEX "audit_log_actor_org_id_id_idx"](apps/api/drizzle/0019_audit_log_org_history_idx.sql:1).
- O histórico de etapa de lead NÃO existe: a movimentação de etapa não grava nada além de `stage_changed_at` no próprio lead: [stageChangedAt: timestamp('stage_changed_at'](apps/api/src/db/schema.ts:1044).

#### Schema Drizzle
- [export const auditLog = pgTable(](apps/api/src/db/schema.ts:187), cadeia [prevHash: text('prev_hash').notNull()](apps/api/src/db/schema.ts:200), [entryHash: text('entry_hash').notNull()](apps/api/src/db/schema.ts:201).
- Sem `org_id` próprio: o escopo do tenant é `actor_org_id`: [actorOrgId: text('actor_org_id')](apps/api/src/db/schema.ts:193).

#### API
- Escritor único com hash encadeado: [export async function writeAuditEntry(](apps/api/src/domains/audit/service.ts:163); verificador [export function verifyChain(](apps/api/src/domains/audit/service.ts:116).
- Ações registradas num enum fechado: [export const AuditActionSchema = z.enum(](apps/api/src/domains/audit/service.ts:30); acrescentar valor é aditivo.
- Ações do ciclo de vida de cadastro: [export const CADASTRO_LIFECYCLE_ACTIONS](apps/api/src/domains/audit/service.ts:86).
- Leitura por org: [export async function listOrgAuditHistory](apps/api/src/domains/audit/history-service.ts:91) filtrando por [const conditions: SQL](apps/api/src/domains/audit/history-service.ts:115).
- Rotas: [salesOpsRouter.get('/history', requireAdmin](apps/api/src/domains/sales-ops/routes.ts:526), atrás de [salesOpsRouter.use('/history/*', requireCapability('history'))](apps/api/src/domains/sales-ops/routes.ts:92); administração global em [app.route('/api/v1/admin/audit', auditRouter)](apps/api/src/server.ts:134).
- Escritores atuais: [action: 'lead.deleted'](apps/api/src/domains/sales-ops/leads/lead-trash-service.ts:127), [action: 'lead.restored'](apps/api/src/domains/sales-ops/leads/lead-trash-service.ts:218), [action: 'import.completed'](apps/api/src/domains/import/executor.ts:453), [writeAuditEntry](apps/api/src/domains/sales-ops/purge-service.ts:10), comissões, payouts e conversões.

#### Web
- Painel de histórico de arquivamentos: [export](apps/web/src/sales-ops/CadastroHistoryPanel.tsx:78); lista de ações do cliente: [export const CADASTRO_HISTORY_ACTIONS](apps/web/src/sales-ops/cadastro-history.ts:27).
- Página administrativa global: [export](apps/web/src/admin/audit/AuditLogPage.tsx:17).
- Uma ação nova no enum da API fica invisível na UI até entrar na lista do web (comentário em [export const CADASTRO_LIFECYCLE_ACTIONS](apps/api/src/domains/audit/service.ts:86)).

#### Eventos e outbox
- Nenhum evento de integração; o histórico de auditoria não sai do Sales.

#### RLS
- `audit_log` não tem RLS de tenant; o isolamento é o predicado explícito por `actor_org_id`: [audit_log        - append-only; admin SELECT; system INSERT](apps/api/drizzle/0000_fancy_klaw.sql:176).
- A leitura nunca usa o banco administrativo: [const conditions: SQL](apps/api/src/domains/audit/history-service.ts:115).

#### Testes
- `audit-history-org-scope.test.ts` - [org-scoped audit history read](apps/api/test/rls/audit-history-org-scope.test.ts:157)
- `cadastro-archive-audit.test.ts` - [cadastro archive/restore audit ledger](apps/api/test/rls/cadastro-archive-audit.test.ts:75)
- `cadastro-purge.test.ts` - [nightly purge of archived cadastros](apps/api/test/rls/cadastro-purge.test.ts:113)
- `service.test.ts` - [canonicalJson (D7: alphabetical key sort, no whitespace)](apps/api/src/domains/audit/__tests__/service.test.ts:14)
- `history-route.test.ts` - [GET /history](apps/api/src/domains/sales-ops/__tests__/history-route.test.ts:75)
- `cadastro-history.test.tsx` - [cadastro history rendering](apps/web/src/sales-ops/__tests__/cadastro-history.test.tsx:303)

#### O que quebra se virar campo dinâmico
- Não se aplica a campos. O histórico de etapa do lead não deve ser forçado para dentro de `audit_log`: a cadeia de hash trava a última linha com FOR UPDATE para serializar todos os escritores ([FOR UPDATE inside the caller's transaction](apps/api/src/domains/audit/service.ts:14)), e o volume de movimentações de quadro a transformaria em gargalo.
- Estender o enum sem atualizar `CADASTRO_HISTORY_ACTIONS` cria ação invisível.

#### Recomendação
- Fixo. O histórico de etapa, notas e follow-ups entram em tabelas novas de eventos do lead (fase 1b). `audit_log` só recebe ações novas aditivas, se necessário.

#### Risco
- **baixo**: enum aditivo e tabela intocada.

## 4. Pendências de risco alto

Cada item abaixo permanece sem alteração nesta run e vira pendência do relatório final.

| # | Item | Por que é alto | Caminho conservador | O que desbloquearia |
| --- | --- | --- | --- | --- |
| P1 | Unificar `leads` (legado de finder) com `sales_ops_leads` | Risco alto por definição do pedido; PII com CPF e anonimização, política de INSERT público do webhook, sem leitor atual, status sem equivalente nas etapas | Não unificar nem copiar; `leads` fica intacta e fora da fase 1c | Decisão do dono sobre LGPD e sobre mostrar indicações no CRM por visão de leitura |
| P2 | Qualquer mudança em `fxl-sales.obligation.*` e `fxl-sales.settlement.*` | Risco alto por definição; contrato consumido pelo FXL Finance com chaves de idempotência por revisão | Não alterar nomes, payload, chaves, construtores nem o feed | Versão nova do contrato negociada com o Finance |
| P3 | `sales_ops_payables`, `sales_ops_receivables`, `sales_ops_settlements` | Risco alto por definição; gatilhos `FXS01` e `FXS02`, FKs restrict, redutor espelhado do Finance | Nenhuma coluna, índice, política ou gatilho novo | Decisão do dono e plano de migração com dados reais |
| P4 | `sales_ops_sales`, itens e profissionais (estado, totais, código) | Julgamento: materializa o ledger e o evento do Finance; wizard de milhares de linhas travado por testes | Referenciar por `sale_id`; nada de campo dinâmico na proposta | Fase própria de propostas configuráveis |
| P5 | Módulo de afiliados (`finders`, `referral_links`, `clicks`, `conversions`, `commissions`, `payouts`) | Julgamento: dinheiro de terceiros, webhook HMAC, redirect público, RLS cruzada | Fora do escopo do CRM; sem alteração | Decisão do dono sobre o futuro do módulo de afiliados |
| P6 | Desligar `finders` e `proposals` por módulo no banco (fase 3) | Depende das capabilities atuais e da compatibilidade do token | Fase 3 mantém o contrato `edition_capability` | Plano da fase 3 |

Dados reais (nada disto é executado nesta run): volumes, tempo e ordem de deploy da migração, rollback, backfill das flags de módulo a partir do Hub, ativação com Construbom e ECV Control.

## 5. Restrições para o modelo (1b)

### 5.1 Migração 0022 e o que ela bloqueia

| Restrição | SQL | Drizzle | O que bloqueia | Exigência para a 1b |
| --- | --- | --- | --- | --- |
| `sales_ops_lead_stages_org_kind_idx` | [CREATE UNIQUE INDEX "sales_ops_lead_stages_org_kind_idx"](apps/api/drizzle/0022_sales_ops_leads.sql:84) | [uniqueIndex('sales_ops_lead_stages_org_kind_idx')](apps/api/src/db/schema.ts:982) | Índice único parcial `(org_id, kind) WHERE kind <> 'normal'`: no máximo uma etapa `conversion` e uma `lost` por org | Etapas de saída novas (ganho, perdido, pausado, várias por funil) vivem em tabela nova |
| `sales_ops_lead_stages_system_kind_check` | [CONSTRAINT "sales_ops_lead_stages_system_kind_check"](apps/api/drizzle/0022_sales_ops_leads.sql:46) | [check('sales_ops_lead_stages_system_kind_check'](apps/api/src/db/schema.ts:986) | `(kind <> 'normal') = is_system`: toda etapa não normal é de sistema e toda normal não é | Tipo e comportamento novos não podem reutilizar `is_system` desta tabela |
| `sales_ops_lead_stages_kind_check` | [CONSTRAINT "sales_ops_lead_stages_kind_check"](apps/api/drizzle/0022_sales_ops_leads.sql:45) | [check('sales_ops_lead_stages_kind_check'](apps/api/src/db/schema.ts:985) | `kind IN ('normal','conversion','lost')`: não aceita `ganho`, `pausado` nem `orcamento` | Ampliar o CHECK exigiria DROP e está proibido; usar coluna `type`/`exit_kind` na tabela nova |
| `sales_ops_lead_stages_org_name_idx` | [CREATE UNIQUE INDEX "sales_ops_lead_stages_org_name_idx"](apps/api/drizzle/0022_sales_ops_leads.sql:81) | [uniqueIndex('sales_ops_lead_stages_org_name_idx')](apps/api/src/db/schema.ts:976) | Nome único por org: dois funis não podem ter etapas com o mesmo nome | Na tabela nova, unicidade por `(org_id, pipeline_id, name)` |
| `sales_ops_lead_stages_org_id_id_idx` | [CREATE UNIQUE INDEX "sales_ops_lead_stages_org_id_id_idx"](apps/api/drizzle/0022_sales_ops_leads.sql:82) | [uniqueIndex('sales_ops_lead_stages_org_id_id_idx')](apps/api/src/db/schema.ts:978) | Alvo da FK composta `(org_id, stage_id)` dos leads | Repetir o padrão de FK composta com `org_id` à frente |
| `sales_ops_leads_org_stage_fk` | [CONSTRAINT "sales_ops_leads_org_stage_fk"](apps/api/drizzle/0022_sales_ops_leads.sql:90) | [name: 'sales_ops_leads_org_stage_fk'](apps/api/src/db/schema.ts:1087) | `sales_ops_leads.stage_id` aponta só para a tabela antiga (`ON DELETE restrict`) | O lead unificado novo tem sua própria FK de etapa; o lead antigo mantém a dele |
| `sales_ops_leads_org_sale_idx` | [CREATE UNIQUE INDEX "sales_ops_leads_org_sale_idx"](apps/api/drizzle/0022_sales_ops_leads.sql:88) | [uniqueIndex('sales_ops_leads_org_sale_idx')](apps/api/src/db/schema.ts:1074) | Uma proposta por lead (índice parcial em `sale_id`) | Preservar a regra de uma proposta por lead na cópia |
| `sales_ops_leads_estimated_value_check` | [CONSTRAINT "sales_ops_leads_estimated_value_check"](apps/api/drizzle/0022_sales_ops_leads.sql:66) | [check('sales_ops_leads_estimated_value_check'](apps/api/src/db/schema.ts:1109) | `estimated_value_brl >= 0` | Campo "valor" dinâmico precisa do mesmo piso |

### 5.2 Leitores de `sales_ops_lead_stages.kind`

API:
- Semente: [export type LeadStageKind](apps/api/src/domains/sales-ops/leads/stages-seed.ts:8), [export const SYSTEM_LEAD_STAGE_KINDS](apps/api/src/domains/sales-ops/leads/stages-seed.ts:35).
- Criação sempre `normal`: [isSystem: false, kind: 'normal'](apps/api/src/domains/sales-ops/leads/stage-service.ts:112).
- Primeira etapa aberta para novo lead: [eq(salesOpsLeadStages.kind, 'normal')](apps/api/src/domains/sales-ops/leads/lead-service.ts:1032).
- Movimentação lê o `kind` do destino: [kind: salesOpsLeadStages.kind](apps/api/src/domains/sales-ops/leads/lead-service.ts:1290), [if (destination.kind === 'lost' && input.reason === undefined)](apps/api/src/domains/sales-ops/leads/lead-service.ts:1305), [if (destination.kind === 'conversion')](apps/api/src/domains/sales-ops/leads/lead-service.ts:1309), [lostReason: destination.kind === 'lost'](apps/api/src/domains/sales-ops/leads/lead-service.ts:1341).
- Importação: [kind: salesOpsLeadStages.kind](apps/api/src/domains/import/catalog.ts:173), [kind: row.kind === 'conversion' || row.kind === 'lost' ? row.kind : 'normal'](apps/api/src/domains/import/catalog.ts:182), [kind: 'normal' | 'conversion' | 'lost'](apps/api/src/domains/import/types.ts:114), [s.kind === 'normal'](apps/api/src/domains/import/plan/leads.ts:59), [.filter((s) => s.kind !== 'conversion')](apps/api/src/domains/import/template.ts:191).
- Seed de desenvolvimento: ['salesOpsLeadStages',](apps/api/scripts/seed/plan.ts:163).
- Banco: [check('sales_ops_lead_stages_kind_check'](apps/api/src/db/schema.ts:985), [uniqueIndex('sales_ops_lead_stages_org_kind_idx')](apps/api/src/db/schema.ts:982).

Web:
- [export type LeadStageKind](apps/web/src/sales-ops/leads/types.ts:25).
- [stages.find((stage) => stage.kind === 'conversion')](apps/web/src/sales-ops/leads/calculations.ts:65).
- [stages.find((stage) => stage.kind === 'lost')](apps/web/src/sales-ops/leads/calculations.ts:72).
- [return stage?.kind === 'lost'](apps/web/src/sales-ops/leads/calculations.ts:81).
- [return stage?.kind === 'conversion'](apps/web/src/sales-ops/leads/board-move.ts:41).
- [const special](apps/web/src/sales-ops/leads/board-ui.ts:263), [return !KIND_COLORS](apps/web/src/sales-ops/leads/board-ui.ts:275).
- Funil: [kind: stage.kind, count, totalBrl](apps/web/src/sales-ops/leads/calculations.ts:265) e [kind: row.kind](apps/web/src/sales-ops/leads/LeadsFunnelView.tsx:62).
- O guard de escrita do quadro varre `kind ===` inline: [describe(](apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts:208).

### 5.3 Leitores de `sales_ops_leads.stage_id`

Banco:
- Índice do quadro e FK composta: [CREATE INDEX "sales_ops_leads_org_stage_position_idx"](apps/api/drizzle/0022_sales_ops_leads.sql:86), [sales_ops_leads_org_stage_fk](apps/api/drizzle/0022_sales_ops_leads.sql:90).

API:
- Schema: [index('sales_ops_leads_org_stage_position_idx')](apps/api/src/db/schema.ts:1071).
- Visão do lead: [stageId: lead.stageId,](apps/api/src/domains/sales-ops/leads/lead-service.ts:610).
- Listagem por coluna: [conditions.push(eq(salesOpsLeads.stageId, query.stageId))](apps/api/src/domains/sales-ops/leads/lead-service.ts:663).
- Resumo por etapa: [.groupBy(salesOpsLeads.stageId)](apps/api/src/domains/sales-ops/leads/lead-service.ts:750).
- Próxima posição: [and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.stageId, stageId), liveLeadCondition())](apps/api/src/domains/sales-ops/leads/lead-service.ts:1051).
- Movimentação: [const stageChanged = destination.id !== current.stageId](apps/api/src/domains/sales-ops/leads/lead-service.ts:1330), [if (stageChanged) await renumberStage(tx, orgId, current.stageId, null)](apps/api/src/domains/sales-ops/leads/lead-service.ts:1349), renumeração [export async function renumberStage(](apps/api/src/domains/sales-ops/leads/lead-service.ts:1369).
- Lixeira e restauração: [const fromStage = await stageName(tx, orgId, current.stageId)](apps/api/src/domains/sales-ops/leads/lead-trash-service.ts:105), [const stageChanged = target.id !== current.stageId](apps/api/src/domains/sales-ops/leads/lead-trash-service.ts:192), [eq(salesOpsLeadStages.id, salesOpsLeads.stageId)](apps/api/src/domains/sales-ops/leads/lead-trash-service.ts:273).
- Rota e schemas de listagem e movimentação: [stageId: c.req.query('stageId'),](apps/api/src/domains/sales-ops/leads/lead-routes.ts:140), [stageId: uuid,](apps/api/src/domains/sales-ops/leads/lead-schemas.ts:90) (`MoveLeadSchema`), [stageId: uuid,](apps/api/src/domains/sales-ops/leads/lead-schemas.ts:114) (`ListLeadsQuerySchema`).
- Importação e seeds escrevem por `createLead`/`moveLead`: [stageId: resolve(operation.stageRef, operation),](apps/api/src/domains/import/executor.ts:335), [stageId: stageIdBySlug.get('novo')!,](apps/api/scripts/seed/plan.ts:1478).

Web:
- Tipos e API: [export type SalesOpsLead =](apps/web/src/sales-ops/leads/types.ts:62), [export type MoveLeadPayload](apps/web/src/sales-ops/leads/api.ts:98).
- Otimismo e reversão: [moving.stageId === payload.toStageId](apps/web/src/sales-ops/leads/optimistic.ts:66).
- Chamada da API por coluna: [search.set('stageId', params.stageId)](apps/web/src/sales-ops/leads/api.ts:139) e [stageId: stage.id,](apps/web/src/sales-ops/leads/hooks.ts:122).
- Cálculos e agregados por etapa: [export function groupLeadsByStage](apps/web/src/sales-ops/leads/calculations.ts:28), [export function aggregatesFromSummary](apps/web/src/sales-ops/leads/calculations.ts:190).
- Quadro, container, funil e diálogo de mover: [lead.stageId](apps/web/src/sales-ops/leads/LeadsBoard.tsx:208), [row.stageId === previous.stageId](apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx:240), [colors.get(row.stageId)](apps/web/src/sales-ops/leads/LeadsFunnelView.tsx:134), [lead.stageId === toStageId](apps/web/src/sales-ops/leads/board-move.ts:110), [initialStageId ?? lead.stageId](apps/web/src/sales-ops/leads/MoveLeadDialog.tsx:75).
- A URL carrega o id da etapa no terceiro segmento: [export function buildLeadStagePath](apps/web/src/sales-ops/navigation.ts:268), [activeStageId={view === 'leads'](apps/web/src/sales-ops/SalesOpsApp.tsx:1952).

### 5.4 Demais restrições para a fase 1b

- Migrações novas começam em 0029 (a última do journal é a 0028): ["tag": "0028_lead_soft_delete"](apps/api/drizzle/meta/_journal.json:205); existe runner faseado em [const phasedHeader](apps/api/src/db/migration-runner.ts:79).
- Só `CREATE`, `ADD COLUMN` nulo ou com default, `INSERT ... ON CONFLICT DO NOTHING` e `UPDATE` de backfill em colunas novas; nada de GRANT ou ROLE.
- Molde de RLS para tabela nova: FORCE mais duas políticas, `tenant_isolation` em `app.current_org_id` e `admin_context` em `app.fxl_admin`: [CREATE POLICY sales_ops_leads_tenant_isolation](apps/api/drizzle/0022_sales_ops_leads.sql:108), [CREATE POLICY sales_ops_leads_admin_context](apps/api/drizzle/0022_sales_ops_leads.sql:112).
- FKs compostas com `org_id` à frente e alvo `UNIQUE (org_id, id)`: [CREATE UNIQUE INDEX "sales_ops_leads_org_id_id_idx"](apps/api/drizzle/0022_sales_ops_leads.sql:85).
- Todo escritor novo de `stage_id` ou `position` tem de pegar o lock por quadro antes de qualquer lock de linha: [export async function lockLeadBoard](apps/api/src/domains/sales-ops/leads/lead-service.ts:1008); oráculo `leads-move-concurrency.test.ts` - [sales operations leads: concurrent board writes never deadlock and keep columns dense](apps/api/test/rls/leads-move-concurrency.test.ts:69).
- O escopo do vendedor é um predicado servidor único: [function leadSellerCondition](apps/api/src/domains/sales-ops/leads/lead-service.ts:802); novos leitores de lead devem passar por ele e por [export function liveLeadCondition](apps/api/src/domains/sales-ops/leads/lead-service.ts:522).
- A edição é derivada do token por request e não pode ser lida do corpo: [c.set('salesEdition', resolveSalesEdition(auth.entitlements?.modules))](apps/api/src/middleware/app-auth.ts:276); o gate é [export function requireCapability](apps/api/src/middleware/require-capability.ts:26) e o corpo do 403 é [export const EDITION_CAPABILITY_BODY](apps/api/src/middleware/require-capability.ts:9).
- Os oráculos de edição que a fase 3 precisa preservar: `edition-gate-map.test.ts` - [the gate map is exhaustive](apps/api/src/middleware/__tests__/edition-gate-map.test.ts:325), `navigation-edition.test.ts` - [full edition is exactly today (FXL)](apps/web/src/sales-ops/__tests__/navigation-edition.test.ts:481).
- `/leads` e `/lead-stages` não têm `requireCapability` hoje; os dois contratos de escrita (`full` e `contact`) são escolhidos por `leadFieldSet`: [leadFieldSet(c.get('salesEdition') ?? 'full') === 'contact'](apps/api/src/domains/sales-ops/leads/lead-routes.ts:98).
- Quem semeia etapas, e quando, é definido por [export async function ensureLeadStages(](apps/api/src/domains/sales-ops/leads/stages-seed.ts:62) e pelos chamadores listados na seção 3.3; a fase 1b não deve assumir org com etapas.
- Nada pode tocar `fxl-sales.obligation.*`, `fxl-sales.settlement.*`, `sales_ops_payables`, `sales_ops_receivables`, `sales_ops_settlements`, nem a tabela legada `leads`.
- Teste de migração modelo para a fase 1c: `leads-schema-migration.test.ts` - [leads schema migration 0022](apps/api/test/rls/leads-schema-migration.test.ts:39).

## 6. Perguntas abertas para o dono (não bloqueiam a 1b)

- O contato do lead obriga pelo menos um entre telefone e e-mail? Hoje os dois são opcionais ([const ContactPhoneSchema](apps/api/src/domains/sales-ops/leads/lead-schemas.ts:178)).
- Contato deve virar entidade separada (vários contatos por empresa) ou continua um conjunto de campos do lead?
- Indicações de finder devem aparecer no CRM? Se sim, por visão somente leitura sobre `conversions` e `clicks`, sem PII.
- Orçamento (etapa de tipo orçamento) cria a proposta pelo mesmo `POST /sales` da conversão atual, ou haverá um orçamento sem proposta?
