# Ativar a edição Leads para a Construbom (Hub de produção)

Este playbook liga a edição Leads do FXL Sales para UMA organização, a Construbom, no Hub de PRODUÇÃO.
O Sales só LÊ o módulo `sales.edition.leads` em `entitlements.modules` do token; toda a ativação acontece no Hub.
Nenhuma mudança de código, de banco do Sales ou de variável de ambiente é necessária.
A FXL e qualquer outra organização sem o módulo continuam exatamente como hoje (edição completa).

## O que muda para a Construbom

- O gestor (dono ou admin da organização no Hub) vê apenas Operacional > Prospecção, Cadastros > Vendedores e Cadastros > Etapas do funil.
- O vendedor (Seat `seller` no FXL Sales) vê apenas Meus dados > Minha prospecção.
- Não existem propostas, comissões, catálogo, importação nem etapas pré-definidas: o quadro começa vazio e o gestor cria cada coluna.
- O lead tem só Nome, Data de aniversário, Número, Email, Descrição e Vendedor.

## Pré-requisitos

- Conta de super admin no Hub de produção.
- Acesso SQL (psql) ao banco do Hub de produção, com permissão de escrita em `subscriptions` e `subscription_items`.
- O deploy do Sales com a edição Leads (v4.3.0, com a migração `0027_lead_contact_fields`) já está em produção.
- O e-mail de login do gestor da Construbom e de cada vendedor.

## Passo 0 - Descobrir os ids

Rode no banco do Hub e anote os valores.

```sql
-- Organização da Construbom (o id é o workspace_id; no Sales ele é o org_id).
SELECT id, name FROM workspaces WHERE name ILIKE '%construbom%';

-- Sua conta de operador, para registrar quem concedeu.
SELECT id, email FROM accounts WHERE email = 'seu-email@fxl.com.br';
```

Se a primeira consulta devolver mais de uma linha, confirme a organização certa antes de seguir.

## Passo 1 - Criar o SKU do módulo (Admin UI)

1. Abra `/admin/applications/app.fxl-sales/modules` (Admin > Aplicativos > FXL Sales > aba Módulos).
2. Clique em "Adicionar SKU/módulo".
3. Preencha "Tipo" = `Módulos (add-on)`.
4. Preencha "Nome" = `Edição Leads`.
5. Preencha "Preço (R$)" = `0,00`.
6. Preencha "Intervalo" = `Mensal`.
7. Preencha "Módulo (entitlement)" = `sales.edition.leads` (exatamente assim, minúsculo, sem espaços).
8. Clique em "Criar".
9. Na linha do SKU criado, clique em "Desativar".

Desativar não remove o módulo de quem já o tem: o Hub calcula os módulos a partir de `subscription_items` e nunca lê `skus.active`.
Desativar só esconde o SKU do marketplace e do checkout, para que nenhuma outra organização compre a edição Leads por conta própria a R$ 0.

Confira que existe exatamente um SKU com esse módulo:

```sql
SELECT id, kind, name, price_brl, interval, grants, active
FROM skus
WHERE product_id = 'app.fxl-sales' AND grants->>'module' = 'sales.edition.leads';
```

O resultado esperado é UMA linha com `kind = recurring_addon`, `price_brl = 0`, `interval = month`, `grants = {"module": "sales.edition.leads"}` e `active = false`.
Se houver mais de uma linha, desative ou exclua as sobras pela Admin UI antes de seguir; o SQL do passo 3 recusa continuar com duas.

## Passo 2 - Garantir o acesso da organização (Admin UI)

O Hub só coloca módulos no token quando a organização TEM acesso ao aplicativo (`entitlements.access = true`).
Sem acesso, `entitlements.modules` sai vazio mesmo com o item ativo.

1. Abra `/admin/orgs/<workspace_id>` (Admin > Organizações > Construbom).
2. Na seção "Acesso", veja se o FXL Sales aparece "Com acesso" com uma concessão "Ativa".
3. Se não aparecer, clique em "Conceder acesso".
4. "Aplicativo" = FXL Sales.
5. "Origem" = `Concessão administrativa`.
6. "Término" em branco (nunca expira).
7. "Motivo" = `Construbom - edição Leads do FXL Sales`.
8. Clique em "Conceder acesso".

