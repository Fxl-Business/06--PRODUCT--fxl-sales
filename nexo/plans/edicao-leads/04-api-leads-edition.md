---
id: 04-api-leads-edition
milestone: v4.3.0
status: done
depends_on: [02-api-edition-gate, 03-lead-contact-columns]
files_modified:
  - apps/api/src/domains/sales-ops/leads/lead-schemas.ts
  - apps/api/src/domains/sales-ops/leads/lead-service.ts
  - apps/api/src/domains/sales-ops/leads/lead-routes.ts
  - apps/api/src/domains/sales-ops/service.ts
  - apps/api/src/domains/sales-ops/routes.ts
  - apps/api/src/domains/sales-ops/leads/__tests__/contact-lead-contract.test.ts
  - apps/api/src/domains/sales-ops/leads/__tests__/lead-routes-edition.test.ts
  - apps/api/src/domains/sales-ops/leads/__tests__/leads-edition-no-seed.test.ts
  - apps/api/src/domains/sales-ops/__tests__/people-routes-edition.test.ts
  - apps/api/test/rls/leads-edition.test.ts
  - nexo/knowledge/reference/kanban-de-leads.md
  - nexo/knowledge/reference/pessoas-e-funcoes.md
acceptance: "With salesEdition 'leads', POST/PATCH /api/v1/sales-ops/leads accept exactly ContactLeadFieldsSchema (strict; contactName required on create; phone/email/birth-day normalized, a future or impossible birth day and a bad e-mail rejected; null or '' clears contactPhone, contactEmail, contactBirthDate, description and sellerPersonId per SEAM A2) and store client_id NULL, client_name_snapshot '', estimated_value_brl 0 and no product rows; every lead response (list, get, create, update, move) carries contactPhone, contactEmail and contactBirthDate; creating a lead with no active normal etapa answers the EXISTING 400 {error:'validation_error',reason:'no_open_stage',itemIndex:-1}; seller scoping is unchanged; POST/PATCH /people in the leads edition always leave the pessoa with exactly the vendedor função (an empty funcaoIds never answers funcao_required) and seed both system funções in the same transaction, while a status-only PATCH leaves the função set untouched (SEAM A3); with salesEdition 'full' or absent every existing request, schema, body and service call arity is byte-identical, and the full schemas still reject the three new keys."
goal: "Make the lead and pessoa write paths edition-aware on the API (SEAM-CONTRACT section 2, from 'Lead contact fields' to the end) so the leads edition can run a contact-only Kanban with vendedor-only pessoas, while FXL (edition full) stays byte-for-byte unchanged."
must_not_break:
  - "pnpm --filter @fxl-sales/api test (whole unit suite, including src/domains/sales-ops/__tests__/routes.test.ts and leads/__tests__/lead-routes.test.ts and lead-contract.test.ts UNCHANGED)"
  - "pnpm --filter @fxl-sales/api test:integration (whole integration suite, including test/rls/leads-seller-scope.test.ts, leads-no-financial-impact.test.ts, src/domains/import/__tests__/executor.integration.test.ts and import-routes.integration.test.ts)"
  - "pnpm --filter @fxl-sales/api type-check (tsconfig.json, tsconfig.scripts.json, tsconfig.test.json)"
  - "pnpm --filter @fxl-sales/api lint"
  - "src/domains/import/** compiles and behaves unchanged (createLead/createPerson called with today's arity)"
oracle:
  - apps/api/test/rls/leads-edition.test.ts
  - apps/api/src/domains/sales-ops/leads/__tests__/contact-lead-contract.test.ts
  - apps/api/src/domains/sales-ops/leads/__tests__/lead-routes-edition.test.ts
  - apps/api/src/domains/sales-ops/leads/__tests__/leads-edition-no-seed.test.ts
  - apps/api/src/domains/sales-ops/__tests__/people-routes-edition.test.ts
rules:
  - "Names are EXACTLY those of SEAM-CONTRACT.md: ContactLeadFieldsSchema, CreateContactLeadSchema, UpdateContactLeadSchema, contactPhone, contactEmail, contactBirthDate, salesEdition, leadFieldSet, ensureSystemFuncoes. Import edition code only from '@fxl-sales/shared-utils/sales-edition' and day helpers only from '@fxl-sales/shared-utils/sao-paulo-day' (subpaths, never the package root)."
  - "CreateLeadSchema, UpdateLeadSchema, MoveLeadSchema, ListLeadsQuerySchema and the private LeadFieldsSchema are byte-unchanged. PersonSchema and UpdatePersonSchema are byte-unchanged."
  - "createLead(db, orgId, input, scope) and updateLead(db, orgId, id, input, scope) keep their exported signatures and input types; the import executor is not edited."
  - "In the full edition (salesEdition 'full' OR absent) the route calls createPerson / updatePerson with EXACTLY today's arguments (3 and 5 args); the existing toHaveBeenCalledWith oracles in routes.test.ts must pass unedited."
  - "Do NOT add a new error code for an absent stage: the existing LeadInputError 'no_open_stage' (400 validation_error) IS the no_stage answer (SEAM-CONTRACT: 'keep the existing code if one already exists')."
  - "No code path added by this slice may call ensureLeadStages / ensureLeadStagesForOrg or write a lead stage. lead-service.ts must still contain no isSeller/isFinder/isCollaborator, no audit writer, no getAdminDb and no salesOpsClients."
  - "Do not edit existing test files. All new oracles live in NEW files listed above."
  - "No em dash (U+2014) anywhere; relative imports use '.js'; one sentence per line in Markdown."
  - "Run-once commands only (vitest run). Never a bare vitest or a watcher."
verifier_focus: "That the full-edition path is truly unchanged (same schema object, same call arity, routes.test.ts and lead-routes.test.ts untouched and green); that the leads-edition create really writes client_id NULL / '' / 0 / zero product rows (asserted over the admin connection, not only through the view); that people in the leads edition get exactly [vendedor] even when the body names another valid função id, an unknown uuid or an empty list, while a status-only PATCH leaves the função rows untouched (SEAM A3); that an org with zero funções ends with both system funções after one leads-edition person write; that no_open_stage fires for zero stages AND for 'only normal stage archived'; and that the no-seed scan is non-vacuous (it finds stages-seed.ts itself)."
---

