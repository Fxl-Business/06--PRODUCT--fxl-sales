# Relatório: vendas-crm-unificado

## Status da solicitação
park · Fases 0 a 3 entraram no master local (73a009a, c15a0ca, 60c57fd, 3dc3739), cada slice com Verify sonnet separado e cada fase com review Codex gpt-6-astra high aprovado; a Fase 4 ficou estacionada: slice 13 construída mas reprovada no Verify por um teste faltante, slice 14 não executada, ambas por fim do orçamento de 64 agentes. Custo: 0 tokens de API paga (assinaturas Claude e ChatGPT), 64 agentes, 12 rodadas Codex. Nada foi para staging ou produção.
Pedido: FXL Vendas: CRM unificado (v1) - .nexo/tmp/vendas-crm-prompt-v1.md

## Entregue
- 01-marca-fxl-vendas  360818f  Todo texto visível passa a dizer FXL Vendas (UI, i18n, planilha modelo, título, nomes de download); um teste guarda os ids técnicos fxl-sales, eventos, envs e chaves de storage inalterados.
- 02-etapas-seed-on-read  88def04  Bug ECV corrigido: GET /lead-stages e o bootstrap semeiam as etapas padrão de uma org sem etapas, sem duplicar, sem reinserir renomeadas e sem erro em leituras simultâneas.
- 03-funil-padrao-e-guard-aditivo  6620a8f  Funil CRM padrão (Novo, Qualificação, Em negociação, Proposta, Ganho, Perdido, Pausado) como constante única com teste de paridade, e um guard que reprova migrações novas com DROP, DELETE, TRUNCATE, RENAME ou GRANT.
- 03.1-wave1-minors  eb1a1c6  Correções menores apontadas pelo review da wave 1.
- 04-levantamento-entidades  4785f91  Levantamento crítico de 13 entidades com 672 citações conferidas, risco por entidade e pendências de risco alto, aprovado por um Verify separado antes de qualquer modelo.
- 05a-crm-schema-migracao  7ceac6d  ADR e dez tabelas novas (funis, etapas tipadas, transições, campos dinâmicos, lead unificado, histórico, notas, follow-ups, módulos por org) na migração 0029, 100% aditiva, com RLS.
- 05b-crm-defaults-servicos  963affe  Funil padrão e campo Cliente (não removível) semeados de forma idempotente, mais o vocabulário de módulos.
- 06-migracao-dados-crm  58c8ec1  Migração 0030 copia etapas e leads atuais para o modelo novo sem tocar nas origens, com teste de migração sobre dados sintéticos (tabelas de origem idênticas, somas batendo, ledger e outbox intactos, RLS, idempotência).
- 06.1-fase1-review-fixes  d4e6142  Correções do review Codex da Fase 1: índice de texto sem estourar o B-tree e nomes livres para as etapas de saída migradas.
- 07a-api-crm-cutover  7899e78  A API passa a ler e gravar leads e etapas só nas tabelas novas; a 0031 recopia e ressincroniza o que mudou nas tabelas antigas, que ficam congeladas.
- 07b-api-pipeline-historico-followups  2cffa94  Rotas de funis, campos, resumo do lead, Avançar só por transições válidas (409 fora do grafo), histórico gravado pelo servidor, notas, follow-ups com data obrigatória e filtros de período em dias de São Paulo.
- 08-web-lead-form-unico  834ad68  Um único formulário de lead nas duas edições: nome e contato obrigatórios, empresa criada ao digitar, contato pré-preenchido ao escolher a empresa, campos dinâmicos por tipo, Cliente sempre presente.
- 09-web-lead-resumo  261c9b0  Clicar no card abre o resumo do lead (etapa, histórico com notas, Avançar com próximo passo e data) e há uma agenda de follow-ups Minha/Equipe com filtro de período.
- 10-web-kanban-funil-periodo  4dfe1f5  O Kanban é uma visão do funil escolhido, com filtro de período; Proposta e Vendido separados pelo tipo da etapa; cada lista de Propostas tem rota própria.
- 10.1-fase2-review-fixes  8d92828  Correções do review Codex da Fase 2: funil padrão resolvido primeiro, etapa restaurada ganha transições, dono do follow-up pode concluí-lo, desfazer só quando reversível.
- 11-api-modulos-org  a8e9621  Módulos por organização no banco decidem as capacidades; o token só faz o backfill inicial; trocar uma flag muda o 403 sem redeploy, e só operadores da FXL podem trocar.
- 12-web-modulos-navegacao  36bb54f  A navegação vem de um catálogo único filtrado por módulo; Construbom vê exatamente o que via antes mais as novidades da Fase 2.
- 12.1-fase3-review-fixes  4362da7  Correções do review Codex da Fase 3 (Nova proposta e card de comissões seguem os módulos certos) e stage_changed_at gravado com o relógio do banco, eliminando um teste intermitente.

