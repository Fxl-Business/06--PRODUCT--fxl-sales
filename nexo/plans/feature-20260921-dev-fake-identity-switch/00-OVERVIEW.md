---
feature: feature-20260921-dev-fake-identity-switch
milestone: v4.1.0
run: 20260921T141216Z-dev-fake-identity-switch
token: v5ztl2dm
---

# 00 - OVERVIEW: modo dev-fake com troca de identidade

> INCIDENTE REGISTRADO, 2026-09-21.
> Este arquivo foi SOBRESCRITO enquanto os planners rodavam, por um agente que adotou o token
> `v5ztl2dm` e se julgou uma segunda sessao de orquestrador.
> A prosa abaixo foi RESTAURADA pelo orquestrador a partir do proprio gerador, que estava no seu
> contexto, e nao e uma reconstrucao a partir dos frontmatter.
> O que se perdeu e voltou: esta secao de desenho cross-slice e o indice de slices.
> O que nunca foi tocado: os sete arquivos de slice, os sete `agents/plan-*.result.json`, e o
> `AUDIT.md`.
> O `budget.json` foi encontrado com `exhausted` indevidamente marcado e ja estava revertido para
> `null`; os contadores conferidos valem 7/16 slices e 9/64 dispatches.
> Os planners de 01, 02, 03, 05, 06 e 07 leram a versao original.
> O planner de 04 leu a versao danificada e planejou a partir dos criterios de aceitacao e do seu
> proprio briefing, que ja carregava a obrigacao da TERCEIRA PORTA em texto integral, entao o slice
> 04 nao ficou menos protegido por causa disso; isso foi conferido no relatorio dele.

## O pedido, verbatim

Modo dev-fake em fxl-sales: poder desenvolver e revisar o produto localmente SEM nenhum Hub no ar, com um seletor no browser que troca a identidade adotada (e portanto o conjunto de papeis) para alcancar as telas que so alguns cargos veem. Espelhar o desenho ja provado em /Users/cauetpinciara/Documents/fxl/projects/01--PRODUCT--fxl-finance (packages/auth-fake, apps/api/src/auth/select.ts, apps/web/src/lib/dev-identity.ts + dev-identity-switcher.ts, scripts/__tests__/auth-fake-isolation.test.mjs, alvos make dev-fake/back-fake/front-fake, apps/api/scripts/seed-dev.ts), adaptando-o aos seams que fxl-sales NAO tem.

## Os criterios de aceitacao, verbatim

1. Com NENHUM Hub escutando em localhost:9016, `make dev-fake` sobe API e web e o operador abre o app, passa da tela de login e navega autenticado ate uma tela de sales-ops com dados.
2. Um seletor de identidade fica visivel no browser em modo dev-fake, lista o roster inteiro com rotulo humano, e escolher outra identidade a adota e recarrega a pagina. A escolha persiste em localStorage entre reloads.
3. O roster cobre no minimo seis identidades e cada uma existe para tornar um ramo real alcancavel: admin-only (ve tatico+operacional+cadastros e nenhum meus-dados), seller-only (ve SOMENTE meus-dados e aterrissa la), finder-only, admin+seller (ve os quatro paineis), uma identidade sem NENHUM papel reconhecido que aterrissa em /no-role, e uma identidade cujo Organization nao carrega acesso, que rende 402 e renderiza MissingEntitlementPanel e nao a copy generica de servidor.
4. Os papeis viajam pelo caminho REAL de traducao em ambas as metades: o pacote fake emite CLAIMS no formato do Hub e o web os passa por getRolesFromHubClaims (apps/web/src/auth/claims.ts) e por getVisibleWorkspaces (apps/web/src/sales-ops/navigation.ts). Nenhum fixture entrega um perfil ja pronto nem escreve profile.roles direto.
5. A identidade adotada decide a visibilidade observada na barra lateral exatamente pela regra ja documentada em CLAUDE.md: admin sozinho nao ve meus-dados; seller ou finder adiciona meus-dados; zero papeis reconhecidos mantem /no-role.
6. NENHUM caminho fake e alcancavel em producao, e a defesa e estrutural antes de ser assertiva: o pacote de identidades e devDependency e nunca dependency; todo acesso a ele e por import DINAMICO; a metade web fica atras de import.meta.env.DEV para que o build de producao a elimine como dead code; e o boot da API RECUSA com mensagem nomeada quando a flag esta ligada sob NODE_ENV=production.
7. Um guard de tracked-file roda dentro de `pnpm run test` e falha se o pacote de identidades aparecer fora de devDependencies, ou se qualquer fonte shipada o importar estaticamente. O guard prova a si mesmo re-executando contra arvores de fixture mutadas e exigindo saida nao-zero, no molde de scripts/__tests__/local-database-guard.test.mjs.
8. O caminho de producao permanece intacto: requireHubAuth continua sendo o unico gate de acesso com allowWithoutAccess no default false, a taxonomia 401/402/403/503 e byte-identica, e o BFF do Hub continua montado do mesmo jeito. Com a flag dev-fake AUSENTE o comportamento do repositorio e indistinguivel do de hoje.
9. Um seed deterministico cria no Postgres LOCAL os org_ids que o roster referencia, cada um com suas funcoes de sistema vendedor e finder (sales_ops_funcoes, isSystem) e com pessoas ligadas a elas, de modo que as telas de meus-dados e de cadastros abram com linhas em vez de vazias. O seed e idempotente e so roda contra um banco local.
10. A tenancy segue honrada: o org ativo de cada identidade fake e um org_id que existe no seed, e nenhuma query deixa de filtrar por org_id. Nada no caminho fake le user_id, org_id, account_id ou workspace_id de corpo de request.
11. CLAUDE.md e atualizado no mesmo commit que torna a proibicao falsa: o slice parked nexo/plans/feature-20260827-hub-sdk-210-access-model/05-dev-identity-fixtures.md proibe nominalmente um runtime development-identity path, e essa proibicao e explicitamente REVISADA, dizendo o que mudou, quais guardas a substituem e por que elas bastam. O slice 05 parked e reconciliado, nao deixado contradizendo a arvore.
12. `pnpm run lint`, `pnpm run type-check`, `pnpm test` e `pnpm run build` passam. A suite existente continua verde e nenhum teste existente tem seu titulo ou sua assercao afrouxada para acomodar o modo fake.