# Slice 04 - API leads edition

## Objective

After slices 02 and 03, every request carries `c.get('salesEdition')` and `sales_ops_leads` has the three nullable contact columns.
This slice makes the lead and pessoa write paths use them:

- the leads edition writes leads through a contact-only strict schema and stores no empresa, value or produtos;
- every lead read projection gains the three contact fields (null for FXL);
- an absent open etapa keeps answering the existing `no_open_stage` refusal;
- in the leads edition a pessoa is always exactly a vendedor, with the system funções seeded in the same transaction.

The full edition (FXL) is byte-for-byte unchanged and proven so by the untouched existing suites plus new FXL oracles.

## Code facts (verified while planning)

- `apps/api/src/domains/sales-ops/leads/lead-schemas.ts` imports only `zod`; its private `LeadFieldsSchema` is NOT exported; `CreateLeadSchema = LeadFieldsSchema.strict()`, `UpdateLeadSchema = LeadFieldsSchema.partial().strict()`.
  The full `description` is `z.string().max(4000).nullish()` (no trim); `contactName` is `z.string().trim().min(1).max(140)`; `sellerPersonId` is `uuid.nullish()`.
- `apps/api/src/domains/sales-ops/leads/lead-service.ts`:
  - `createLead(db, orgId, input: CreateLeadInput, scope)` opens `withTenant`, resolves the seller gate, the seller, the client name, then picks the first ACTIVE `kind = 'normal'` stage and throws `new LeadInputError('no_open_stage')` when there is none (line ~590).
  - `lead-routes.ts` maps any `LeadInputError` to `400 {"error":"validation_error","reason":<code>,"itemIndex":-1}`.
    So the "no stage" case ALREADY has a code: `no_open_stage`. This slice reuses it and adds nothing.
  - `updateLead(db, orgId, id, input: UpdateLeadInput, scope)` builds the `set` object by conditional spreads from `input`.
  - `moveLead` only reads the DESTINATION stage's `kind`; `lost` needs a reason, `conversion` needs a saleId, any other kind refuses a saleId.
    With only `normal` stages it works unchanged; nothing requires a conversion or lost stage to exist.
  - `toLeadView(lead, saleStatus, saleCode, products)` is the ONE projection used by list, get, create, update and move (via `readLeadView`).
  - `lead-contract.test.ts` scans lead-service.ts and forbids `isSeller|isFinder|isCollaborator|is_seller|...`, `writeAuditEntry|auditCadastroLifecycle|auditLog`, `getAdminDb`, `salesOpsClients`, `insert(salesOpsSales)`.
- Lead stages are seeded ONLY by `ensureLeadStages` (`leads/stages-seed.ts`), whose only non-test caller is `apps/api/src/domains/import/routes.ts` (gated by the `import` capability in slice 02), plus migration 0022 for orgs that existed at that deploy.
  `listLeadStages` does NOT seed. `createLeadStage` only mints `kind: 'normal', isSystem: false`. So a new leads-edition org starts and stays with zero system etapas.
- The import domain uses `CreateLeadSchema` (plan/leads.ts, executor.ts, workbook-schema.test.ts reads `CreateLeadSchema.shape.contactName/clientName/description`) and calls `createLead(tx, orgId, parsed.data, scope)` and `createPerson(tx, orgId, parsed.data)`. It never touches `LeadFieldsSchema` (not exported) or the view. None of that changes.
- `apps/api/src/domains/sales-ops/service.ts`:
  - `PersonSchema = PersonFieldsSchema` (`funcaoIds: z.array(uuid).optional()`, deprecated `isSeller/isFinder/isCollaborator`), `UpdatePersonSchema = PersonFieldsSchema.partial()`.
  - `planPersonFuncoes(input, mode)` returns `{kind:'ids'}`, `{kind:'slugs'}`, `{kind:'unchanged'}` or `'funcao_required'`.
  - `resolvePersonFuncoes(tx, orgId, plan)` seeds a legacy slug on demand (race-safe) for the `slugs` plan.
  - `ensureSystemFuncoes(tx, orgId)` seeds `vendedor` and `finder` (`SYSTEM_FUNCAO_SLUGS`) through that same path; it is a hoisted function declaration, callable from `createPerson`.
  - `createPerson(db, orgId, data)`; `updatePerson(db, orgId, id, data, actor)`; both run in one `withTenant` transaction and replace the full função set when the plan is not `unchanged`.
- `src/domains/sales-ops/__tests__/routes.test.ts` asserts `createPerson` with `toHaveBeenCalledWith(mockedDb, 'verified-org', matcher)` (exactly 3 args) and `updatePerson` with exactly 5 args.
  Adding a trailing argument on the full path would break them, so the full path keeps today's call verbatim.
- `lead-routes.test.ts` asserts `createLead.mock.calls[n][1]` and `[3]` only, and never sets `salesEdition`.
- Integration tests call the SERVICE functions directly over two drizzle connections (`db` = app role under RLS, `adminDb` = `app.fxl_admin`), see `test/rls/leads-seller-scope.test.ts`; URLs come from `testDatabaseUrls()` in `src/db/__tests__/test-database-urls.ts`.
  They are collected by `VITEST_INTEGRATION=1` from `test/rls/**/*.test.ts`; `global-setup.ts` migrates first, so migration 0027 (slice 03) is applied before the file runs.
- postgres.js parses a `date` column into a JS `Date`; raw-SQL assertions on `contact_birth_date` must select `contact_birth_date::text`.
- Drizzle `contactBirthDate` is `date('contact_birth_date', { mode: 'string' })` (slice 03), so the view projects the `YYYY-MM-DD` string as is.
- `tsconfig.base.json` has `exactOptionalPropertyTypes: false`; zod is `^3.24` (`.toLowerCase()` exists); hono `ContextVariableMap` is augmented globally, and slice 02 adds `salesEdition: SalesEdition` to it.

## Design decisions (final, not for the executor to revisit)

1. Leads use two NEW exported service functions, `createContactLead` and `updateContactLead`, beside the unchanged `createLead` / `updateLead`.
   All four delegate to two private functions (`insertLead`, `applyLeadUpdate`) holding today's bodies, so the gate, scope, seller and stage rules exist once.
   Reason: the input types differ (contact vs full), existing callers (import executor, every integration test) keep compiling unchanged, and there is no cast.
