# Importação por planilha com Funil

Pace: economico
Gate 1: answered in the intake form (`1c 2a 3a 4a 5b`), then `siga em automatico` (autopilot).
Contract: `contracts/SEAM-CONTRACT.md` (authoritative for every name).

## What and why

An organization now has several funis, but the spreadsheet import writes every lead into the default funil.
The operator must be able to say in the Excel itself which funil each lead goes to, and see in the Excel which funis and which etapas of each funil exist.

## Acceptance (feature)

- A lead row naming a funil lands in that funil, in the etapa of that funil (blank etapa: its first open etapa).
- Blank Funil: accepted only while the organization has ONE active funil; with more, an error on the Funil column.
- A visible, read-only tab `Funis e etapas` lists every active funil with its etapas and is ignored on import.
- In Excel the Etapa dropdown offers only the etapas of the row's Funil.
- The Etapas tab has a Funil column with the same blank rule; the sheet never creates a funil.
- A funil name that does not exist (or is archived) is an error the operator can solve on the screen by choosing the destination funil.
- A vendedor who does not reach the row's funil is an error.
- Exportar leads fills Funil; a file exported from one org imports in another with the same funil name with no error.
- A sheet without the Funil column behaves as today in an org with one funil.

## Slices

| id | slice | depends_on |
| --- | --- | --- |
| 01 | 01-api-plano-por-funil | - |
| 02 | 02-api-modelo-e-exportacao | 01 |
| 03 | 03-web-mapear-funis | 01 |
