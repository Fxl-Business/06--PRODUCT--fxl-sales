# v4.14.0 - Importação por planilha por funil

Tag: `v4.14.0` at `f75f10b5`
Cut: 2026-11-23
Flow: `/nexo-ship-prod-ready` (Gate 3 carried by the invocation)
Chain: `main == staging == production == f75f10b5` at the promotion.
Release-verify: PASS at `f75f10b5` by a separate agent (deploy-shaped cold builds, lint, type-check, unit 4054, integration 589, acceptance suites, security review).
Vercel Production deployment for `f75f10b5`: success; `https://sales.fxlbusiness.com` switched from `index-6HQBEPll.js` to `index-Dct4Kkll.js`, which carries the release-only string `Mapear funis`.
The production API deploy (AWS) is not observable from here: `/health` answered 200 with `version: unknown`.

## Accomplishments

- Leads and Etapas tabs carry a `Funil` column, and each lead lands in the funil and etapa of its row.
- The template has a visible `Funis e etapas` tab and an Etapa dropdown that depends on the row's Funil.
- `Mapear funis` solves a funil name that does not exist here; a vendedor without access to the funil is refused.
- The export writes the funil of each lead.

## Open items

- Confirm the production API: a freshly downloaded template must have the `Funis e etapas` tab.
- The Etapa dropdown formula was evaluated in LibreOffice, not in Excel; Google Sheets may not show it.
- v4.8.0 to v4.13.0 were tagged and promoted with no milestone record in `nexo/milestones/`.
