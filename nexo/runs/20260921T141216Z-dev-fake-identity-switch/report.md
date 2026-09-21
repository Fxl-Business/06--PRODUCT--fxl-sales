# Relatório: dev-fake-identity-switch

## Status da solicitação
pass · Entregue e em master. Oito slices, todos verdes por Verify separado; tres defeitos reais foram achados por verificacao e nao por suite verde, e um deles so aparecia rodando o produto.
Pedido: Modo dev-fake em fxl-sales: poder desenvolver e revisar o produto localmente SEM nenhum Hub no ar, com um seletor no browser que troca a identidade adotada (e portanto o conjunto de papeis) para alcancar as telas que so alguns cargos veem.

## Entregue
- 01-auth-fake-package  be687f8  O pacote de identidades de desenvolvimento, com nove identidades que emitem claims no formato do Hub. O acesso efetivo e lido da Organization resolvida, nao de um flag fixo, para que a identidade sem acesso consiga escapar do 402 trocando de Organization.
- 02-api-dev-adapter  638ff85  A API escolhe um adapter de identidade no boot. O middleware e SUBSTITUIDO, nunca acompanhado, entao continua existindo exatamente um gate. Duas guardas independentes recusam a flag em producao e cada uma foi provada sozinha.
- 02.1-dev-fake-hub-config-independence  8e9f9a7  Inserido no meio do run: o modo nao subia numa maquina com config parcial do Hub, que e o estado da sua. Agora um erro de config do Hub vira null em vez de derrubar o boot, e so com a flag ligada fora de producao.
- 03-web-dev-identity  4c0d0ff  O browser adota a identidade e o seletor troca de cargo. Os papeis passam pela traducao real de claims, entao trocar de identidade muda de verdade quais paineis aparecem.
- 04-dev-seed  9b1c9ee  Seed deterministico e idempotente das organizacoes do roster, mais a extensao do guard de banco local de duas para tres portas nomeadas, porque o seed escreve no banco.
- 05-isolation-guard  87645d7  O guard que torna o isolamento irremovivel, mais um check que varre o bundle de producao ja construido. Oito mutacoes independentes da arvore real foram observadas falhando.
- 06-make-targets  4adca4e  make dev-fake, back-fake, front-fake, db-seed e dev-fake-setup, e as flags documentadas COMENTADAS nos exemplos de .env para que um clone novo nao autentique identidades falsas de fabrica.
- 07-docs-reconciliation  9fc5838  CLAUDE.md, um ADR e a reconciliacao do plano parkeado que proibia nominalmente o que este run construiu. A defesa esta documentada como ela E, nao como foi desenhada.

## Não feito e por quê
- mutation-pass  skip · budget
  O passe de mutacao no limite da feature nao rodou: o orcamento de 4h de runtime ativo se esgotou durante as correcoes do gate final. Cada slice teve sondas de mutacao proprias observadas vermelhas, entao a cobertura nao esta sem prova, mas o passe agregado nao foi feito. Audit: nexo/runs/20260921T141216Z-dev-fake-identity-switch/AUDIT.md
- dockerfile-hardening  park · risky_operation
  apps/api/Dockerfile ficou byte-inalterado de proposito. Ele copia packages inteiro e instala sem --prod, entao o pacote de identidades VAI dentro da imagem de producao. Mudar o build da imagem nao pode ser validado dentro deste run e uma imagem quebrada so aparece no deploy. Filed em nexo/ROADMAP.md. Audit: nexo/runs/20260921T141216Z-dev-fake-identity-switch/AUDIT.md

## Decisões tomadas sem você
- Tomei a saida --worker do proprio SKILL.md para construir a partir do checkout principal, porque nao havia executor e voce pediu autopilot; o contrato do orquestrador sozinho teria escrito um dispatch e parado. (chat e nexo/runs/<run>/AUDIT.md)
- Os slices rodaram em SERIE em vez de worktrees paralelos, porque worktrees pnpm nao tem node_modules; Gate 2 ficou intacto e so o paralelismo de build se perdeu. (AUDIT.md)
- O criterio 3 pedia uma identidade admin-only e isso e inalcancavel: getRolesFromHubClaims nunca produz ['admin'] sozinho. Nao falsifiquei o estado escrevendo profile.roles; o roster cobre os cinco conjuntos reais e um teste fixa a inalcancabilidade. (AUDIT.md e CLAUDE.md)
- A contradicao entre CLAUDE.md e claims.ts foi deixada ABERTA em vez de harmonizada, porque decidir qual dos dois esta errado e pergunta de produto sua. (CLAUDE.md e nexo/ROADMAP.md)
- As duas ultimas correcoes de documentacao foram feitas por mim e nao por executor delegado, por falta de orcamento; conferidas contra os fatos dos verificadores, mas mais fracas que o laco usado em todo o resto. (AUDIT.md)

## Perguntas
1. Um operador que e owner ou admin do workspace mas NAO e vendedor nem finder deve ver o painel meus-dados? Hoje ve, porque getRolesFromHubClaims lhe da seller e finder junto; CLAUDE.md diz que nao deveria. Responder isso muda claims.ts ou CLAUDE.md.
   a) claims.ts esta errado, separar admin
   b) CLAUDE.md esta errado, corrigir a regra escrita
   c) outra: ___
2. Quer que eu enderece o Dockerfile agora, num run proprio com validacao de imagem, para que a camada estrutural volte a valer para a API?
   a) Sim, abrir um run para isso
   b) Depois, esta filed no ROADMAP
   c) outra: ___

Responda para retomar: <n><k>
