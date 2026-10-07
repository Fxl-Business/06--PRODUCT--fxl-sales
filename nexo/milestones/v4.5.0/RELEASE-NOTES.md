# v4.5.0

## Novidades

- Leads sem vendedor viram um pool da equipe: todo vendedor vê os leads sem vendedor junto com os dele.
- O primeiro vendedor que mover ou editar um lead sem vendedor fica com ele; se dois tentarem ao mesmo tempo, só o primeiro leva.
- O gestor pode mover e editar sem assumir o lead.
- O card e a Lista mostram a marca "Sem vendedor - disponível".
- Funil de leads com duas formas: Acumulado (padrão, afunila do topo, Perdido à parte) e Composição (a visão anterior).

## Correções

- Mover ou criar leads da mesma coluna ao mesmo tempo não dá mais erro nem gera posição repetida na coluna.
- O selo de dias no card não quebra mais em duas linhas quando o nome do vendedor é longo.

## Operação

- Nenhuma migração, nenhuma variável de ambiente nova, nenhuma dependência nova; o rollback é só reverter o código.
- A regra de visibilidade mudou no servidor: a API de produção precisa estar em `b457400` para os vendedores verem o pool.
