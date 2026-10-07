# v4.6.0

## Novidades

- Excluir lead: cada card tem um menu "..." (também no clique direito) com Excluir; a Lista e o formulário de edição também têm Excluir, sempre com confirmação.
- O vendedor exclui os leads que ele vê; o gestor exclui qualquer lead.
- Lixeira: o lead excluído some do quadro para todos e vai para Cadastros > Leads excluídos, onde o gestor vê quem excluiu e quando e pode Restaurar.
- Toda exclusão e restauração fica registrada no histórico.

## Correções

- O número da coluna, os totais em R$, a Lista e o Funil agora usam o total real: uma coluna com 115 leads mostra 115, mesmo com 100 carregados; o botão mostra "Carregar mais leads (100 de 115)".
- Ações sem resposta do servidor (como revogar o link de um finder) não aparecem mais como erro.

## Operação

- Migração `0028_lead_soft_delete` (três colunas anuláveis, uma checagem e um índice; não reescreve dados) roda ao subir a API.
- Nenhuma variável de ambiente nova e nenhuma dependência nova.