## Não feito e por quê
- 13-dias-sem-comprar  park · budget
  Construída com todas as suítes verdes, mas o Verify separado reprovou por falta de um teste (lead ganho soft-deletado não pode contar); o orçamento de 64 agentes acabou antes da rodada de correção, então não foi integrada. Branch feat/6q75vnog-13-dias-sem-comprar mantido. Audit: nexo/runs/20261021T011348Z-vendas-crm-unificado/AUDIT.md
- 14-importacao-mapeamento  park · budget
  Importação com mapeamento de colunas para campos e etapas: plano e plan-check prontos, não executada por fim do orçamento. Audit: nexo/runs/20261021T011348Z-vendas-crm-unificado/AUDIT.md

## Decisões tomadas sem você
- O lead unificado mora em tabelas novas, copiadas com os mesmos ids; as tabelas antigas ficam intactas e congeladas. (nexo/knowledge/decisions/2026-10-21-crm-unificado-modelo.md) (escolhido: a; alternativas: b) colunas novas em sales_ops_leads)
- A 0031 recopia e RESSINCRONIZA as linhas mudadas nas tabelas antigas depois da 0030; uma remoção feita na tabela antiga não é espelhada. (nexo/runs/20261021T011348Z-vendas-crm-unificado/AUDIT.md) (escolhido: a; alternativas: b) escrita dupla até o corte)
- Trocar módulos exige admin E estar na lista de operadores SALES_MODULE_OPERATOR_ACCOUNT_IDS, vazia por padrão. (nexo/runs/20261021T011348Z-vendas-crm-unificado/AUDIT.md) (escolhido: a; alternativas: b) qualquer admin da org)
- Dias sem comprar considera a última venda ganha E o último lead vivo do cliente em etapa de saída ganho. (nexo/plans/vendas-crm-unificado/13-dias-sem-comprar.md) (escolhido: a; alternativas: b) só venda ganha)
- Valores de campos dinâmicos são linhas tipadas (EAV) e o Cliente é um campo de sistema apoiado na coluna client_id. (nexo/knowledge/decisions/2026-10-21-crm-unificado-modelo.md) (escolhido: a; alternativas: b) JSONB com GIN)
- O agents gate do Nexo estava inválido (chave desconhecida no agents.json global); o review rodou via codex exec gpt-6-astra high read-only, como o pedido prevê. (nexo/runs/20261021T011348Z-vendas-crm-unificado/AUDIT.md)
- Cada fase entrou no master local separadamente via nexo-trunk-merge.sh, e as fases 2 a 4 foram planejadas só depois do levantamento aprovado, consolidadas em fatias com partes para caber no orçamento. (nexo/runs/20261021T011348Z-vendas-crm-unificado/AUDIT.md)

## Perguntas
1. O cliente/empresa deve ganhar um vendedor responsável para que escolher a empresa pré-preencha também o responsável?
   a) sim, campo novo no cliente
   b) não, só contato
   c) outra: ___
2. Comissões, Clientes e Leads excluídos também precisam de filtro de período?
   a) sim, as três
   b) só Comissões
   c) não
   c) outra: ___
3. Excluir um lead pela página de resumo deve oferecer Desfazer?
   a) sim
   b) não, basta Leads excluídos
   c) outra: ___
4. Quais contas de operador FXL entram em SALES_MODULE_OPERATOR_ACCOUNT_IDS para poder trocar módulos?
   c) outra: ___

Responda para retomar: <n><k>
