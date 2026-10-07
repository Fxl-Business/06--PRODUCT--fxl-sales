# Relatório: leads-funnel-cumulative

## Status da solicitação
pass · Completo: 1 de 1 fatia, em master (4f55541). Nao promovido - autopilot nao faz Gate 3. 1 item visual no AUDIT.md pra voce conferir a olho.
Pedido: Funil de leads: ter duas visualizacoes - a Composicao atual e um funil Acumulado de verdade (cumulativo), com Perdido tratado a parte.

## Entregue
- 01-funnel-cumulative-shape  4f55541  A view Funil ganhou um toggle Acumulado/Composicao (default Acumulado). Acumulado conta cada lead em toda etapa anterior (suposicao linear, nao ha historico), afunilando do topo cheio com '% do topo'; a etapa Perdido fica fora da progressao, num card a parte. Composicao e a visualizacao anterior, intacta. Faturamento/Volume vale pras duas, e o total do rodape nao muda entre as formas.

## Não feito e por quê
- nada a registrar.

## Decisões tomadas sem você
- Default = Acumulado (a view se chama Funil e essa e a forma que afunila de verdade). (apps/web/src/sales-ops/leads/LeadsFunnelView.tsx)
- Perdido fora da progressao, num aside (sem historico, colocar numa etapa anterior inventaria um caminho). (apps/web/src/sales-ops/leads/calculations.ts)
- Share do Acumulado = retencao a partir do topo ('% do topo'); largura da barra arredondada a inteiro, batendo com o %. (apps/web/src/sales-ops/leads/LeadsFunnelView.tsx)

## Perguntas
- nada a registrar.
