# v4.3.0

## Novidades

- Edição Leads: uma versão enxuta do Sales, só com o Kanban de prospecção, ativada por organização pelo módulo `sales.edition.leads` do Hub.
- Lead com Nome, Data de aniversário, Número, Email, Descrição e Vendedor; quadro começa sem etapas e o gestor cria todas.
- Tela Vendedores para o gestor (cadastrar, inativar e reativar).
- O vendedor cria um lead só com o nome e o lead já fica com ele.

## Para a FXL

- Nada muda no produto completo.
- Correção visual: o chip de fase ativo na Lista da Prospecção deixou de ficar branco no branco.
- O diálogo "Mover para" não mostra mais erro antes da primeira interação.

## Operação

- Migração `0027` (três colunas anuláveis em `sales_ops_leads`) roda ao subir a API.
- Nenhuma variável de ambiente nova.
- Ativação de um cliente: `nexo/playbooks/ativar-edicao-leads.md`.
