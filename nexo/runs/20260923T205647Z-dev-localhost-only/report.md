# Relatório: dev-localhost-only

## Status da solicitação
pass · Completo: 1 de 1 fatia.
Pedido: Bind all local dev services to localhost only (Vite web, API server, docker-compose published ports) and make bare `make` print a help listing every target, including dev-fake/back-fake/front-fake.

## Entregue
- 01-dev-localhost-only  24951f5  O Vite e a API agora escutam só em localhost em desenvolvimento, e as portas do docker-compose (3006 e 5006) ficam presas em 127.0.0.1. O `make` sem argumento mostra todos os alvos agrupados por seção, incluindo dev-fake, back-fake, front-fake e dev-fake-setup.

## Não feito e por quê
- nada a registrar.

## Decisões tomadas sem você
- Vite usa `host: 'localhost'`, não 127.0.0.1, para a origem continuar igual ao CORS_ORIGIN e ao callback do Hub. (apps/web/vite.config.ts)
- A API só restringe fora de produção; em produção mantém o padrão do runtime, que o mapeamento de porta do container exige. (apps/api/src/config/listen-host.ts)
- O override se chama SALES_LISTEN_HOST, não HOST, porque alguns shells exportam HOST com o nome da máquina. (apps/api/src/env.ts)
- O docker-compose define SALES_LISTEN_HOST=0.0.0.0 dentro do container e publica as portas só em 127.0.0.1. (docker-compose.yml)

## Perguntas
- nada a registrar.