Confira por SQL:

```sql
SELECT id, source, starts_at, ends_at, revoked_at
FROM access_grant
WHERE organization_id = '<workspace_id>'
  AND application_id = 'app.fxl-sales'
  AND revoked_at IS NULL
  AND starts_at <= now()
  AND (ends_at IS NULL OR ends_at > now());
```

O resultado esperado é pelo menos uma linha.

## Passo 3 - Ligar o módulo (SQL)

A Admin UI ainda não tem a ação "conceder módulo" (está no roadmap do Hub), por isso o item é inserido por SQL.
O script reaproveita uma assinatura `active` ou `trialing` que a Construbom já tenha no FXL Sales, exatamente como o Hub faz nas próprias concessões, e só cria uma assinatura `manual` se não houver nenhuma.
O script é idempotente: rodar duas vezes não cria um segundo item.
`subscriptions.id` e `subscription_items.id` não têm valor padrão no banco (o Hub os gera na aplicação), então o script os gera com `gen_random_uuid()`.

Rode no psql, trocando os três valores do `\set`.

```sql
\set workspace_id 'COLE_AQUI_O_WORKSPACE_ID'
\set operator_account_id 'COLE_AQUI_O_ID_DA_SUA_CONTA'
\set grant_reason 'Construbom - edição Leads do FXL Sales (R$ 0)'

BEGIN;

-- Trava: exatamente um SKU com o módulo.
SELECT count(*) AS skus_com_o_modulo
FROM skus
WHERE product_id = 'app.fxl-sales' AND grants->>'module' = 'sales.edition.leads';

WITH sku AS (
  SELECT id, grants
  FROM skus
  WHERE product_id = 'app.fxl-sales' AND grants->>'module' = 'sales.edition.leads'
),
sku_unico AS (
  SELECT * FROM sku WHERE (SELECT count(*) FROM sku) = 1
),
existente AS (
  SELECT id
  FROM subscriptions
  WHERE workspace_id = :'workspace_id'
    AND product_id = 'app.fxl-sales'
    AND status IN ('active', 'trialing')
    AND (current_period_end IS NULL OR current_period_end > now())
  ORDER BY created_at
  LIMIT 1
),
criada AS (
  INSERT INTO subscriptions (
    id, workspace_id, product_id, status, source,
    granted_by_account_id, grant_reason, current_period_end
  )
  SELECT
    gen_random_uuid()::text, :'workspace_id', 'app.fxl-sales', 'active', 'manual',
    :'operator_account_id', :'grant_reason', NULL
  WHERE NOT EXISTS (SELECT 1 FROM existente)
    AND EXISTS (SELECT 1 FROM sku_unico)
  RETURNING id
),
alvo AS (
  SELECT id FROM existente
  UNION ALL
  SELECT id FROM criada
)
INSERT INTO subscription_items (id, subscription_id, sku_id, price_brl, grants, removed_at)
SELECT gen_random_uuid()::text, alvo.id, sku_unico.id, 0, sku_unico.grants, NULL
FROM alvo CROSS JOIN sku_unico
WHERE NOT EXISTS (
  SELECT 1
  FROM subscription_items si
  JOIN subscriptions s ON s.id = si.subscription_id
  WHERE s.workspace_id = :'workspace_id'
    AND s.product_id = 'app.fxl-sales'
    AND s.status IN ('active', 'trialing')
    AND (s.current_period_end IS NULL OR s.current_period_end > now())
    AND (si.removed_at IS NULL OR si.removed_at > now())
    AND si.grants->>'module' = 'sales.edition.leads'
)
RETURNING id, subscription_id, sku_id, price_brl, grants, activated_at;

-- Conferência: a MESMA consulta que o Hub usa para montar entitlements.modules (resolveModules).
SELECT DISTINCT si.grants->>'module' AS modulo
FROM subscription_items si
JOIN subscriptions s ON s.id = si.subscription_id
WHERE s.workspace_id = :'workspace_id'
  AND s.product_id = 'app.fxl-sales'
  AND s.status IN ('active', 'trialing')
  AND (s.current_period_end IS NULL OR s.current_period_end > now())
  AND (si.removed_at IS NULL OR si.removed_at > now());
```

