# Run 20260706-1620-hub-auth-fxl-sales

Mode: autopilot
Base: `af44aa3`
Feature plan: `nexo/plans/20260706-hub-auth-fxl-sales/00-OVERVIEW.md`

## Frame

Integrate the product with FXL Hub for `product.fxl-sales`, migrate off Clerk through reversible flags, and rename app identity to `fxl-sales` while keeping the repository folder name unchanged.

## Slice Log

- 01-identity-and-config: completed.
- 02-api-hub-bff-auth: completed.
- 03-web-hub-client-auth: completed.
- 04-clerk-operational-cutover: completed.
- 05-rename-visible-identity: completed.
- 06-verify-capture: completed.

## Verification

- `pnpm run type-check` passed.
- `pnpm run lint` passed with zero warnings.
- `pnpm test` passed.
- `pnpm run build` passed.
- `pnpm --filter @fxl-sales/api test:integration` passed.
- `pnpm run perf:audit` passed.
- Legacy product identity grep returned no matches outside ignored build/dependency folders.
- Hub secret prefix grep returned no tracked matches.

## Notes

- Browser visual verification was blocked because no in-app browser backend was available in this Codex session.
- The root folder name remains unchanged by request.
- Existing `fxl_finders_*` database names and roles remain unchanged because renaming them is an ops/schema migration.
