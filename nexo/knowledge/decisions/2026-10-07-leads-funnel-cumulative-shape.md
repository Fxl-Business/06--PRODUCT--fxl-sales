# Funil de leads: forma Acumulado (cumulativo) além da Composição

Data: 2026-10-07
Status: aceito
Run: `20261007T185127Z-leads-funnel-cumulative` (quick, autopilot)
Commit: `4f55541` (merge de `feat/leads-funnel-cumulative`, código em `5fcf8a1`)

## Contexto

A view "Funil" dos leads mostrava cada lead contado SÓ na etapa onde ele está agora, com as barras dimensionadas pelo próprio valor/volume de cada etapa.
Isso é uma composição (distribuição), não um funil: não afunila de verdade, porque uma etapa do meio pode ser maior que a de cima.
O operador apontou a distinção: num funil de verdade, um lead que está em "Proposta" também passou por "Novo" e "Em contato", então é contado em todas elas - o topo é sempre o maior e vai decrescendo.
Ele quis as DUAS visualizações, mantendo a atual.

## Restrição do dado

Não existe histórico de passagem por etapa.
`sales_ops_leads` guarda apenas a etapa atual (`stage_id`) e um único `stage_changed_at`; moves não escrevem em `audit_log`.
Logo, um funil cumulativo histórico de verdade é impossível.

## Decisão

Adicionar uma segunda forma à mesma view, por trás de um toggle `FUNNEL_SHAPE_LABEL` (`Acumulado`/`Composição`), ortogonal ao toggle `Faturamento`/`Volume` que continua valendo para as duas.

- **Acumulado** (nova, default): suposição linear - um lead na etapa de índice K é contado em todas as etapas 0..K.
  `buildCumulativeFunnel` acumula de baixo pra cima, dando barras monotonicamente decrescentes do topo.
  A share é retenção a partir do topo (`% do topo`, 100% no topo); a largura da barra, arredondada a inteiro, bate com esse %.
- **Composição** (a anterior, intacta): `buildLeadFunnel`, cada etapa pelo próprio tamanho, `% do total`, toda etapa é uma linha.

Default é Acumulado porque a view se chama "Funil" e essa é a forma que de fato afunila.

## Perdido fora da progressão

Escolha explícita do operador.
A progressão do funil cumulativo é a ordem do quadro com a etapa `lost` REMOVIDA.
Um lead perdido não tem caminho conhecido; colocá-lo numa etapa anterior inventaria um e inflaria o topo com leads que talvez nunca chegaram lá.
Ele é reportado à parte, num aside `[data-funnel-lost]` abaixo das barras, sem share, nunca no afunilamento.
O total do rodapé continua cobrindo TODOS os leads (lost incluído) e é idêntico nas duas formas, para o número grande não "pular" ao trocar de forma.

## Alternativas rejeitadas

- Contar o Perdido como última etapa (cumulativo em todas): simples, mas mente - um lead perdido no "Novo" apareceria em "Proposta".
- Perdido cumulativo só na própria linha: mistura dois conceitos na mesma barra, confunde.
- Nova 4ª aba no topo: duplicaria o toggle Faturamento/Volume e lotaria a barra superior; o sub-toggle no Funil é mais enxuto.

## Consequências

- `buildCumulativeFunnel` é puro e testado (monotonicidade, aside do Perdido, ordem do quadro, conversão no fundo).
- A regra do Funil no `CLAUDE.md` (seção Edição Leads) e a referência `kanban-de-leads.md` foram atualizadas no mesmo passo.
- Gap conhecido / não automatizável: o olhar visual do afunilamento e do card do Perdido rodando no app real - vai no AUDIT do run.
