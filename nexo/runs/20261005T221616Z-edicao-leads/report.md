# Relatório: edicao-leads

## Status da solicitação
pass · Tudo o que foi pedido foi entregue em master: 11 slices (8 planejadas + 3 inseridas), cada uma com Verify independente, 4 gates de wave verdes, mutação 22/22; nada enviado com push nem promovido.
Pedido: Edição Leads (Construbom): perfil de produto resolvido do módulo Hub sales.edition.leads

## Entregue
- 01-edition-contract  fd3113e  Resolvedor puro da edição (`sales.edition.leads` vira leads; qualquer outra coisa vira full) e as capacidades, em shared-utils.
- 03-lead-contact-columns  e3fc2aa  Migração 0027 aditiva: telefone, email e data de aniversário anuláveis no lead; dados da FXL intocados.
- 02-api-edition-gate  475fba4  API resolve a edição por requisição e responde 403 edition_capability em propostas, comissões, baixas, catálogo, importação e finder só na edição leads.
- 05-web-edition-navigation  35d3fb8  Web lê a edição do token; gestor vê só Prospecção, Vendedores e Etapas, vendedor só Minha prospecção; navegação da FXL idêntica (oráculo literal).
- 04-api-leads-edition  a66f184  Lead com Nome, Aniversário, Número, Email, Descrição e Vendedor na edição leads; pessoa sempre vendedor; quadro começa sem etapas.
- 08-dev-identity-and-playbook  4265da2  Identidades leads-owner e leads-seller no make dev-fake e o playbook de ativação no Hub (SKU R$0 + SQL testado com rollback).
- 08.1-hermetic-finance-fixture-tests  bc5f9c5  Testes de integração Finance herméticos: o seed de desenvolvimento não quebra mais a suíte (defeito antigo exposto pela run).
- 06-web-leads-contact-ui  b458ec0  Diálogo, cartão e lista com dados de contato, sem R$; estado vazio do quadro para gestor e vendedor.
- 07-web-pessoas-vendedores  a47be8d  Tela Vendedores (sem funções, com Reativar); caminhada no navegador; corrigido o chip de fase branco no branco que já existia para a FXL.
- 07.1-seller-own-lead-defaults  c121f9c  Vendedor cria lead só com o nome e o lead já é dele; diálogo não perde dados em erro; Mover sem erro precoce.
- 07.2-contact-dialog-no-premature-error  2a13e45  Novo lead da edição leads não abre mais com erro vermelho.

## Não feito e por quê
- nada a registrar.

## Decisões tomadas sem você
- Módulos ausentes ou desconhecidos resolvem para full; a edição é derivada do token a cada requisição e nunca gravada no banco do Sales. (nexo/knowledge/decisions/2026-10-05-sales-editions-from-hub-module.md)
- Se o Hub deixar de mandar o módulo, a org vê o produto completo (fail-open aceito e documentado). (nexo/runs/20261005T221616Z-edicao-leads/AUDIT.md)
- Na edição leads o admin (gestor) não vê Meus dados; ele vê todos os leads em Operacional. (CLAUDE.md ## Edição Leads)
- Na edição leads toda pessoa é vendedor (o servidor atribui a função), e o lead criado por um vendedor sem vendedor informado é dele. (CLAUDE.md ## Edição Leads)
- Reutilizado o erro existente 400 no_open_stage em vez de criar 409 no_stage. (nexo/plans/edicao-leads/SEAM-CONTRACT.md)
- A falha do gate da wave 3 era isolamento de testes, não produto: não houve revert; entrou a slice 08.1. (nexo/runs/20261005T221616Z-edicao-leads/AUDIT.md)
- Ajustes visuais feitos no caminho: cromo de proposta oculto na edição leads, linhas inativas legíveis, chip de fase ativo corrigido nas duas edições. (nexo/runs/20261005T221616Z-edicao-leads/AUDIT.md)

## Perguntas
1. Inverter o fail-open, persistindo a edição por org no Sales para que a Construbom nunca veja o produto completo se o módulo sumir?
   a) Sim, como item do ROADMAP (já registrado)
   b) Não, o Hub é a única fonte
   c) outra: ___
2. Construir no Hub a ação de admin auditada para conceder módulo grátis (substitui o SQL do playbook)?
   a) Sim, rodar no repo do Hub
   b) Depois
   c) outra: ___
3. O audit mostra 7 avisos high em dependências de desenvolvimento transitivas (postcss, eslint, typescript-eslint, tsc-alias), iguais antes e depois desta run. Agendar uma atualização de dependências?
   a) Sim
   b) Não agora
   c) outra: ___

Responda para retomar: <n><k>
