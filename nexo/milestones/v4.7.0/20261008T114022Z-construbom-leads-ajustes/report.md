# Relatório: construbom-leads-ajustes

## Status da solicitação
pass · Completo: 5 de 5 fatias (3 pedidas + 2 de acabamento visual achadas no E2E), integradas em feat/20261008-00-run e verificadas na suíte inteira; master atualizado só localmente, nada promovido (Gate 3 é seu).
Pedido: Construbom: soma de R$ no topo da coluna do Kanban (edição Leads, igual à normal); card com Nome & Cliente; campo de cliente 'Buscar ou criar novo'; importação reconhece clientes já cadastrados (CNPJ/CPF, senão nome) em vez de duplicar

## Entregue
- 01-web-leads-board-parity  112d13e  Na edição Leads o Kanban mostra R$ igual à versão normal: total, % do total e barra no topo da coluna, valor no card, R$ nos chips e no rodapé da Lista e a coluna Valor estimado. O card mostra Nome e Cliente (ou 'Sem cliente') e o aniversário; a Lista continua com telefone e email.
- 02-web-client-picker-copy  3cb5d37  O campo de cliente da edição Leads diz 'Buscar ou criar novo cliente' (no campo e na busca). Na versão normal, que não cria cliente, diz 'Buscar cliente cadastrado'.
- 03-import-recognize-clients  a146f13  A importação reconhece o cliente que já existe (pelo CNPJ/CPF, senão pelo nome sem conflito de documento), não cria de novo, não altera o cadastro e liga os leads a ele. A prévia mostra uma linha só com quantos foram reconhecidos, no lugar das centenas de avisos.
- 04-web-visual-polish  67bed52  Acabamento achado no navegador: o nome do cliente no card usa a largura toda (antes era cortado ao lado do valor), o seletor deixou de mostrar linha dupla acima de 'Criar novo cliente' e o botão '+ Adicionar item livre' não quebra mais em duas linhas.
- 05-web-inline-button-height  55d8adf  Os botões ao lado de campos nos dois formulários de lead (Limpar, Adicionar, + Adicionar item livre) agora têm a mesma altura do campo.

## Não feito e por quê
- nada a registrar.

## Decisões tomadas sem você
- Na Lista da edição Leads entrou também a coluna Valor estimado, não só R$ nos chips e no rodapé. (apps/web/src/sales-ops/leads/LeadsBoard.tsx) (escolhido: a; alternativas: b) Só chips e rodapé)
- Sem cliente, o card da edição Leads diz 'Sem cliente'; a versão normal continua 'Sem empresa'. (apps/web/src/sales-ops/leads/board-labels.ts) (escolhido: a; alternativas: b) 'Sem cliente' nas duas edições)
- Na importação, se vários clientes têm o mesmo CNPJ, desempata pelo nome; e o nome só reconhece quando todos os documentos daquele nome na aba batem. (apps/api/src/domains/import/client-recognition.ts) (escolhido: a; alternativas: b) Pegar o primeiro cliente encontrado)
- As fatias 04 e 05 entraram no meio do run a partir de defeitos medidos no navegador (um causado pela fatia 01 e três que já existiam). (nexo/runs/20261008T114022Z-construbom-leads-ajustes/e2e.md) (escolhido: a; alternativas: b) Só anotar para depois)
- O run foi construído a partir desta sessão no checkout principal, por worktrees, e integrado num branch de run; o master recebe só fast-forward e nada foi enviado ao origin. (nexo/runs/20261008T114022Z-construbom-leads-ajustes/AUDIT.md)

## Perguntas
1. A importação não reconhece leads que já estão no quadro: reimportar a aba Leads sem apagar os leads antes duplica os leads, sem aviso. Quer que ela reconheça leads também?
   a) Sim: avisar ou pular lead com o mesmo contato e empresa já no quadro
   b) Não: o fluxo é sempre apagar antes de reimportar
   c) outra: ___
2. Posso cortar a versão v4.7.0 e promover para staging e produção (/nexo-ship)? A correção da importação precisa da API de produção nesta versão.
   a) Sim, cortar e promover
   b) Ainda não

Responda para retomar: <n><k>
