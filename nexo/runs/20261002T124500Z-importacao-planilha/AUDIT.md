# Autopilot audit - run 20261002T124500Z-importacao-planilha

Feature: Importação por planilha (onboarding e sob demanda).
Mode: autopilot (Gate 1 skipped by explicit request; Gate 2 per slice and per wave; Gate 3 untouched).

## Para testar / fazer

- [ ] Rode `pnpm install` no checkout principal depois deste merge: a feature adiciona `exceljs@4.4.0` à API, e sem a instalação o `make dev` / `make dev-fake` falha ao subir com `Cannot find package 'exceljs'` (visto no teste de ponta a ponta).
- [ ] Teste no navegador já feito pelo orquestrador (`make dev-fake`, identidade `team-owner`): baixar modelo em branco e com exemplo, validar o exemplo (erro `duplicate_existing` da função "Desenvolvedor", que já existe na org seed), validar uma cópia sem conflito, importar (31 registros, 201), ver as 5 propostas na lista com os cinco status, abrir a Ganha e ver as baixas "Pago em 20/01/2026", e validar o modelo em branco ("A planilha não tem linhas para importar."). Se quiser, repita numa org nova de verdade (onboarding real) com o modelo de exemplo.
- [ ] A org de desenvolvimento local da identidade `team-owner` agora tem os 31 registros importados no teste. Rode `make db-reset` / o seed se quiser voltar ao estado original.

## Decisões tomadas sem você

- D1: a escrita reutiliza os serviços de domínio dentro de uma transação `withTenant` (o `withTenant` aninhado vira savepoint); nenhum INSERT direto em tabelas de negócio.
- D2: numa org com a integração Finance ativa, propostas Ganhas e Pagamentos são recusados na prévia (`producer_flow_live`) e de novo no executor; Perdida e Cancelada são permitidas porque o planejamento provou que não emitem eventos.
- D3: proposta Ganha histórica criada com `won_at` = dia informado ao meio-dia em São Paulo; dia futuro é erro.
- D4: pagamentos viram baixas pelo `applyBaixaTx` com a política manual (origem `manual`, mesmo formato da migração 0024). Repasses de custos avulsos sem parcela ficam fora da v1.
- D5/D6: cadastro com nome já existente (ativo ou arquivado, para área, função e etapa) é erro; cliente e pessoa com nome ou documento igual geram aviso; referência a registro arquivado é erro.
- D7: lead não pode ser importado na etapa de conversão; lead em Perdido exige motivo.
- D8: nenhuma migração de banco; `import.completed` é só uma adição ao enum zod.
- D11/D11b: uma org nova não tem etapas nem as funções Vendedor e Finder (nenhum código de produção as semeia). As rotas de importação semeiam ambas dentro da transação; a prévia e o download do modelo fazem rollback, então continuam sem gravar nada.
- A proposta do planejador do executor (refs `system:` e o executor semeando) foi rejeitada a favor da D11/D11b, para manter uma única função `ensureSystemFuncoes` e o executor sem escrita própria.
- Segurança: o `exceljs` trazia 2 avisos altos via `brace-expansion`; o override já existente no `pnpm-workspace.yaml` subiu para `1.1.21`. Fica 1 aviso moderado novo (`exceljs > uuid`), porque corrigir exigiria trocar a major do `uuid` sob o `exceljs`.
- Para economizar tempo, alguns slices começaram a construção antes do revisor de plano terminar (01, 09, 02 e 08). Todos passaram pelo Gate 2 depois que as correções do revisor foram aplicadas.
- Slices adicionados durante a execução: 09.1 (o 409 mostra a aba e a linha recusadas) e 10 (testes para os sobreviventes do mutation testing).

## Perguntas

1. O botão de confirmação dos diálogos (`AlertDialogAction`, compartilhado por Importar, Arquivar e Restaurar) é azul, enquanto os botões primários do app são escuros ou âmbar. Uniformizar? (a) Sim, deixar o componente com o estilo primário do app. (b) Não, o azul é intencional para confirmações.
2. Lacuna fora desta feature: numa org nova, o quadro de leads e o cadastro de Pessoas também ficam sem etapas e sem as funções Vendedor e Finder, porque `ensureLeadStages` e a semeadura das funções do sistema não têm chamador em produção (a importação agora semeia ambas). Corrigir no app em geral, semeando no primeiro acesso da org? (a) Sim, como item do ROADMAP. (b) Não, só pela importação.
3. Achado pré-existente na auditoria: `canonicalJson` em `apps/api/src/domains/audit/service.ts` usa `JSON.stringify(obj, keys)`, e a lista de chaves filtra também os objetos aninhados. Por isso o conteúdo de `beforeJsonb` e `afterJsonb` não entra no `entry_hash` de nenhuma entrada. A cadeia continua consistente, mas não protege esses dados. Corrigir (exige rehash ou versionamento da cadeia)? (a) Sim, como item do ROADMAP. (b) Não.

## Pronto para release

- [ ] `/nexo-ship` quando quiser cortar a versão (o milestone v4.2.0 inclui também o redesign da Prospecção, entregue por outro run). Nada foi enviado com push, promovido ou tagueado.
