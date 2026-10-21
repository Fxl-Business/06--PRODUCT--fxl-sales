# Funil padrao e guard de migracoes aditivas

## Funil CRM padrao

The default CRM pipeline is one pure constant in `packages/shared-utils/src/default-pipeline.ts`, exposed on the `@fxl-sales/shared-utils/default-pipeline` subpath.
It has seven stages in order: Novo, Qualificacao, Em negociacao, Proposta, Ganho, Perdido, Pausado.
Proposta is the only `orcamento` stage.
Ganho, Perdido and Pausado are `saida` stages with exit kinds `ganho`, `perdido` and `pausado`.
Nothing seeds from the constant yet, and today's `LEAD_STAGE_SEEDS` is unchanged.

## Transicoes permitidas

There are exactly 22 allowed transitions, and nothing else is allowed.
Each open stage moves forward one step, and each stage except Novo moves back one step.
Each open stage may go to any of the three exits.
Pausado returns to any open stage.
Ganho and Perdido are terminal, so no transition starts from them.
The test `default-pipeline.test.ts` writes the list twice, once literally and once derived from the rule, so changing one without the other fails.

## Mapeamento legado

Today's four `LEAD_STAGE_SEEDS` map onto the pipeline as Novo to `novo`, Em negociacao to `em-negociacao`, Proposta to `proposta`, and Perdido to `perdido`.
Legacy kinds map as `normal` to `normal`, `conversion` to `orcamento`, and `lost` to `saida` with exit kind `perdido`.
Qualificacao, Ganho and Pausado have no legacy counterpart, and a later backfill must create them.
`default-pipeline-parity.test.ts` proves the mapping against migration 0022's VALUES text.

## Guard de migracoes aditivas

`apps/api/src/db/__tests__/additive-migrations-guard.test.ts` scans every migration numbered above 0028 and fails on a forbidden statement.
The forbidden statements are DROP, DELETE FROM, TRUNCATE, RENAME, a column type change, GRANT, REVOKE, CREATE or ALTER ROLE and USER, and BYPASSRLS.
The scanner is `apps/api/src/db/__tests__/additive-migration-scan.ts`, and it removes comments and quoted literals before matching.
Two decisions are part of the rule.
`ON DELETE RESTRICT` and `ON DELETE CASCADE` clauses are allowed, because a clause does not remove data by itself and the CASCADE ban on history foreign keys stays a review rule.
GRANT and REVOKE are forbidden outright after 0028, which is the single-role database contract.
Positive and negative controls in the same test prove that the scanner sees each forbidden statement and ignores additive SQL.
The scanner cannot see SQL assembled inside dynamic strings, so review remains the backstop.