2. People use one trailing optional parameter, `options: PersonWriteOptions = {}` with `export type PersonWriteOptions = { edition?: SalesEdition }`, on `createPerson` and `updatePerson`.
   The ROUTE passes it only when the edition is `'leads'`, so the full path keeps today's exact arity.
3. The edition at a route is always read as `c.get('salesEdition') ?? 'full'` (same fail-to-full rule as `requireCapability`).
4. `no_stage` is the existing `LeadInputError('no_open_stage')`, `400 {"error":"validation_error","reason":"no_open_stage","itemIndex":-1}`. Web slice 06 keys on `reason === 'no_open_stage'`.

## Step 1 - `lead-schemas.ts` (append; full schemas untouched)

1. Replace the first line of the file header comment `The lead entity's wire contract. Imports ONLY zod - no database, no service -` with `The lead entity's wire contract. Imports only zod and the pure sao-paulo-day subpath - no database, no service -` (the rest of the comment stays).
2. Add, right after `import { z } from 'zod';`:

```ts
import { isAfterTodayInSaoPaulo, isIsoDay } from '@fxl-sales/shared-utils/sao-paulo-day';
```

3. Append at the END of the file (after the existing type exports), exactly:

```ts
/**
 * The LEADS EDITION wire contract (edicao-leads, SEAM-CONTRACT section 2).
 *
 * A separate schema rather than a widened LeadFieldsSchema, on purpose: the full
 * schemas above stay byte-identical and `.strict()`, so an FXL client can never
 * send a contact key, and a leads-edition client can never send an empresa,
 * produtos or a value. The route picks one by `leadFieldSet(salesEdition)`.
 *
 * Every optional text normalizes the same way: trimmed, and an empty string is
 * stored as NULL ("cleared"), while an ABSENT key stays absent (PATCH semantics).
 */
function blankToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  return value === '' ? null : value;
}

const ContactPhoneSchema = z.string().trim().max(40).nullish().transform(blankToNull);

const ContactEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((value) => value === '' || z.string().email().safeParse(value).success, {
    message: 'contactEmail must be a valid e-mail address',
  })
  .nullish()
  .transform(blankToNull);

/** A civil day, never after today in Sao Paulo. Compared as a string, never through Date. */
const ContactBirthDateSchema = z
  .string()
  .trim()
  .refine((value) => value === '' || isIsoDay(value), {
    message: 'contactBirthDate must be a real calendar day (YYYY-MM-DD)',
  })
  .refine((value) => value === '' || !isAfterTodayInSaoPaulo(value), {
    message: 'contactBirthDate cannot be in the future',
  })
  .nullish()
  .transform(blankToNull);

export const ContactLeadFieldsSchema = z
  .object({
    contactName: z.string().trim().min(1).max(140),
    contactPhone: ContactPhoneSchema,
    contactEmail: ContactEmailSchema,
    contactBirthDate: ContactBirthDateSchema,
    // A2: null clears, '' is read as null, absent stays absent (PATCH semantics).
    description: z.string().trim().max(4000).nullish().transform(blankToNull),
    sellerPersonId: z.preprocess((value) => (value === '' ? null : value), uuid.nullish()),
  })
  .strict();

export const CreateContactLeadSchema = ContactLeadFieldsSchema;
export const UpdateContactLeadSchema = ContactLeadFieldsSchema.partial().strict();

export type CreateContactLeadInput = z.infer<typeof CreateContactLeadSchema>;
export type UpdateContactLeadInput = z.infer<typeof UpdateContactLeadSchema>;
```

Note: `isAfterTodayInSaoPaulo(day, now = new Date())` exists in `packages/shared-utils/src/sao-paulo-day.ts`; the refine reads the clock at parse time, which is request time.
`isIsoDay` runs first, so `isAfterTodayInSaoPaulo` only ever sees a real day.

## Step 2 - `lead-service.ts`

1. Extend the type import from `./lead-schemas.js` with `CreateContactLeadInput` and `UpdateContactLeadInput`.
2. `LeadView` gains three fields, inserted right after `description: string | null;`:

```ts
  /** Leads-edition contact data (edicao-leads). Always present; null for FXL leads. */
  contactPhone: string | null;
  contactEmail: string | null;
  /** ISO civil day `YYYY-MM-DD`; never formatted through Date. */
  contactBirthDate: string | null;
```

3. `toLeadView` gains, right after `description: lead.description,`:

```ts
    contactPhone: lead.contactPhone,
    contactEmail: lead.contactEmail,
    contactBirthDate: lead.contactBirthDate,
```

4. Replace the exported `createLead` with the private `insertLead` plus two thin exported wrappers.
   Insert above it:

```ts
/**
 * The one normalized record both create paths insert. Internal: the full and the
 * leads-edition wire shapes are mapped onto it by the two exported wrappers
 * below, so the scope, seller and stage rules exist exactly once.
 */
type LeadCreateRecord = {
  contactName: string;
  clientId: string | null;
  clientName: string;
  estimatedValueBrl: number;
  description: string | null;
  sellerPersonId: string | null;
  products: LeadProductInput[];
  contactPhone: string | null;
  contactEmail: string | null;
  contactBirthDate: string | null;
};
```

   Then:

