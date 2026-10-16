# v4.7.1

## Correções

- Kanban de leads (Quadro): o quadro não cresce mais sem limite na vertical.
  Ele ocupa a altura disponível da tela, e cada coluna rola os próprios cards por baixo do cabeçalho, que fica fixo.
  Uma coluna com muitos cards não estica mais as outras.
- A barra de rolagem horizontal do quadro fica no topo, acima das colunas, para rolar para o lado sem descer a página nem usar shift+scroll.
  Ela pode ser arrastada com mouse ou dedo, um clique na trilha leva até aquele ponto, e as setas, PageUp/PageDown e Home/End também rolam o quadro.
- Toque (iPad e celular): deslizar o dedo sobre um card rola a coluna ou o quadro; para arrastar um card, segure por um instante e arraste.
  Tocar no card continua abrindo a edição.

## Telas menores

- No celular e no iPad em pé (abaixo de 1024px) o menu lateral começa recolhido nos ícones e pode ser expandido pelo botão de sempre.
- No celular as margens ficam menores e cada coluna cabe inteira na largura da tela.

## Operação

- Somente web (Vercel); a API não muda.
- Sem migração, sem variável de ambiente nova e sem dependência nova.