Leia os resultados antes de decidir.

- `skus_com_o_modulo` precisa ser `1`.
- O `INSERT ... RETURNING` devolve uma linha na primeira execução e zero linhas se o módulo já estava ligado.
- A conferência precisa listar `sales.edition.leads` (e só os módulos que a Construbom já tinha antes).

Se tudo bate, rode `COMMIT;`.
Se qualquer coisa estiver diferente, rode `ROLLBACK;` e nada foi gravado.

Se você usa um cliente SQL gráfico em vez do psql, troque cada `:'workspace_id'`, `:'operator_account_id'` e `:'grant_reason'` pelo valor entre aspas simples e remova as linhas `\set`.

Anote o `id` do item devolvido pelo `RETURNING`; ele é o que o rollback desliga.

## Passo 4 - Verificar

1. Peça ao gestor da Construbom para clicar em "Sair" no FXL Sales e entrar de novo (o token atual não tem o módulo; o próximo token tem).
2. Opcional: no navegador do gestor, decodifique o token de acesso e confira `entitlements.access = true` e `entitlements.modules` contendo `sales.edition.leads`.
3. O gestor deve ver apenas Prospecção (Operacional), Vendedores e Etapas do funil (Cadastros).
4. Qualquer outra URL do Sales (por exemplo `/operacional/vendas` ou `/tatico/dashboard`) deve voltar para a tela padrão do papel.
5. O quadro de Prospecção deve abrir vazio, pedindo para criar etapas.
6. Entre com uma conta da FXL e confirme que nada mudou (Tático, propostas e comissões continuam lá).

## Passo 5 - Rollback

Desligar a edição Leads devolve a Construbom à edição completa no próximo token.
Os dados (leads, pessoas, etapas) continuam válidos nas duas edições.

```sql
BEGIN;

UPDATE subscription_items si
SET removed_at = now()
FROM subscriptions s
WHERE s.id = si.subscription_id
  AND s.workspace_id = 'COLE_AQUI_O_WORKSPACE_ID'
  AND s.product_id = 'app.fxl-sales'
  AND si.grants->>'module' = 'sales.edition.leads'
  AND si.removed_at IS NULL
RETURNING si.id, si.removed_at;

COMMIT;
```

Depois do rollback, peça ao gestor para sair e entrar de novo.
Se a assinatura tinha sido criada pelo passo 3 (`source = 'manual'`, sem outros itens ativos), ela pode ficar como está: sem itens ativos, ela não concede nenhum módulo.

## Passo 6 - Lado do Sales (onboarding da Construbom)

1. O gestor entra no FXL Sales e abre Cadastros > Etapas do funil.
2. Ele cria as colunas do quadro, na ordem desejada (por exemplo `Novo contato`, `Em conversa`, `Fechado`).
3. Ele abre Cadastros > Vendedores e cadastra cada vendedor com o MESMO e-mail que o vendedor usa para entrar no Hub.
4. A FXL adiciona cada vendedor como membro da organização Construbom no Hub: na página da organização, "Convidar membro", "Papel na organização" = membro, "Papéis do app" = `seller` no FXL Sales.
5. No primeiro acesso, o Sales liga o vendedor ao cadastro pelo e-mail verificado do token; e-mails diferentes, ou dois cadastros com o mesmo e-mail, deixam o vendedor sem quadro.
6. O vendedor entra e vê Meus dados > Minha prospecção, apenas com os próprios leads.

## Observações

- A edição é derivada do token a cada requisição e nunca é gravada no banco do Sales.
- Se o Hub parar de mandar o módulo (item removido, assinatura cancelada, acesso revogado), a Construbom volta a ver a edição completa; essa direção foi aceita no planejamento.
- Uma ação auditada de "conceder módulo" na Admin UI do Hub está no roadmap do Hub e substitui o passo 3 quando existir.
