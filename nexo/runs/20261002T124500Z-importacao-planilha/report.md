# Relatório: importacao-planilha

## Status da solicitação
pass · Tudo o que foi pedido está no master local: modelo xlsx (em branco e com exemplo), prévia com erros por aba/linha/coluna, importação tudo-ou-nada só-criar do básico ao completo, e a tela Cadastros > Importação. 11 slices, 6 waves verdes, mutation 90% com os sobreviventes cobertos; sem push, sem release.
Pedido: Importação por planilha (onboarding + sob demanda) no FXL Sales

## Entregue
- 01-contract-and-parser  cb26441  Dependência exceljs fixada, a definição única das 13 abas e colunas, e o parser que transforma o xlsx em linhas tipadas com erros em português.
- 02-catalog-refs-cadastros  0a4b18a  Leitura do catálogo da org, resolução de referências por nome (produto também por código) e o planejamento dos cadastros (áreas, funções, produtos, custos, pessoas, clientes, etapas).
- 08-template  6c4ec4a  Gerador do modelo: aba Leia-me, cabeçalhos, listas suspensas com os cadastros atuais e um exemplo completo e coerente.
- 09-web-import-view  b77fb06  Tela Cadastros > Importação: baixar modelos, enviar, prévia com contagens e erros agrupados, confirmar e ver o resumo.
- 03-plan-leads  b790a04  Planejamento da aba Leads (etapa, motivo da perda, vendedor, empresa em texto livre).
- 04-plan-propostas  088e9d6  Planejamento de propostas do básico (só cliente, vendedor e produto, com os padrões do wizard) ao completo (itens, profissionais, parcelas, recorrência).
- 06-executor  624aaed  Executor que grava tudo numa transação pelos serviços de domínio existentes, com auditoria import.completed e rollback total.
- 05-plan-desfechos  0f28d68  Ganha (com dia histórico), Perdida, Cancelada e Pagamentos como baixas; bloqueio para orgs conectadas ao Finance.
- 07-routes-and-roundtrip  daaca93  Rotas de modelo, prévia e importação só para admin, com o teste de ida e volta do modelo de exemplo numa org nova.
- 09.1-web-409-detail  7338cfa  Quando a gravação recusa uma linha, a tela mostra qual aba e linha.
- 10-mutation-survivors  1f4f96d  Cinco testes novos que cobrem as lacunas achadas pelo mutation testing.

## Não feito e por quê
- nada a registrar.

## Decisões tomadas sem você
- A escrita reutiliza os serviços de domínio numa transação única; nenhum INSERT direto. (nexo/runs/20261002T124500Z-importacao-planilha/AUDIT.md)
- Org conectada ao Finance: Ganha e Pagamentos são recusados; Perdida e Cancelada permitidas (provado que não emitem). (nexo/runs/20261002T124500Z-importacao-planilha/AUDIT.md)
- Org nova sem etapas e sem Vendedor/Finder: as rotas de importação semeiam ambas na transação; prévia e modelo fazem rollback. (nexo/plans/importacao-planilha/SEAM-CONTRACT.md)
- Override de brace-expansion subiu para 1.1.21 para zerar os avisos altos que o exceljs trazia; fica 1 moderado (uuid). (pnpm-workspace.yaml)
- Nome já existente em área, função, produto ou etapa é erro (só-criar); cliente e pessoa repetidos são aviso. (CLAUDE.md)
- Slices 09.1 e 10 adicionados durante a execução, a partir da revisão de plano e do mutation testing. (nexo/runs/20261002T124500Z-importacao-planilha/run.md)

## Perguntas
1. O botão de confirmação dos diálogos (Importar, Arquivar, Restaurar) é azul, e os primários do app são escuros ou âmbar. Uniformizar o componente?
   a) Sim, usar o estilo primário do app
   b) Não, o azul é intencional
   c) outra: ___
2. Numa org nova, o quadro de leads e Pessoas também ficam sem etapas e sem Vendedor/Finder fora da importação. Semear no primeiro acesso da org?
   a) Sim, colocar no ROADMAP
   b) Não, só pela importação
   c) outra: ___
3. O hash da cadeia de auditoria não cobre o conteúdo de beforeJsonb/afterJsonb (bug pré-existente em canonicalJson). Corrigir com versionamento da cadeia?
   a) Sim, colocar no ROADMAP
   b) Não
   c) outra: ___

Responda para retomar: <n><k>
