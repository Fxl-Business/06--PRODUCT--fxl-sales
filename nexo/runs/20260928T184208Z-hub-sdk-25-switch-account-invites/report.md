# Relatório: hub-sdk-25-switch-account-invites

## Status da solicitação
pass · 15 fatias entregues e mergeadas no `master` local (9 planejadas e 6 adicionadas na execução), cada uma com Gate 2 por agente separado, verify integrado por onda, mutation manual no limite da feature e verify final em `cc5c21d`. Sem push, sem promoção.
Pedido: subir para `@fxl-business/hub-sdk` 2.5.0, oferecer "Trocar conta" e fazer o cadastro de vendedor enviar um convite real do Hub, com listar, reenviar e revogar.

## Entregue
- 01-sdk-bump-2.5.0  6d79f63  SDK pinado exatamente em 2.5.0 nos dois apps, com o guard `hub-sdk-pin` (sem `hub-sdk-testing`; uma única cópia do Hono, 4.12.28).
- 06-sellers-invitation-schema  5b1a581  Migration `0026_seller_invitation_state`: três colunas nulas em `sellers`.
- 07-invitations-client-seam  0f96c20  Cliente de convites único, `mapInvitationError` pelo `code` e o gate `isAppAuthAdapterInstalled()`.
- 02-web-switchaccount-seam  eb6470a  `switchAccount` passa pelo provider, com um guard contra `prompt=` montado à mão.
- 03-trocar-conta-account-menu  5ce555b  "Trocar conta" e avatar no menu da conta.
- 05-trocar-conta-no-role  b6e797d  "Trocar conta" e a conta ativa na página `/no-role`.
- 08-seller-invite-server  c316ea3  O cadastro envia o convite. `POST /:id/resend` e `POST /:id/revoke` agem sobre o convite guardado, e o `GET /` concilia o estado com o Hub.
- 04-trocar-conta-entitlement-panel  78a4a27  "Trocar conta" e a conta ativa no painel do 402.
- 09-admin-sellers-invite-ui  e3ebccb  Estado do convite na tela de admin, com reenviar, revogar e avisos e erros mapeados pelo `code`.
- 11-invite-locale-and-429-body  6eb69ca  O idioma do convite segue a interface; teste do 429 com o tempo de espera só no corpo.
- 10-verify-findings-polish  81f39ed  Pendências não bloqueantes do Gate 2:
  - um `AccountAvatar` só, compartilhado pelas três telas;
  - reenviar e revogar respondem 404 para vendedor de outra Organização;
  - teste do admin gate no router real;
  - a integração recusa superusuário e host remoto.
- 12-integration-test-hygiene  1bff154  Teste instável que já existia antes corrigido na causa; fallbacks mortos para `postgres` removidos.
- 15-mutation-survivors  6436901  Bug de clique duplo no painel do 402 e três lacunas de teste.
- 13-integration-env-docs  231238d  `.env.dev.example` documenta as variáveis de integração. O script de testes agora falha se um guard listado não existir, e o guard perdido `dev-identity-docs-reconciliation` foi escrito.
- 14-send-invite-to-uninvited-seller  cc5c21d  `POST /:id/invite` e a ação "Enviar convite", para que um convite que falhou no cadastro possa ser enviado de novo.

## Não feito e por quê
- teste-real-hub-finance  skip · not_applicable
  O dono pediu para ignorar testes em staging e produção nesta sessão. O caminho real (o Hub com `API_PUBLIC_URL`, o e-mail de convite e o `switchAccount` no `/authorize` real) segue sem execução fora do modo fake. Auditoria: `AUDIT.md`.
- dockerfile-migrations  skip · decisão do dono
  O `apps/api/Dockerfile` continua rodando `migrate.js` quando o container sobe. Auditoria: `AUDIT.md`.

## Decisões tomadas sem você
- Uma falha de convite no cadastro responde `201`, com o resultado no corpo, porque o vendedor foi criado; reenviar e revogar respondem o status mapeado. (ADR 2026-10-01)
- O `GET /` chama o `list()` uma vez por status, porque o padrão do SDK devolve só `pending`. (ADR 2026-10-01)
- "Enviar convite" também aparece em linhas com convite revogado, porque o Hub não reenvia um convite revogado. (fatia 14)
- Seis fatias foram adicionadas durante a execução, a partir de achados de Verify, da mutation e do teste no navegador. (AUDIT.md)
- A emissão de `__tests__` para o `dist` da API foi registrada no ROADMAP em vez de corrigida aqui. (AUDIT.md)