```ts
export function createLead(
  db: Db,
  orgId: string,
  input: CreateLeadInput,
  scope: LeadScope,
): Promise<WriteLeadResult> {
  return insertLead(
    db,
    orgId,
    {
      contactName: input.contactName,
      clientId: input.clientId ?? null,
      clientName: input.clientName,
      estimatedValueBrl: input.estimatedValueBrl,
      description: input.description ?? null,
      sellerPersonId: input.sellerPersonId ?? null,
      products: input.products,
      contactPhone: null,
      contactEmail: null,
      contactBirthDate: null,
    },
    scope,
  );
}

/**
 * The leads-edition create. No empresa, no value and no produtos exist in that
 * edition, so the NOT NULL columns get their neutral values: client_id NULL,
 * client_name_snapshot '' and estimated_value_brl 0, and no product row.
 */
export function createContactLead(
  db: Db,
  orgId: string,
  input: CreateContactLeadInput,
  scope: LeadScope,
): Promise<WriteLeadResult> {
  return insertLead(
    db,
    orgId,
    {
      contactName: input.contactName,
      clientId: null,
      clientName: '',
      estimatedValueBrl: 0,
      description: input.description ?? null,
      sellerPersonId: input.sellerPersonId ?? null,
      products: [],
      contactPhone: input.contactPhone ?? null,
      contactEmail: input.contactEmail ?? null,
      contactBirthDate: input.contactBirthDate ?? null,
    },
    scope,
  );
}
```

   `insertLead(db: Db, orgId: string, record: LeadCreateRecord, scope: LeadScope): Promise<WriteLeadResult>` is today's `createLead` body (the existing comments stay) with exactly these substitutions:
   - `const requestedSeller = input.sellerPersonId ?? null;` becomes `const requestedSeller = record.sellerPersonId;`
   - `const clientName = input.clientId ? await resolveClientName(tx, orgId, input.clientId) : input.clientName;` becomes the same with `record.`
   - in `.values({...})`: `contactName: record.contactName`, `clientId: record.clientId`, `clientNameSnapshot: clientName`, `estimatedValueBrl: record.estimatedValueBrl`, `description: record.description`, and add right after `description`: `contactPhone: record.contactPhone, contactEmail: record.contactEmail, contactBirthDate: record.contactBirthDate,`
   - `await replaceLeadProducts(tx, orgId, lead!.id, input.products);` becomes `record.products`.
   - The stage lookup and `throw new LeadInputError('no_open_stage')` stay byte-identical. Add one comment line above the throw: `// The edition-independent "no etapa yet" answer; the leads edition starts with zero etapas (edicao-leads AC4).`

5. Replace the exported `updateLead` with a private `applyLeadUpdate` plus two wrappers.
   Insert:

```ts
/**
 * Everything a lead PATCH may carry, across both editions. The full wire schema
 * never produces the three contact keys and the contact schema never produces
 * clientId, clientName, estimatedValueBrl or products, so each edition can only
 * touch its own columns.
 */
type LeadUpdatePatch = UpdateLeadInput & {
  contactPhone?: string | null | undefined;
  contactEmail?: string | null | undefined;
  contactBirthDate?: string | null | undefined;
};

export function updateLead(
  db: Db,
  orgId: string,
  id: string,
  input: UpdateLeadInput,
  scope: LeadScope,
): Promise<WriteLeadResult> {
  return applyLeadUpdate(db, orgId, id, input, scope);
}

/** The leads-edition PATCH. Leaves empresa, value and produtos untouched. */
export function updateContactLead(
  db: Db,
  orgId: string,
  id: string,
  input: UpdateContactLeadInput,
  scope: LeadScope,
): Promise<WriteLeadResult> {
  return applyLeadUpdate(db, orgId, id, input, scope);
}
```

   `applyLeadUpdate(db: Db, orgId: string, id: string, input: LeadUpdatePatch, scope: LeadScope): Promise<WriteLeadResult>` is today's `updateLead` body byte-for-byte, plus three spreads inserted in the `.set({...})` right after the `description` spread:

```ts
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
        ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
        ...(input.contactBirthDate !== undefined
          ? { contactBirthDate: input.contactBirthDate }
          : {}),
```

   If TypeScript rejects passing `UpdateContactLeadInput` as `LeadUpdatePatch` (it should not: every key is optional and the shared keys have equal types), fix it by widening `LeadUpdatePatch`, never with a cast.

6. `moveLead`, `listLeads`, `getLead`, `renumberStage`, `resolveCallerPersonId`, `resolveLeadScopePredicate` are not edited (they pick up the new fields through `toLeadView`).

## Step 3 - `lead-routes.ts`

1. Imports: add `CreateContactLeadSchema`, `UpdateContactLeadSchema` from `./lead-schemas.js`; add `createContactLead`, `updateContactLead`, `type WriteLeadResult` from `./lead-service.js`; add `import { leadFieldSet } from '@fxl-sales/shared-utils/sales-edition';`.
2. Add below `leadScope`:

```ts
/**
 * Which lead wire contract this request speaks, from the edition the auth
 * middleware resolved from the VERIFIED token. Absent means 'full', the same
 * fail-to-full rule requireCapability applies, so it can never change FXL.
 */
function usesContactFields(c: Context): boolean {
  return leadFieldSet(c.get('salesEdition') ?? 'full') === 'contact';
}

function validationResponse(c: Context, error: z.ZodError) {
  return c.json({ error: 'validation_error', issues: error.flatten() }, 400);
}
```

3. Replace the `POST /` handler with:

```ts
leadsRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  let result: WriteLeadResult;
  try {
    if (usesContactFields(c)) {
      const parsed = CreateContactLeadSchema.safeParse(body);
      if (!parsed.success) return validationResponse(c, parsed.error);
      result = await createContactLead(getDb(), c.get('orgId'), parsed.data, leadScope(c));
    } else {
      const parsed = CreateLeadSchema.safeParse(body);
      if (!parsed.success) return validationResponse(c, parsed.error);
      result = await createLead(getDb(), c.get('orgId'), parsed.data, leadScope(c));
    }
  } catch (error) {
    if (error instanceof LeadInputError) return leadInputErrorResponse(c, error);
    throw error;
  }
  if (!result.ok) return failureResponse(c, result.reason);
  return c.json({ lead: result.lead }, 201);
});
```

4. Replace the `PATCH /:id` handler the same way: the id check first (unchanged), then `body`, then `UpdateContactLeadSchema` + `updateContactLead(getDb(), c.get('orgId'), id.data, parsed.data, leadScope(c))` when `usesContactFields(c)`, else `UpdateLeadSchema` + `updateLead(...)`; same try/catch and the same `200 { lead }` answer.
5. `GET /`, `GET /:id`, `POST /:id/move` are not edited.
   The validation body is still `{ error: 'validation_error', issues: <flatten> }` and the status still 400, so the full-edition responses are byte-identical.

## Step 4 - `service.ts` (people)

1. Add `import type { SalesEdition } from '@fxl-sales/shared-utils/sales-edition';` with the other imports.
2. Add right after `planPersonFuncoes`:

