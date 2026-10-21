# Relatório: hotfix-import-openpyxl

## Status da solicitação
pass · Completo: 1 de 1 fatia, lançado em produção como v4.7.3.
Pedido: Importação recusa planilha salva por IA (openpyxl) como arquivo inválido

## Entregue
- 01-import-openpyxl  2e9ddbf  A importação aceita a planilha depois que o ChatGPT ou o Claude a abrem e salvam (openpyxl), que antes era recusada como arquivo inválido mesmo na v4.7.2. O Leia-me do modelo agora traz instruções escritas para o assistente de IA. Em produção como v4.7.3 e no master em 3323407; o arquivo da Mesa foi atualizado com o mesmo texto.

## Não feito e por quê
- nada a registrar.

## Decisões tomadas sem você
- Identificar comentários e desenhos pelo tipo de relação, não pelo caminho do arquivo (apps/api/src/domains/import/xlsx-package.ts) (escolhido: a; alternativas: b) tratar só os nomes que o openpyxl usa)
- O Leia-me fala com o assistente de IA e diz a ele para usar openpyxl.load_workbook e save, sem recriar a planilha (apps/api/src/domains/import/template.ts) (escolhido: a; alternativas: b) manter o texto para a pessoa salvar no Excel do computador)

## Perguntas
1. A API de produção (AWS) já está rodando 2e9ddbf? O /health mostra version unknown, então não deu para confirmar daqui.
   a) Sim, o deploy da API pegou a v4.7.3
   b) Ainda não, a API precisa de deploy manual
   c) outra: ___

Responda para retomar: <n><k>
