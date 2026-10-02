import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getDb } from '../../db/client.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { cadastroActor } from '../sales-ops/cadastro-actor.js';
import { ensureLeadStages } from '../sales-ops/leads/stages-seed.js';
import { ensureSystemFuncoes, withTenant, type Db } from '../sales-ops/service.js';
import { readImportCatalog } from './catalog.js';
import { ImportExecutionError, executeImportPlan } from './executor.js';
import { INVALID_FILE_CODE, parseWorkbook } from './parse.js';
import { isPlanOk, planImport, toPreviewBody } from './plan/index.js';
import { buildTemplateWorkbook } from './template.js';
import type { ImportCatalog, ImportCommitBody, ImportPlan, ParsedWorkbook } from './types.js';
import { MAX_UPLOAD_BYTES } from './workbook-schema.js';

/*
 * The three import routes are admin-only. Every route seeds the default etapas and the system
 * funcoes before reading the catalog (D11, D11b), and preview and template do it in an
 * always-rolled-back transaction so they write nothing. Commit re-plans inside its own
 * transaction and leaves it by throwing on every failure path.
 */

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const TEMPLATE_FILENAME = 'fxl-sales-importacao.xlsx';
export const EXAMPLE_TEMPLATE_FILENAME = 'fxl-sales-importacao-exemplo.xlsx';
export const INVALID_FILE_BODY = { error: 'validation_error', reason: 'invalid_file' } as const;
export const FILE_TOO_LARGE_BODY = { error: 'payload_too_large', reason: 'file_too_large' } as const;
/** Room for the multipart boundary and part headers around the file itself. */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export const importRouter = new Hono();

const READ_ONLY_ROLLBACK = new Error('import_read_only_rollback');

/** Runs fn in a tenant transaction that is ALWAYS rolled back: a dry run cannot write, even if a reader seeds. */
async function readOnlyTenant<T>(orgId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  const box: { result?: { value: T } } = {};
  try {
    await withTenant(getDb(), orgId, async (tx) => {
      box.result = { value: await fn(tx) };
      throw READ_ONLY_ROLLBACK;
    });
  } catch (error) {
    if (error !== READ_ONLY_ROLLBACK) throw error;
  }
  if (!box.result) throw new Error('read-only tenant transaction produced no result');
  return box.result.value;
}

/** D11 and D11b: the default etapas and the system funcoes exist before the catalog is read, in EVERY import route. */
async function seededCatalog(tx: Db, orgId: string, now: Date): Promise<ImportCatalog> {
  await ensureLeadStages(tx, orgId);
  await ensureSystemFuncoes(tx, orgId);
  return readImportCatalog(tx, orgId, now);
}

/** Thrown out of the commit transaction so a plan with errors rolls back whatever the catalog read did. */
class ImportPlanRejected extends Error {
  constructor(readonly plan: ImportPlan) {
    super('import_plan_rejected');
  }
}

const uploadBodyLimit = bodyLimit({
  maxSize: MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES,
  onError: (c) => c.json(FILE_TOO_LARGE_BODY, 413),
});

type UploadResult = { ok: true; parsed: ParsedWorkbook } | { ok: false; status: 400 | 413 };

/** Reads the `file` field and parses it. Never throws for user input. */
async function readUpload(c: Context): Promise<UploadResult> {
  let body: Record<string, string | File>;
  try {
    body = await c.req.parseBody();
  } catch {
    return { ok: false, status: 400 };
  }
  const file = body['file'];
  if (!(file instanceof File)) return { ok: false, status: 400 };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, status: 413 };
  const parsed = await parseWorkbook(new Uint8Array(await file.arrayBuffer()));
  if (parsed.issues.some((i) => i.code === INVALID_FILE_CODE)) return { ok: false, status: 400 };
  return { ok: true, parsed };
}

function refusal(c: Context, status: 400 | 413): Response {
  return status === 413 ? c.json(FILE_TOO_LARGE_BODY, 413) : c.json(INVALID_FILE_BODY, 400);
}

importRouter.get('/template', requireAdmin, async (c) => {
  const example = c.req.query('example') === '1';
  const orgId = c.get('orgId');
  const now = new Date();
  // Rolled back: the dropdowns list the default etapas without persisting them.
  const catalog = await readOnlyTenant(orgId, (tx) => seededCatalog(tx, orgId, now));
  const bytes = await buildTemplateWorkbook(catalog, { example });
  return c.body(new Uint8Array(bytes), 200, {
    'Content-Type': XLSX_CONTENT_TYPE,
    'Content-Disposition': `attachment; filename="${example ? EXAMPLE_TEMPLATE_FILENAME : TEMPLATE_FILENAME}"`,
    'Cache-Control': 'no-store',
  });
});

importRouter.post('/preview', requireAdmin, uploadBodyLimit, async (c) => {
  const upload = await readUpload(c);
  if (!upload.ok) return refusal(c, upload.status);
  const orgId = c.get('orgId');
  const now = new Date();
  // Seed, read and plan in one transaction, then roll it back: preview writes nothing.
  const plan = await readOnlyTenant(orgId, async (tx) =>
    planImport(upload.parsed, await seededCatalog(tx, orgId, now)),
  );
  return c.json(toPreviewBody(plan), 200);
});

importRouter.post('/commit', requireAdmin, uploadBodyLimit, async (c) => {
  const upload = await readUpload(c);
  if (!upload.ok) return refusal(c, upload.status);
  const orgId = c.get('orgId');
  const actor = cadastroActor(c);
  const now = new Date();
  try {
    const result = await withTenant(getDb(), orgId, async (tx) => {
      // The seed is part of the committed transaction (and rolls back with it on any failure).
      const plan = planImport(upload.parsed, await seededCatalog(tx, orgId, now));
      if (!isPlanOk(plan)) throw new ImportPlanRejected(plan);
      return executeImportPlan(tx, orgId, plan, actor, now);
    });
    const body: ImportCommitBody = { counts: result.counts };
    return c.json(body, 201);
  } catch (error) {
    if (error instanceof ImportPlanRejected) return c.json(toPreviewBody(error.plan), 422);
    if (error instanceof ImportExecutionError) {
      // `error.message` is the pt-BR sentence; `error.operation` is never serialized or logged.
      return c.json({ error: 'conflict', reason: 'import_execution_failed', message: error.message }, 409);
    }
    throw error;
  }
});