```ts
/**
 * Optional, trailing and empty by default, so every existing caller (the
 * routes in the full edition, the import executor, the tests) keeps its exact
 * call. Only the leads edition passes it.
 */
export type PersonWriteOptions = { edition?: SalesEdition };

/**
 * In the leads edition a pessoa IS a vendedor (edicao-leads D4): the server
 * assigns the system `vendedor` função itself and ignores any funcaoIds or
 * deprecated booleans in the body. This override runs BEFORE
 * `planPersonFuncoes` (SEAM A3), so an empty `funcaoIds` never answers
 * `funcao_required`. An UPDATE that carries no função key at all (the
 * status-only `{status}` PATCH of Inativar / Reativar, or a name-only edit)
 * leaves the função set untouched. The full edition plans exactly as today.
 */
function planPersonFuncoesForEdition(
  input: Partial<PersonInput>,
  mode: 'create' | 'update',
  edition: SalesEdition,
): PersonFuncaoPlan {
  if (edition === 'leads') {
    const touchesFuncoes =
      input.funcaoIds !== undefined ||
      input.isSeller !== undefined ||
      input.isFinder !== undefined ||
      input.isCollaborator !== undefined;
    if (mode === 'update' && !touchesFuncoes) return { kind: 'unchanged' };
    return { kind: 'slugs', slugs: ['vendedor'] };
  }
  return planPersonFuncoes(input, mode);
}
```

3. `createPerson(db, orgId, data, options: PersonWriteOptions = {})`:
   - first statement inside `withTenant`: `const edition = options.edition ?? 'full';`
   - then `if (edition === 'leads') await ensureSystemFuncoes(tx, orgId);`
   - replace `planPersonFuncoes(data, 'create')` with `planPersonFuncoesForEdition(data, 'create', edition)`.
   - Everything else is unchanged.
4. `updatePerson(db, orgId, id, data, actor, options: PersonWriteOptions = {})`:
   - first statement inside `withTenant`: `const edition = options.edition ?? 'full';`
   - replace `planPersonFuncoes(data, 'update')` with `planPersonFuncoesForEdition(data, 'update', edition)`.
   - immediately after the `if (!current) return null;` line add `if (edition === 'leads') await ensureSystemFuncoes(tx, orgId);` (after the not-found check so a 404 seeds nothing).
   - Everything else is unchanged (contactEmail full-replace, hubAccountId, mirrors, audit).
5. `planPersonFuncoes` itself is NOT edited (it is exported and unit-tested).
6. `PersonFuncaoPlan` (service.ts ~line 415) already includes `{ kind: 'unchanged' }`, `{ kind: 'slugs', slugs }` and the `'funcao_required'` sentinel; the leads branch never returns the sentinel. No cast.

## Step 5 - `routes.ts` (people routes)

Replace only the service call in the two handlers.
POST:

```ts
  // The leads edition forces the função set to exactly [vendedor] in the service.
  // The full edition keeps today's exact three-argument call.
  const edition = c.get('salesEdition') ?? 'full';
  const person =
    edition === 'leads'
      ? await createPerson(getDb(), c.get('orgId'), parsed.data, { edition })
      : await createPerson(getDb(), c.get('orgId'), parsed.data);
```

PATCH:

```ts
  const edition = c.get('salesEdition') ?? 'full';
  const person =
    edition === 'leads'
      ? await updatePerson(getDb(), c.get('orgId'), c.req.param('id'), parsed.data, cadastroActor(c), {
          edition,
        })
      : await updatePerson(getDb(), c.get('orgId'), c.req.param('id'), parsed.data, cadastroActor(c));
```

The sentinel mapping (`isPersonFuncaoError`, 404) is unchanged.
Run prettier on the file (`pnpm --filter @fxl-sales/api exec prettier --write src/domains/sales-ops/routes.ts`) if lint reports formatting.

## Step 6 - Oracles (all NEW files)

### 6a `apps/api/src/domains/sales-ops/leads/__tests__/contact-lead-contract.test.ts` (pure unit)

Imports: `CreateLeadSchema`, `UpdateLeadSchema`, `CreateContactLeadSchema`, `UpdateContactLeadSchema`, `ContactLeadFieldsSchema` from `../lead-schemas.js`; `todayInSaoPaulo` from `@fxl-sales/shared-utils/sao-paulo-day`.
Cases:

1. `accepts a contact lead with only contactName`: `CreateContactLeadSchema.parse({ contactName: '  Ana  ' })` equals `{ contactName: 'Ana' }` (`toEqual`), and `Object.keys(result)` equals `['contactName']`.
2. `accepts and normalizes every contact field`: input `{ contactName: 'Ana', contactPhone: ' (11) 98888-7777 ', contactEmail: ' Ana@Example.COM ', contactBirthDate: '1990-05-17', description: 'Gosta de WhatsApp', sellerPersonId: '11111111-1111-4111-8111-111111111111' }` parses to the trimmed phone `'(11) 98888-7777'`, email `'ana@example.com'`, the same day, description and seller.
3. `stores a blank optional as null` (SEAM A2): `{ contactName: 'Ana', contactPhone: '', contactEmail: '   ', contactBirthDate: '', description: '  ', sellerPersonId: '' }` parses to all five optional keys `null`; and `{ contactName: 'Ana', contactPhone: null, contactEmail: null, contactBirthDate: null, description: null, sellerPersonId: null }` parses to the same five `null`s; `UpdateContactLeadSchema.parse({ description: '', sellerPersonId: null })` equals `{ description: null, sellerPersonId: null }`.
4. `rejects every full-edition key` (strict): for each of `{ clientName: 'Empresa' }`, `{ clientId: '<uuid>' }`, `{ estimatedValueBrl: 100 }`, `{ products: [] }`, `{ stageId: '<uuid>' }`, `{ saleId: '<uuid>' }`, `{ lostReason: 'x' }`, `CreateContactLeadSchema.safeParse({ contactName: 'Ana', ...extra }).success` is false, and `UpdateContactLeadSchema.safeParse(extra).success` is false.
5. `rejects a bad e-mail`: `'not-an-email'`, `'a@'` fail; a 255-char valid-looking address (`'a'.repeat(245) + '@exemplo.com'`) fails on max 254.
6. `rejects an impossible or future birth day`: `'2026-02-30'`, `'17/05/1990'`, `'2999-01-01'` fail; `todayInSaoPaulo()` passes.
7. `rejects a phone over 40 characters`: `'9'.repeat(41)` fails, `'9'.repeat(40)` passes.
8. `requires contactName on create but not on update`: `CreateContactLeadSchema.safeParse({}).success` false; `UpdateContactLeadSchema.parse({})` equals `{}`; `UpdateContactLeadSchema.parse({ contactPhone: '' })` equals `{ contactPhone: null }`.
9. `FXL oracle: the full schemas still refuse the contact keys`: for each of `contactPhone`, `contactEmail`, `contactBirthDate`, `CreateLeadSchema.safeParse({ contactName: 'Ana', clientName: 'Empresa Um', [key]: 'x' }).success` and `UpdateLeadSchema.safeParse({ [key]: 'x' }).success` are false; and `Object.keys(CreateLeadSchema.shape).sort()` equals `['clientId','clientName','contactName','description','estimatedValueBrl','products','sellerPersonId']`.
10. `ContactLeadFieldsSchema keys are exactly the seam list`: `Object.keys(ContactLeadFieldsSchema.shape).sort()` equals `['contactBirthDate','contactEmail','contactName','contactPhone','description','sellerPersonId']`.

