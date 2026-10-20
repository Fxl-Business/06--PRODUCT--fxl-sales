# Capture: Prospecção, navegação e kanban

Run `20261020T124625Z-prospeccao-kanban-navegacao`, token `shqaxyab`, marco `v4.8.0`.
Esta captura registra o trabalho verificado no branch do run antes da entrada no trunk.
O pedido proíbe push, deploy e promoção para staging ou production.

## Entregue

- A sidebar mostra Prospecção como grupo expansível, com cada etapa ativa na ordem do servidor e URL estável pelo ID.
  A etapa abre sua lista filtrada, inclusive no espaço do vendedor.
  Funil é uma página própria com o kanban completo, e os seletores internos Lista/Quadro/Funil foram removidos da navegação roteada.
  URLs antigas de leads redirecionam para Funil; uma etapa arquivada ou removida mostra indisponibilidade.
- O Funil usa altura delimitada, cabeçalhos separados da área rolável e rolagem vertical por coluna.
  A busca filtra imediatamente os cards já carregados por nome, empresa, telefone e email, sem alterar totais e paginação do servidor.
  Cada card elegível oferece Mover pelo diálogo existente; o gesto de arrastar continua no corpo do card.
- Um vendedor pode restaurar apenas um lead que ele próprio excluiu na mesma organização.
  O administrador mantém a restauração de leads da organização, e a listagem de excluídos continua restrita a administradores.
  A API responde com o mesmo resultado de não encontrado para IDs sem acesso, ativos, desconhecidos ou de outra organização.
- Movimentos comuns, edições de leads existentes e exclusões bem-sucedidas mostram Desfazer por cerca de cinco segundos.
  A ação inversa usa as mutações persistidas existentes e atualiza cards e totais.
  Conversões e criações não oferecem Desfazer.
  Se a ação inversa falhar, o aviso permanece disponível para nova tentativa.
  Antes de desfazer movimento ou edição, o cliente lê novamente o lead e recusa a inversão quando detecta uma alteração posterior.

## Verificação

- O primeiro Verify da navegação falhou porque o oráculo montava apenas a sidebar e não detectava um filtro de etapa sempre verdadeiro.
  O plano foi reconciliado com a migração das rotas, o oráculo passou a montar o board roteado e a mutação artificial do filtro passou a falhar dois testes.
  Verify 01, tentativa 2: 13 testes do oráculo, 276 testes afetados, typecheck, lint e `git diff --check` passaram.
- Verify 02: 39 testes do oráculo e 1.773 testes web completos passaram, além de typecheck e lint.
  Mutações artificiais da busca e do botão Mover fizeram os respectivos testes falharem.
- A implementação de restauração encontrou inicialmente o PostgreSQL local indisponível.
  Após a disponibilidade do banco, Verify 03 passou com 17 testes de rota, 11 testes RLS reais, 53 testes unitários de leads, typecheck e lint da API.
- O primeiro Verify de Desfazer falhou por dois riscos: o prazo podia expirar durante uma inversão lenta, e uma inversão podia sobrescrever uma alteração posterior sem detectá-la.
  Ambos foram corrigidos e testados.
  Verify 04, tentativa 2: 15 testes do oráculo, 428 testes afetados, typecheck e lint passaram.
  Os testes detectaram mutações artificiais que removiam a leitura de conflito ou reintroduziam a expiração durante a inversão.
- Os quatro Verify de onda independente passaram.
  Na última onda, o build dos pacotes, typecheck web, lint web, 133 arquivos e 1.789 testes web, revisão de segurança e `git diff --check` passaram.
  Na onda da API, 100 arquivos e 1.482 testes unitários, mais 11 testes RLS, passaram.
  Avisos existentes de React `act(...)` e React Router apareceram sem falha de teste.

## Capturas visuais

O manifesto está em `.nexo/tmp/20261020T124625Z-prospeccao-kanban-navegacao/manifest.json` na raiz do projeto.
Foram capturadas as listas de Novo, Em negociação, Proposta e Perdido, uma imagem por ID de etapa, e `funil-search.png` com a busca `Aurora`.
Os cinco arquivos PNG constam no mesmo diretório do manifesto.

## Decisões e Revisão

- A busca atua sobre os cards carregados e já sujeitos aos filtros de organização e vendedor.
  Totais e indicação de carregamento continuam representando o conjunto do servidor.
- O restauro após exclusão mantém o comportamento do serviço: volta à etapa válida ou à etapa aberta de fallback e entra na posição final.
  Não promete a posição exata anterior.
- A prevenção de conflito no Desfazer de movimento e edição usa uma leitura atual antes da escrita inversa.
  Ainda existe uma janela de corrida entre essa leitura e a escrita, pois a API não oferece pré-condição atômica por versão de linha.
  Uma inversão poderia sobrescrever uma mudança feita nessa janela.
  Uma correção completa exigiria mutação condicional no servidor.
- Revisão visual: o conjunto local tem no máximo dois cards visíveis por etapa.
  As imagens não demonstram a rolagem de uma coluna longa; a estrutura e o contrato de scroll foram cobertos pelos testes automatizados.
- Não houve push, deploy ou promoção como parte deste run.
