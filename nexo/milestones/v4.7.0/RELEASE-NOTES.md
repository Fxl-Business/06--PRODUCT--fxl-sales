# v4.7.0

## Novidades

- Edição Leads: o topo de cada coluna do Kanban mostra a soma dos valores em R$, o "% do total" e a barra, igual à versão completa.
- Edição Leads: o card mostra o valor do lead, e a Lista ganhou R$ nas fases, o total no rodapé e a coluna Valor estimado.
- O card do lead mostra Nome e Cliente; o nome do cliente ocupa a largura do card e quebra em até duas linhas. A Lista continua mostrando telefone e email.
- O campo de cliente diz "Buscar ou criar novo cliente" na edição Leads e "Buscar cliente cadastrado" na versão completa.
- Importação: um cliente da planilha que já está no cadastro (mesmo CNPJ/CPF, ou mesmo nome sem documento em conflito) é reconhecido e reaproveitado, sem ser criado de novo e sem ser alterado.
  Os leads da planilha se ligam a ele, e a prévia mostra uma linha só com quantos clientes foram reconhecidos, no lugar de um aviso por linha.

## Correções

- O seletor de cliente não mostra mais duas linhas acima de "Criar novo cliente".
- No formulário do lead, "+ Adicionar item livre" não quebra mais em duas linhas, e os botões ao lado dos campos ("Limpar", "Adicionar") têm a mesma altura do campo.

## Operação

- Sem migração, sem variável de ambiente nova e sem dependência nova.
- A prévia e a importação devolvem o campo novo `recognized`; o web funciona com uma API que ainda não o envia, então a ordem de deploy entre web e API não importa.
- O reconhecimento de clientes na importação só vale quando a API de produção estiver nesta versão.
