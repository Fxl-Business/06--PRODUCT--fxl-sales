# v4.1.0 - Sales-Finance control plane, hub-sdk 2.5.0, baixas and the leads kanban

Tag: `v4.1.0` at `42ea895`
Cut: 2026-10-01 (Gate 3a, tag only)
Promoted: 2026-10-02, never on its own: staging and production went from v4.0.0 straight to v4.2.0 (`24c75f6`), which contains this release.

## Accomplishments

- Sales-Finance control plane: outbox, cursor feed and puller, emitting nothing until a Hub Integration Activation is live.
- hub-sdk 2.5.0: Trocar conta and real seller invitations.
- Baixas, estornos and in-place proposta editing (`sales_ops_settlements`, migration `0024`).
- Kanban de leads (migration `0022`).
- Development identity mode, localhost-only dev servers and the local database guard.

Details, migrations and the operator checklist: `nexo/milestones/v4.1.0/RELEASE-NOTES.md`.