### 6b `apps/api/src/domains/sales-ops/leads/__tests__/lead-routes-edition.test.ts` (unit, route harness)

Copy the harness of `lead-routes.test.ts` (mock `../../../../db/client.js`, `vi.mock('../lead-service.js', ...)` spreading the actual module and overriding `createLead`, `createContactLead`, `updateLead`, `updateContactLead`).
The app middleware additionally does `if (currentEdition !== undefined) c.set('salesEdition', currentEdition);` with `let currentEdition: 'full' | 'leads' | undefined`.
Default `currentRoles = ['admin']`, `currentEdition = 'leads'`; every mock resolves `{ ok: true, lead: leadView }` where `leadView` is the fixture of lead-routes.test.ts plus the three contact fields set to null.
Cases:

1. leads: `POST /leads {contactName:'Ana'}` answers 201; `createContactLead` called once with args `[mockedDb, 'verified-org', { contactName: 'Ana' }, { userId: 'verified-account', email: <token email or null>, isAdmin: true }]`; `createLead` not called.
2. leads: `POST /leads {contactName:'Ana', clientName:'Empresa'}` answers 400 with `error: 'validation_error'`; neither create mock called.
3. leads: `POST /leads {contactName:'Ana', contactBirthDate:'2999-01-01'}` answers 400; `{contactName:'Ana', contactEmail:'nope'}` answers 400.
4. leads: `createContactLead` rejecting `new LeadInputError('no_open_stage')` answers 400 with body exactly `{ error: 'validation_error', reason: 'no_open_stage', itemIndex: -1 }` (`toEqual`).
5. leads: `PATCH /leads/<LEAD_ID> {contactPhone:''}` answers 200 and `updateContactLead.mock.calls[0][3]` equals `{ contactPhone: null }`; `updateLead` not called.
6. leads: `PATCH /leads/<LEAD_ID> {estimatedValueBrl: 100}` answers 400.
7. full (`currentEdition = 'full'`): `POST /leads {contactName:'Ana', clientName:'Empresa Um', contactPhone:'11'}` answers 400 and NO create mock is called (FXL oracle); `POST /leads {contactName:'Ana', clientName:'Empresa Um'}` answers 201 through `createLead`, `createContactLead` not called.
8. full: `PATCH /leads/<LEAD_ID> {contactEmail:'a@b.co'}` answers 400; neither update mock called.
9. absent (`currentEdition = undefined`): `POST /leads {contactName:'Ana', clientName:'Empresa Um'}` reaches `createLead` (absent means full).
10. leads, seller scope passthrough: `currentRoles = ['seller']`, `createContactLead` resolving `{ ok: false, reason: 'seller_scope' }` answers 403 `{ error: 'forbidden', reason: 'seller_scope' }`.

### 6c `apps/api/src/domains/sales-ops/leads/__tests__/leads-edition-no-seed.test.ts` (unit, source scan)

Walk `apps/api/src` recursively with `node:fs` (`readdirSync(dir, { withFileTypes: true })`), skipping any directory named `__tests__` and any file ending in `.test.ts`, reading every `.ts` file.
Collect the paths (relative to `src`, `/`-separated) whose text matches `/\bensureLeadStages(ForOrg)?\s*\(/`.
Assert:

- the collected list equals exactly `['domains/import/routes.ts', 'domains/sales-ops/leads/stages-seed.ts']` (sorted);
- non-vacuity: the walker visited more than 50 files and the list contains `domains/sales-ops/leads/stages-seed.ts` (the definition itself), so a broken walker cannot pass silently.

Test name: `only the import route and the seed module itself can seed default etapas`.
Comment: the leads edition has no system etapa (edicao-leads decision 5), and the import route is gated by the `import` capability in that edition.

### 6d `apps/api/src/domains/sales-ops/__tests__/people-routes-edition.test.ts` (unit, route harness)

Same harness as `routes.test.ts` (mock `../../../db/client.js` and `../service.js` with `createPerson` / `updatePerson` mocks resolving a `personResult`), with `currentRole = 'admin'` and `c.set('salesEdition', currentEdition)` when defined.
Cases:

1. leads: `POST /people {displayName:'Ana', funcaoIds:['77777777-7777-4777-8777-777777777777']}` answers 201; `createPerson` called with exactly `(mockedDb, 'verified-org', <parsed body>, { edition: 'leads' })` (`toHaveBeenCalledWith`, 4 args).
2. full: the same request calls `createPerson` with exactly 3 args (`expect(serviceMocks.createPerson.mock.calls[0]).toHaveLength(3)`).
3. absent: same as full (3 args).
4. leads: `PATCH /people/<id> {displayName:'Ana'}` calls `updatePerson` with `(mockedDb, 'verified-org', id, <parsed>, { userId: 'verified-account', displayName: <claims name> }, { edition: 'leads' })`.
5. full: the same PATCH calls `updatePerson` with exactly 5 args.
6. leads: a seller (`currentRole = 'seller'`) still gets `403 admin_role_required` and no service call (the admin gate is unchanged).
7. leads: `PATCH /people/<id> {status:'inactive'}` answers 200 and calls `updatePerson` with `{ status: 'inactive' }` as the parsed body and `{ edition: 'leads' }` as the sixth argument (the route never rejects a body without `funcaoIds`).

