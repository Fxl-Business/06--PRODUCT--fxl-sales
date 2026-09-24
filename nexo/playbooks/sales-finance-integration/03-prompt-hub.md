# Prompt para o FXL Hub: contratos entre Applications sem payload no Hub

> **Contexto**
>
> Estamos planejando a primeira integração de dados entre duas Applications da frota: FXL Sales (`/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales`) e FXL Finance (`/Users/cauetpinciara/Documents/fxl/projects/01--PRODUCT--fxl-finance`).
> Numa Organization que usa os dois apps (Finance em modo For Business), as contas a receber e a pagar das propostas ganhas no Sales aparecem sozinhas no Finance, e "marcar como pago" vale nos dois apps, em duas vias.
> A auditoria completa, feita nos três repos, está em `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/nexo/knowledge/doubts/20260922-sales-finance-two-way-sync-audit.md`.
> Leia as seções 2.3 (o Hub hoje), 4 e 5 (a análise da spec 05 e da arquitetura A3), 10 (decisões do dono) e 11 (contrato consolidado v0, que substitui as seções 4 a 6 onde conflitarem).
>
> **O que mudou em relação à spec `nexo/plans/platform-v1/05-contratos-entre-applications.md` (A3)**
>
> O dono decidiu:
> - **nenhum payload de negócio no banco do Hub** e **nenhuma infra nova** (produção roda em EC2 sempre ligada na AWS, staging no Coolify; nada de SQS, EventBridge, Redis ou serviço novo);
> - portanto, o Hub deixa de ser a fila (sem `integration_event` e `integration_delivery` com payload, sem sweeper de payload) e vira **só plano de controle**;
> - os apps são o plano de dados: cada produtor grava um outbox na mesma transação e expõe um feed por cursor; cada consumidor puxa direto do produtor;
> - a integração é de duas vias: Sales e Finance são os dois produtor e consumidor;
> - o first-write-wins por `sale:<saleId>` da A3 não serve (eventos por linha, com revisão e estado; ver seção 11.4 da auditoria).
> Esse desenho fica alinhado com `04-fronteira-hub-application.md:105-107` (webhooks de domínio nos apps, sem payload pelo Hub), que a A3 contradizia.
>
> **O que precisamos do Hub nesta etapa: desenho, não implementação**
>
> 1. **Um ADR** que substitui a A3 da spec 05 pelo modelo "Hub plano de controle", registrando por que (nada de payload, nada de infra, duas vias) e o que se perde (sem painel de fila no Hub, sem retenção central).
> 2. **Uma revisão da spec 05** cobrindo:
>    - **Registro de event types** com schema JSON imutável por versão e dono (Application produtora), com publicação dupla em mudança de versão.
>    - **Contratos e Activations:** Contrato = Application produtora, Application consumidora e event types; Activation por Organization, com quem ligou e quando. Na v1 quem liga é o operador. Pré-condição: `hasAccess` vivo nas duas Applications. O Hub não conhece o modo For Business do Finance: defina como o Finance recusa ou reporta uma org inelegível.
>    - **Autorização de leitura direta entre apps:** o consumidor lê o feed do produtor, e o produtor precisa saber, pelo Hub, que existe Contrato, Activation viva e `hasAccess` das duas Applications naquela org, no mesmo ambiente. Requisitos: nenhum segredo compartilhado entre apps; revogação efetiva em no máximo 60 s; isolamento de ambiente estrutural; verificação feita por código publicado uma única vez (a frota erra quando cada app escreve o próprio verificador, H1/M10). Compare pelo menos: ticket opaco curto com introspecção no Hub (com cache no produtor) contra token curto assinado verificado pelo JWKS. A seção 5.3 da spec 05 rejeitou `client_credentials` (A2); diga o que muda aqui e o que continua valendo daquela análise.
>    - **Descoberta:** o consumidor precisa achar a API do feed do produtor por ambiente, e o Finance precisa do `app_url` do Sales (já existe em `packages/hub-db/src/schema.ts:354`) para o link "Editar no Sales".
>    - **Pacote de contrato publicado:** schemas, exemplos "golden", o redutor único de liquidação (a base é `reduzirLiquidacao` do Finance), a função do subconjunto sincronizado, e os helpers de outbox, feed e pull. Respeite o guard `runtime-deps.test.ts` do SDK: decida se é um subpath do `@fxl-business/hub-sdk` ou um pacote separado, e como os apps fixam a versão.
>    - **Semântica do feed:** a posição do cursor não pode ser uma `bigserial` atribuída no INSERT, porque isso não é ordem de commit e o leitor pularia eventos. O pacote deve trazer a solução e o teste dela (ver seção 11.3 da auditoria). O pull roda dentro da API, em EC2 sempre ligada, e deve ser seguro com várias instâncias.
>    - **Fake-dev:** sem Hub no caminho dos dados, o desenvolvimento local precisa de um substituto da autorização no `auth-fake` de cada app, e de uma org de fixture comum aos rosters do Sales e do Finance (hoje eles não têm nenhuma org em comum).
>    - **Observabilidade:** sem fila no Hub, defina onde o operador vê a saúde da integração (atraso do cursor, último erro, eventos recusados). Um heartbeat que os apps reportam ao Hub, sem payload, é uma opção.
> 3. **Pré-requisito de produção:** a integração depende do delta do SDK 2.3.0 e do access-model, que ainda não foi promovido (`main` está 96 commits à frente de `origin/production` na data da auditoria). Registre isso no plano.
>
> Não implemente nada ainda. Entregue o ADR e a spec revisada para aprovação do dono.
>
> **Achado sem relação com a integração, para tratar antes:** `nexo/playbooks/finance-golive-runbook.md:37` tem um `HUB_INTERNAL_KEY` real commitado. Se essa chave ainda vale em algum ambiente, ela precisa ser trocada (tirar do arquivo não basta, ela continua no histórico do git).
