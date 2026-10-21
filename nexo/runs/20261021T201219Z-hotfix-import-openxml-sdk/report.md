# Relatório: hotfix-import-openxml-sdk

## Status da solicitação
pass · Completo: 1 de 1 fatia, lançado em produção como v4.7.2.
Pedido: Importação recusa .xlsx gravado pelo Open XML SDK como arquivo inválido

## Entregue
- 01-import-openxml-sdk  ba1505f  A importação por planilha passa a aceitar arquivos .xlsx regravados por ferramentas do Open XML SDK (como o do cliente, que era recusado como arquivo inválido). O modelo gerado ganhou no Leia-me a seção Como salvar o arquivo. Em produção como v4.7.2 (v4.7.1 mais só esta correção) e no master em bd42fe3.

## Não feito e por quê
- nada a registrar.

## Decisões tomadas sem você
- Normalizar o pacote .xlsx antes do exceljs em vez de trocar de biblioteca de leitura (apps/api/src/domains/import/xlsx-package.ts) (escolhido: a; alternativas: b) trocar o exceljs por outra biblioteca de leitura)
- Rodar a integração da v4.7.2 num banco local novo e isolado, porque o banco de teste compartilhado já está no schema do master (nexo/runs/20261021T201219Z-hotfix-import-openxml-sdk/agents/release-verify-v4.7.2-integration.md) (escolhido: a; alternativas: b) aceitar o Gate 2 sem integração)

## Perguntas
1. A API de produção (AWS) já está rodando ba1505f? O /health mostra version unknown, então não deu para confirmar daqui.
   a) Sim, o deploy da API pegou a v4.7.2
   b) Ainda não, a API precisa de deploy manual
   c) outra: ___

Responda para retomar: <n><k>