### 6e `apps/api/test/rls/leads-edition.test.ts` (integration, real DB)

Harness copied from `test/rls/leads-seller-scope.test.ts`: `testDatabaseUrls()`, `appClient`/`adminClient`/`adminDbClient`, `db` and `adminDb` drizzle instances, `newOrg(label)` with prefix `org_led_`, the same `afterAll` cleanup order (lead products, leads, lead stages, sales tables, product costs, products, areas, person_funcoes, people, funções, clientes), and the `ADMIN_SCOPE`, `ADMIN_ACTOR`, `sellerScope`, `bindHubAccount` helpers.
Imports from the service modules: `createLead`, `createContactLead`, `updateContactLead`, `getLead`, `listLeads`, `moveLead`, `LeadInputError` (lead-service); `CreateLeadSchema`, `CreateContactLeadSchema`, `UpdateContactLeadSchema`, `ListLeadsQuerySchema`, `MoveLeadSchema` (lead-schemas); `createLeadStage`, `updateLeadStage` (stage-service); `LeadStageSchema` (leads/schemas); `ensureLeadStagesForOrg` (stages-seed, FULL-edition cases only); `PersonSchema`, `UpdatePersonSchema`, `createPerson`, `updatePerson` (service).
Local helpers:

- `normalStage(orgId, name)`: `createLeadStage(db, orgId, LeadStageSchema.parse({ name }))`, throwing on `'duplicate'`.
- `leadsVendedor(orgId, displayName, contactEmail?)`: `createPerson(db, orgId, PersonSchema.parse({ displayName, ...(contactEmail ? { contactEmail } : {}) }), { edition: 'leads' })`, throwing on a string outcome.
- `contactLead(overrides)`: `CreateContactLeadSchema.parse({ contactName: 'Contato Um', ...overrides })`.
- `systemStageCount(orgId)`: `SELECT count(*)::int AS n FROM sales_ops_lead_stages WHERE org_id = $1 AND kind <> 'normal'` over `adminClient`.

Cases (`describe('sales operations leads edition: contact leads, vendedor-only pessoas, no system etapa')`):

1. `creates a contact lead with only contactName and stores no empresa, value or produto`: new org, one `normalStage('Contato')`; `createContactLead(db, orgId, contactLead(), ADMIN_SCOPE)` is ok; the view has `contactName 'Contato Um'`, `clientId null`, `clientNameSnapshot ''`, `estimatedValueBrl 0`, `products []`, `contactPhone/contactEmail/contactBirthDate null`, `stageId` = that stage.
   Over `adminClient`: the row has `client_id IS NULL`, `client_name_snapshot = ''`, `estimated_value_brl = 0`, and `SELECT count(*) FROM sales_ops_lead_products WHERE org_id AND lead_id` is 0.
2. `stores and projects every contact field`: create with `contactPhone ' (11) 98888-7777 '`, `contactEmail 'Ana@Example.COM'`, `contactBirthDate '1990-05-17'`, `description 'Prefere WhatsApp'`; the view carries `'(11) 98888-7777'`, `'ana@example.com'`, `'1990-05-17'`; `adminClient` `SELECT contact_phone, contact_email, contact_birth_date::text AS birth` matches the same three strings.
3. `updates contact fields partially`: from case-2-like lead, `updateContactLead(db, orgId, id, UpdateContactLeadSchema.parse({ contactPhone: '' }), ADMIN_SCOPE)`: view `contactPhone null`, `contactEmail` and `contactBirthDate` unchanged, `contactName` unchanged; a second update `{ contactBirthDate: '1991-01-02', contactName: 'Novo Nome' }` changes exactly those two; `stageChangedAt` is identical across both updates.
4. `projects the contact fields on list, get and move`: two normal stages A and B; create with `contactEmail 'x@y.co'`; `listLeads(db, orgId, ListLeadsQuerySchema.parse({ stageId: A.id }), ADMIN_SCOPE)` lead has `contactEmail 'x@y.co'`; `getLead` same; `moveLead(db, orgId, id, MoveLeadSchema.parse({ stageId: B.id, position: 0 }), ADMIN_SCOPE)` is ok, its view has `stageId B.id`, `lostReason null`, `contactEmail 'x@y.co'`.
   This also proves a move works in an org with NO conversion and NO lost etapa.
5. `refuses a lead when the org has no etapa at all (no_open_stage)`: brand-new org with zero stages; `await expect(createContactLead(db, orgId, contactLead(), ADMIN_SCOPE)).rejects.toMatchObject({ name: 'LeadInputError', code: 'no_open_stage' })`; `systemStageCount(orgId)` is 0 and the total stage count is 0 afterwards (no lazy seed).
6. `refuses a lead when the only normal etapa is archived`: one `normalStage('Unica')`, then `updateLeadStage(db, orgId, stage.id, { status: 'archived' })`; `createContactLead` rejects with `code: 'no_open_stage'`.
7. `never creates a system etapa through any leads-edition operation`: run cases-1/3/4-style operations on one org (create stages, create, update, list, get, move, create a vendedor, update the vendedor); finally `systemStageCount(orgId)` is 0 and the stage rows are exactly the ones the test created.
8. `keeps seller scoping in the leads edition`: two vendedores via `leadsVendedor` (Ana, Bruno), `bindHubAccount` Ana to `hub_ana`; admin creates one contact lead for each; `listLeads(adminDb, orgId, {stageId}, sellerScope('hub_ana'))` returns only Ana's (asserted over `adminDb`, where RLS hides nothing); `createContactLead(db, orgId, contactLead({ sellerPersonId: bruno.id }), sellerScope('hub_ana'))` resolves `{ ok: false, reason: 'seller_scope' }`; with `sellerPersonId: ana.id` it is ok.
   Email self-claim: a third vendedor `Carla` created with `contactEmail 'carla@construbom.test'` and no hub binding; `listLeads(db, orgId, {stageId}, sellerScope('hub_carla', 'carla@construbom.test'))` is ok (claim binds), and a scope with an unknown e-mail resolves `{ ok: false, reason: 'seller_person_unmapped' }`.
