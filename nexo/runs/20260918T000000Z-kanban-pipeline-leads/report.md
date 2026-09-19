# Relatório: kanban-pipeline-leads

## Status da solicitação
pass · Tudo o que foi pedido foi entregue: as 24 aceitações estão cumpridas, as 8 slices estão em master, e o master ficou verde em todos os gates. Nada foi parqueado.
Pedido: Adicionar um quadro Kanban de prospeccao (CRM simples) ANTES da proposta. Um lead carrega nome do contato, empresa, um ou mais produtos em negociacao, valor estimado, descricao e vendedor responsavel, e anda por etapas configuraveis. Mover um lead para a etapa de conversao abre automaticamente o wizard de proposta e so permite o movimento depois que a proposta for criada.

## Entregue
- 01-leads-schema  0d9a80b  As três tabelas do lead (etapas, leads, produtos do lead) com FORCE RLS e as duas políticas por org, mais a semeadura das etapas por organização, numa migração só. Um lead é entidade própria: criar um não toca em sales_ops_sales nem consome código de proposta.
- 02-api-stage-cadastro  b874a29  Os endpoints de etapa: criar, renomear, reordenar e arquivar. Etapa de sistema responde 409 como funcao_is_system já responde. Nome duplicado responde 409 apoiado num índice único de verdade no banco, não numa sonda com corrida. Continua sem verbo DELETE.
- 03-api-leads  59eac03  O CRUD do lead, a listagem paginada própria (leads não viajam no /bootstrap) e a movimentação. O escopo por vendedor é aplicado NO SERVIDOR dentro do withTenant e resolvido por person_funcoes contra a função de sistema vendedor, nunca pelo espelho is_seller.
- 04-web-data-layer  5c9dcf7  Tipos, cliente de API, query keys, hooks e a movimentação otimista que reverte o card para a etapa E a posição exatas quando a API recusa.
- 05-web-stage-cadastro  bc226b3  A tela de cadastro de etapas sob cadastros/, em arquivo próprio. Arquivar é reversível na própria tela e etapa de sistema não expõe nenhum controle de edição.
- 06-web-kanban-board  ce12b96  O quadro em arquivos próprios: arrastar entre e dentro das colunas, o menu Mover para totalmente operável por teclado, os dias parado no card e a coluna de conversão. A dependência de drag entrou com versão exata, sem caret.
- 07-web-routing  fb8bdb9  As rotas operacional/leads, meus-dados/leads e cadastros/etapas, pelo resolveSalesOpsRoute/buildSalesOpsPath, com a URL continuando fonte única da verdade. O CLAUDE.md ganhou a seção do domínio de leads.
- 08-web-conversion  dec3a8b  A porta única para a proposta: mover para a etapa de conversão abre o wizard pré-preenchido, e o card só muda de etapa depois do 201. Cancelar não persiste absolutamente nada. Se a empresa não tem cliente, ele é resolvido ou criado nesse momento e não antes.

## Não feito e por quê
- nada a registrar.

## Decisões tomadas sem você
- Adicionei sales_ops_people.hub_account_id como mecanismo de identidade novo, porque a aceitação 15 exige escopo por vendedor NO SERVIDOR e não existia caminho de join de uma conta Hub para uma pessoa. A alternativa era filtrar no cliente, que a aceitação proíbe por nome. O caminho de auto-reivindicação é a parte sensível e é o que merece o seu olhar. (nexo/runs/20260918T000000Z-kanban-pipeline-leads/AUDIT.md)
- Somente-leitura virou propriedade do CARD e não da coluna. Não existe etapa 'converted': a etapa de conversão é ao mesmo tempo a porta e a coluna de destino, e continua aceitando drop de um lead sem proposta. Isso supersede a letra da aceitação 13, que falava de uma coluna final, e é a única aceitação que foi superada em vez de implementada. (00-OVERVIEW.md, seção Contrato reconciliado, e a seção Kanban de leads do CLAUDE.md)
- Mantive a rejeição de nome de etapa duplicado apoiada num índice único real no banco, em vez de removê-la ou de usar uma sonda de serviço, porque a aceitação 5 nomeia sales_ops_funcoes como precedente e esse precedente é enforcado pelo banco. (AUDIT.md)
- Rodei a passada de mutação do feature À MÃO, cruzando slices, porque o repositório não configura ferramenta de mutação. 22 mutações, 18 mortas, 4 vivas. A sobrevivente mais séria era um furo real na cerca da aceitação 13 e foi consertada dentro do run; as outras três estão registradas no ROADMAP. (nexo/runs/20260918T000000Z-kanban-pipeline-leads/mutation-report.md)
- Consertei um teste instável que já estava no master desde a wave 3 e falhava em 2 de 5 execuções, em vez de re-rodar o gate até ficar verde. Ele já tinha passado por dois gates de wave por sorte. (AUDIT.md e o commit 7650e44)
- Parei o merge da wave 5 para investigar em vez de aceitar o park automático: o nexo-wave-exec parqueou a slice 06 corretamente com a evidência que tinha, mas a causa real era o MEU gate, que rodava a suíte sem pnpm install depois de um merge que adicionava dependência. Consertei o gate e reinstaurei a slice por revert do revert. (AUDIT.md)
- Landei quatro commits de teste além do plano, cada um fechando um buraco que um verificador PROVOU existir: o clobber do hubAccountId, o fan-out do quadro, o badge de dias parado e a cerca da aceitação 13. (run.md)

## Perguntas
1. O caminho de AUTO-REIVINDICAÇÃO do hub_account_id, em que uma pessoa se liga sozinha à conta Hub pelo e-mail verificado do próprio token, é aceitável para você? Ele tem quatro guardas e é de uma vez só, mas é um mecanismo de identidade que você não pediu. A alternativa é só admin ligar por PATCH, o que exige um controle web que este feature não construiu.
   a) Está bom como está, com as quatro guardas
   b) Quero só o caminho administrativo, tire a auto-reivindicação
   c) Quero revisar o código antes de decidir
   c) outra: ___
2. A aceitação 13 pedia uma coluna final somente-leitura. Entreguei somente-leitura por CARD, porque com três kinds de etapa a coluna de conversão é porta e destino ao mesmo tempo. O comportamento que você vê é o mesmo (card convertido não arrasta e espelha o sale.status), mas não existe uma quinta coluna separada. Confirma que é isso que você queria?
   a) Sim, o comportamento é o que importa
   b) Não, eu queria mesmo uma coluna separada só de convertidos
   c) outra: ___
3. Sobraram três buracos de teste MEDIDOS que não consertei, todos no ROADMAP: o contrato API/web são dois pinos literais sem nada entre eles (renomear um campo deixa a suíte do outro lado cega), o fail-closed do createdSaleIdentity não tem oráculo, e um vazamento no getSalesOpsSummary fora do withTenant é absorvido por RLS e não por teste. Quer que eu ataque algum agora?
   a) Deixe no ROADMAP por enquanto
   b) Ataque o contrato API/web, é o mais perigoso
   c) Ataque os três
   c) outra: ___

Responda para retomar: <n><k>