## Por que isto existe

Hoje nao ha como exercitar localmente as telas que dependem de cargo sem um Hub no ar emitindo um token com o conjunto certo de papeis.
O Hub local sobe normalmente nesta maquina, entao isto NAO e um desbloqueio de indisponibilidade: e a capacidade de TROCAR de cargo em segundos para revisar o que cada um ve.

## A referencia, e o que dela NAO se aplica

O desenho esta provado em `/Users/cauetpinciara/Documents/fxl/projects/01--PRODUCT--fxl-finance`.
Copiar a ESTRUTURA de defesa e o formato do roster; NAO copiar nomes de modulo, de pacote nem de claims, porque os dois produtos tem contratos diferentes.

Quatro seams que o finance tem e o fxl-sales NAO tem, e que sao o verdadeiro trabalho desta feature:

1. A API nao tem seam de adapter.
   `apps/api/src/middleware/app-auth.ts` monta `requireHubAuth(hubSdkConfig)` no topo do modulo.
2. O web nao tem `__setHubClient`, e o token NAO vem de `HubClient.getToken()`.
   Vem de `requestHubAccessToken` em `apps/web/src/auth/refresh.ts`.
3. Nao existe nenhum script de seed no repositorio.
4. `admin` e SINTETIZADO do flag `owner`/`admin` do workspace em `getRolesFromHubClaims`.

## Invariantes que esta feature nao pode quebrar

- `requireHubAuth` continua sendo o UNICO gate de acesso no caminho de producao, com `allowWithoutAccess` no default `false`.
  O modo fake SUBSTITUI o middleware no boot; ele nao afrouxa o gate real nem adiciona um segundo gate ao lado dele.
- A taxonomia de negacao 401 / 402 / 403 / 503 e byte-identica.
- Com a flag ausente, o repositorio e indistinguivel do de hoje.
  Esse e o teste mental para toda decisao desta feature.
- A tenancy continua keyed por `org_id`.
- Os bans de UI valem para o seletor tambem.

## O contrato de defesa, em quatro camadas

A ordem importa: estrutural primeiro, assertiva depois.

1. `@fxl-sales/auth-fake` e `devDependency` e nunca `dependency`.
2. Todo acesso a ele e por `import()` DINAMICO.
3. A metade web fica atras de `import.meta.env.DEV`.
4. O boot da API RECUSA com mensagem nomeada sob `NODE_ENV=production`.

E entao, so entao, um guard de tracked-file que falha `pnpm run test` se 1 ou 2 forem violados.

## Uma consequencia que atravessa slices

`CLAUDE.md` afirma que existem EXATAMENTE DUAS entradas guardadas por `assertLocalDatabase`, que o numero dois e deliberado, e que adicionar uma terceira significa adicionar a assercao dela em `scripts/__tests__/local-database-guard.test.mjs` NA MESMA MUDANCA.
O script de seed escreve no banco, entao ele E uma terceira entrada.
O slice 04 tem portanto duas obrigacoes e nao uma.
Um seed que so chama `assertLocalDatabase` sem estender o teste passa verde e desarma a propriedade que o teste existe para provar.

## Reconciliacao documental obrigatoria

`nexo/plans/feature-20260827-hub-sdk-210-access-model/05-dev-identity-fixtures.md` esta `status: parked` e proibe NOMINALMENTE um runtime development-identity path.
Esta feature torna essa proibicao falsa.
Ela precisa ser REVISADA em texto, e nao contornada em silencio.

## Descoberta do beat Plan que altera a aceitacao

O criterio 3 pede uma identidade `admin`-only e o criterio 5 descreve o painel dela.
`getRolesFromHubClaims` NAO CONSEGUE produzir `['admin']` sozinho: todo ramo que gera `admin` devolve o literal `['admin','seller','finder']`.
Os conjuntos alcancaveis sao cinco e os conjuntos de paineis sao quatro.
Ver `nexo/runs/20260921T141216Z-dev-fake-identity-switch/AUDIT.md` para a analise e para a pergunta de produto que ficou para o humano.

## Os slices

| id | o que entrega | depends_on | wave |
| --- | --- | --- | --- |
| 01-auth-fake-package | o pacote `@fxl-sales/auth-fake`: roster, claims no formato do Hub, mint de token, helpers puros. | - | 1 |
| 02-api-dev-adapter | o seam de adapter no boot da API e o middleware de identidade, com a recusa sob producao. | 01 | 2 |
| 03-web-dev-identity | o seam do browser e o seletor de identidade, atras de `import.meta.env.DEV`. | 01 | 2 |
| 04-dev-seed | o seed deterministico, guardado como TERCEIRA entrada local, com o teste do guard estendido. | 02 | 3 |
| 05-isolation-guard | o guard de tracked-file e sua fiacao no script `test` da raiz. | 02, 03 | 3 |
| 06-make-targets | alvos `dev-fake` no Makefile e os exemplos de `.env`. | 02, 03 | 3 |
| 07-docs-reconciliation | `CLAUDE.md`, o ADR e a reconciliacao do slice 05 parked. | 04, 05, 06 | 4 |

O executor de cada slice le este arquivo inteiro antes do seu proprio.
