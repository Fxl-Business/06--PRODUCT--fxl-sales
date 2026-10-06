# Autopilot audit - run 20261005T221616Z-edicao-leads

Feature: Edição Leads (Construbom).
Mode: autopilot (Gate 1 skipped by explicit request; Gate 2 per slice and per wave; Gate 3 untouched).

## Para testar / fazer

- [ ] Ative a Construbom no Hub de PRODUÇÃO seguindo `nexo/playbooks/ativar-edicao-leads.md` (SKU de R$ 0, concessão de acesso e o SQL do módulo `sales.edition.leads`), e anote o id do workspace da Construbom no Hub.
- [ ] A migração 0027 (três colunas nulas em `sales_ops_leads`) é aplicada no deploy; é aditiva e os dados da FXL ficam intocados.
- [ ] Depois do deploy, entre como gestor da Construbom: crie as etapas do funil e cadastre os vendedores com o e-mail de login deles.
- [ ] Adicione cada vendedor ao workspace no Hub com o papel de produto `seller`; no primeiro acesso o e-mail liga a pessoa à conta.
- [ ] Como FXL, faça um teste de fumaça de Propostas, Prospecção e Pessoas: devem estar iguais a antes.
- [ ] Localmente, `make dev-fake` oferece as identidades `leads-owner` e `leads-seller`. A org local `org_fake_leads` guarda dados de teste da caminhada no navegador; rode o seed de novo para zerar.
- [x] E2E no navegador depois da 07.1 (`make dev-fake`), feito por um agente: vendedor cria lead só com Nome, sem campo Vendedor, e o lead aparece no quadro dele; email inválido mantém o diálogo aberto com os valores; "Mover para" sem erro antes de interagir; gestor vê o campo Vendedor; team-owner (FXL) com empresa, produtos e valor como antes; sem erros no console.
- [x] O mesmo E2E achou "Informe o nome." em vermelho ao abrir o Novo lead da edição leads; corrigido na slice 07.2 (`2a13e45`), verificada e com o gate final verde (unit 3300, integração 348, lint 0, build ok).
- [ ] O banco local tem dados de teste das caminhadas no navegador (`org_fake_leads` com 2 etapas, Ana Lima e leads; um lead "Teste E2E Alfa"). Rode o seed de desenvolvimento se quiser voltar ao estado inicial.

## Decisões tomadas sem você

- D1: módulo ausente, vazio ou desconhecido resolve para `full`; a edição é derivada por requisição do token verificado e nunca é gravada nem lida de um corpo.
- D2: a direção fail-open foi aceita: se o Hub parar de enviar o módulo, a org vê o produto completo. Os dados continuam válidos, pois a edição leads só escreve leads, pessoas e etapas.
- D3: o schema de escrita de lead da edição full ficou idêntico (continua rejeitando as chaves novas com `.strict()`); os campos de contato só entram no schema da edição leads. As leituras de lead ganham as três chaves novas, nulas para a FXL.
- D4: na edição leads toda Pessoa é vendedor: o servidor atribui a função de sistema `vendedor` (semeando as funções na mesma transação) e a web não mostra seletor de função. O convite continua no Hub.
- D5: `GET /bootstrap` e `GET /settings` ficam abertos na edição leads; o resto que é de proposta, comissão, baixa, catálogo, importação ou finder legado responde `403 edition_capability`.
- D6: a migração é aditiva e entra no deploy normal, listada aqui como fato de deploy.
- D-07.1a: o vendedor da edição leads cria lead sem escolher vendedor; o servidor atribui à pessoa dele (só em `createContactLead`, só para vendedor com escopo e sem pessoa informada; outro id explícito continua `seller_scope`).
- D-07.1b: o seletor de Vendedor fica oculto para quem não é admin.
- D-07.1c: o diálogo de lead continua aberto, com os valores e um erro inline, quando o salvamento é recusado.
- D-07.1d: o diálogo "Mover para" não mostra erro vermelho antes da primeira interação (só a exibição da recusa foi condicionada; a regra de mover não mudou).
- D-07.1e: rótulos de acessibilidade (`aria-label`) nos controles novos.
- D-07.2: no diálogo de lead da edição leads, cada erro só aparece depois que o campo muda (ou depois de Salvar); Salvar continua desabilitado enquanto o rascunho é inválido.
- O orçamento de replanejamento (3 de 3) foi usado por 08.1, 07.1 e 07.2.
- Correções visuais feitas na caminhada: linhas inativas de Vendedores, chrome completo escondido na edição leads (a pagar este mês, "Nova proposta" da sidebar, chip de mês), e o chip da fase ativa da Lista, que estava branco sobre branco na master e foi corrigido nas duas edições.
- 08.1: o isolamento de teste da wave 3 foi corrigido com testes, sem mexer em produto (purga da org fixture antes e depois do `finance-integration`, checagem de eco do consumer limitada às próprias orgs, `afterAll` apaga as linhas de auditoria da edição leads).
- Um admin da edição leads não vê `meus-dados`; um finder sem outra função fica em `/no-role`.
- Se o módulo sumir do token, a org volta a `full` (fail-open, ver D2).
- A recuperação de wave (1 de 1) foi usada na wave 3; o orçamento de recuperação está esgotado para este run.
- Alternativas B e C do `00-OVERVIEW.md` ficaram de fora, conforme o ADR.

## Perguntas

1. A direção fail-open deve ser invertida persistindo a edição por org? (a) Sim, tabela ou coluna por org no Sales, com o Hub só como gatilho de ativação. (b) Não, o Hub segue como única fonte e o fail-open fica documentado.
2. O Hub precisa de uma ação de admin auditada para conceder módulo grátis a um workspace, no lugar do SQL do playbook. Abrir no roadmap do Hub? (a) Sim. (b) Não, o SQL basta para uma org.
3. A auditoria mostra 7 avisos altos, todos de dependências transitivas de ferramentas de desenvolvimento (nanoid via postcss, browserslist via babel, js-yaml via eslint, brace-expansion, braces via tsc-alias), pré-existentes. Agendar uma atualização de dependências? (a) Sim, como item do ROADMAP. (b) Não.

## Pronto para release

- [ ] `/nexo-ship` quando quiser cortar a versão (milestone v4.3.0). Nada foi enviado com push, promovido ou tagueado.
- Lembrete: a Vercel builda a web a partir da branch `production` (a master está desabilitada) e a produção roda na AWS, enquanto o staging fica em Hetzner/Coolify; verde local não é verde de deploy.