9. `seeds both system funções and makes a leads-edition pessoa exactly a vendedor`: brand-new org; before, `SELECT count(*) FROM sales_ops_funcoes WHERE org_id` is 0; `leadsVendedor(orgId, 'Ana')` returns `funcoes` whose slugs are exactly `['vendedor']`; after, the org's system funções (`is_system = true`) have slugs exactly `['finder','vendedor']` (sorted) and there are no other funções.
10. `ignores body funcaoIds in the leads edition`: in that org read the `finder` função id over `adminClient`; `createPerson(db, orgId, PersonSchema.parse({ displayName: 'Bruno', funcaoIds: [finderId] }), { edition: 'leads' })` returns slugs `['vendedor']`; with `funcaoIds: ['99999999-9999-4999-8999-999999999999']` (unknown) it is still `['vendedor']` (not `unknown_funcao`); with `isFinder: true, isCollaborator: true` it is still `['vendedor']`.
    `sales_ops_person_funcoes` rows for each of those pessoas: exactly one, the vendedor id.
11. `forces exactly vendedor on update in the leads edition`: in a FULL-edition write create a pessoa with `funcaoIds: [vendedorId, finderId]` (after seeding via case 9's org); then `updatePerson(db, orgId, id, UpdatePersonSchema.parse({ displayName: 'Bruno B', funcaoIds: [finderId] }), ADMIN_ACTOR, { edition: 'leads' })` returns slugs `['vendedor']` and the child table holds only the vendedor row.
    A leads-edition update of an unknown id returns `null` and seeds nothing extra.
12a. `accepts an empty funcaoIds and a status-only PATCH in the leads edition (SEAM A3)`: brand-new org; `createPerson(db, orgId, PersonSchema.parse({ displayName: 'Dani', funcaoIds: [] }), { edition: 'leads' })` returns slugs `['vendedor']` (never `'funcao_required'`); then `updatePerson(db, orgId, dani.id, UpdatePersonSchema.parse({ status: 'inactive' }), ADMIN_ACTOR, { edition: 'leads' })` returns `status: 'inactive'` with slugs still `['vendedor']`, and `UpdatePersonSchema.parse({ status: 'active' })` the same way returns `status: 'active'` (this is the Reativar path of slice 07, SEAM A4); the `sales_ops_person_funcoes` rows of Dani are the same single vendedor row (same row id) before and after both PATCHes, proving the status-only update did not rewrite the set.
12. `FXL oracle: full-edition people and leads are unchanged`: new org; `createPerson(db, orgId, PersonSchema.parse({ displayName: 'Sem funcao' }))` returns `'funcao_required'` (no options means full); `ensureLeadStagesForOrg(db, orgId)` then `createLead(db, orgId, CreateLeadSchema.parse({ contactName: 'Contato Um', clientName: 'Empresa Um', estimatedValueBrl: 250000 }), ADMIN_SCOPE)` is ok with `clientNameSnapshot 'Empresa Um'`, `estimatedValueBrl 250000`, and `contactPhone/contactEmail/contactBirthDate` all `null`.

## Step 7 - knowledge (same change)

1. `nexo/knowledge/reference/kanban-de-leads.md`: first replace its three pre-existing em dash characters (U+2014, found by `grep -n "$(printf '\342\200\224')"`) with ` - `; then append a section `## Edição Leads (2026-10-05, edicao-leads)` with one sentence per line covering: the contact-only strict schemas and the route's `leadFieldSet` switch; the neutral stored values (`client_id NULL`, `''`, `0`, no produtos); the three projected fields; `no_open_stage` reused as the no-etapa answer (no new code); that no leads-edition path seeds etapas and `leads-edition-no-seed.test.ts` pins the two allowed `ensureLeadStages` callers; oracle names 6a to 6e.
2. `nexo/knowledge/reference/pessoas-e-funcoes.md`: append a short section stating that in the leads edition `POST/PATCH /people` force the função set to exactly `[vendedor]`, seed the system funções with `ensureSystemFuncoes` in the same transaction, ignore `funcaoIds` and the deprecated booleans, and that the full edition calls keep their exact arity (oracle `people-routes-edition.test.ts`, `leads-edition.test.ts`).
3. Do NOT edit `CLAUDE.md` in this slice: slice 07 (the last slice in serial order) writes the one consolidated `## Edição Leads` section of `CLAUDE.md` for slices 04 to 08 (see PLAN-CHECK.md C10).

## Commands (run once, in order, from the repo root)

```bash
pnpm run build:packages
pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/leads/__tests__ src/domains/sales-ops/__tests__/people-routes-edition.test.ts src/domains/sales-ops/__tests__/routes.test.ts src/domains/import/__tests__
pnpm --filter @fxl-sales/api test
make db-up
pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/leads-edition.test.ts test/rls/leads-seller-scope.test.ts test/rls/leads-no-financial-impact.test.ts test/rls/lead-stages-rls.test.ts src/domains/import/__tests__/executor.integration.test.ts src/domains/import/__tests__/import-routes.integration.test.ts
pnpm --filter @fxl-sales/api test:integration
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api lint
```

`make db-up` only starts the local Postgres container if it is not running; if this agent started it, stop it with `make db-down` before finishing only when it was NOT already running before the slice.
`TEST_DATABASE_URL` and `ADMIN_DATABASE_URL` come from `apps/api/.env` and must be local; never point them elsewhere.

## Done when

- Every oracle file above exists and is green, and both whole suites (unit and integration) are green.
- `git diff --stat` touches only the files in `files_modified`.
- `git diff` shows `CreateLeadSchema`, `UpdateLeadSchema`, `PersonSchema`, `UpdatePersonSchema` and `planPersonFuncoes` unchanged, and no edit under `apps/api/src/domains/import/`.
- A search for the em dash character (U+2014, e.g. `grep -rnP '\x{2014}'`) over the changed files finds nothing.
