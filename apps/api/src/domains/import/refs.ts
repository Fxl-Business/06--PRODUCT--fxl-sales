/**
 * The ONE name resolver. Pure: no I/O, no clock, no env.
 * Name matching uses only normalizeLabel (Amendment 6).
 */
import { SYSTEM_FUNCAO_SLUGS, slugifyFuncao } from '../sales-ops/service.js';
import { normalizeLabel } from './cells.js';
import { cellReader } from './parse.js';
import { planKeyOf } from './plan/plan-helpers.js';
import type {
  EntityRef,
  ImportCatalog,
  ParsedWorkbook,
  RefIndex,
  RefKind,
  RefLookup,
  RefLookupFailureCode,
  SheetKey,
} from './types.js';

export type SystemFuncaoSlug = (typeof SYSTEM_FUNCAO_SLUGS)[number];
export type PersonRoleLookup = RefLookup | { ok: false; code: 'missing_funcao'; message: string };

export interface ImportRefIndex extends RefIndex {
  /** resolve('person', name) and require the system função; the planners' vendedor/finder check. */
  resolvePersonWithFuncao(name: string, slug: SystemFuncaoSlug): PersonRoleLookup;
  /** True when the person (existing or workbook) will hold the função with this slug after commit. */
  personHasFuncaoSlug(person: EntityRef, slug: string): boolean;
  /** True when the person will hold exactly this função (compared with sameRef). */
  personHasFuncao(person: EntityRef, funcao: EntityRef): boolean;
  /** True only for an EXISTING função flagged isSystem (workbook funções are never system). */
  funcaoIsSystem(funcao: EntityRef): boolean;
}

export function sameRef(a: EntityRef, b: EntityRef): boolean {
  if ('existingId' in a) return 'existingId' in b && a.existingId === b.existingId;
  return 'planKey' in b && a.planKey === b.planKey;
}

export function refKey(ref: EntityRef): string {
  return 'existingId' in ref ? `id:${ref.existingId}` : `plan:${ref.planKey}`;
}

// ---------------------------------------------------------------------------
// Messages (one table keyed by kind, so grammar is never invented inline)
// ---------------------------------------------------------------------------

type KindInfo = {
  sheet: SheetKey;
  article: 'a' | 'o';
  noun: string;
  tab: string;
  archived: (x: string) => string;
  ambiguous: (x: string) => string;
};

const RESTORE_GERAL = 'restaure em Cadastros > Geral (Histórico de arquivamentos)';

const MESSAGES: Record<RefKind, KindInfo> = {
  area: {
    sheet: 'areas',
    article: 'a',
    noun: 'área',
    tab: 'Áreas',
    archived: (x) => `A área "${x}" está arquivada; ${RESTORE_GERAL} ou use outra.`,
    ambiguous: (x) => `Há mais de uma área com o nome "${x}".`,
  },
  funcao: {
    sheet: 'funcoes',
    article: 'a',
    noun: 'função',
    tab: 'Funções',
    archived: (x) => `A função "${x}" está arquivada; ${RESTORE_GERAL} ou use outra.`,
    ambiguous: (x) => `Há mais de uma função com o nome "${x}".`,
  },
  product: {
    sheet: 'produtos',
    article: 'o',
    noun: 'produto',
    tab: 'Produtos',
    archived: (x) => `O produto "${x}" está arquivado; ${RESTORE_GERAL} ou use outro.`,
    ambiguous: (x) => `Há mais de um produto com o nome "${x}"; use o código, por exemplo #3.`,
  },
  person: {
    sheet: 'pessoas',
    article: 'a',
    noun: 'pessoa',
    tab: 'Pessoas',
    archived: (x) => `A pessoa "${x}" está inativa; reative em Cadastros > Geral (Histórico de arquivamentos) ou use outra.`,
    ambiguous: (x) =>
      `Há mais de uma pessoa com o nome "${x}" (no cadastro ou nesta planilha); deixe os nomes diferentes para indicar qual usar.`,
  },
  client: {
    sheet: 'clientes',
    article: 'o',
    noun: 'cliente',
    tab: 'Clientes',
    archived: (x) => `O cliente "${x}" não está disponível; use outro.`,
    ambiguous: (x) =>
      `Há mais de um cliente com o nome "${x}" (no cadastro ou nesta planilha); deixe os nomes diferentes para indicar qual usar.`,
  },
  stage: {
    sheet: 'etapas',
    article: 'a',
    noun: 'etapa',
    tab: 'Etapas',
    archived: (x) => `A etapa "${x}" está arquivada; restaure em Cadastros > Etapas ou use outra.`,
    ambiguous: (x) => `Há mais de uma etapa com o nome "${x}".`,
  },
};

function failure(kind: RefKind, code: RefLookupFailureCode, x: string): RefLookup {
  const info = MESSAGES[kind];
  if (code === 'unknown_ref') {
    return {
      ok: false,
      code,
      message: `Não encontramos ${info.article} ${info.noun} "${x}" no cadastro nem na aba ${info.tab}.`,
    };
  }
  return { ok: false, code, message: code === 'archived_ref' ? info.archived(x) : info.ambiguous(x) };
}

function codeFailure(code: RefLookupFailureCode, n: number): RefLookup {
  const message =
    code === 'unknown_ref'
      ? `Não encontramos o produto com código #${n}.`
      : code === 'archived_ref'
        ? `O produto com código #${n} está arquivado; ${RESTORE_GERAL} ou use outro.`
        : `Há mais de um produto com o código #${n}.`;
  return { ok: false, code, message };
}

// ---------------------------------------------------------------------------
// Product code assignment
// ---------------------------------------------------------------------------

export type ProductCodeAssignment =
  | { ok: true; code: number; explicit: boolean }
  | { ok: false; code: 'duplicate_code' | 'no_free_code'; message: string };

/** Code suffix per Produtos Excel row with a non-null Nome, deterministic. Mirrors nextProductCodeSuffix applied repeatedly. */
export function assignProductCodes(
  parsed: ParsedWorkbook,
  catalog: ImportCatalog,
): Map<number, ProductCodeAssignment> {
  const used = new Set<number>();
  const owner = new Map<number, string>();
  for (const product of catalog.products) {
    if (!/^\d{1,2}$/.test(product.codeSuffix)) continue;
    const n = Number(product.codeSuffix);
    used.add(n);
    if (!owner.has(n)) owner.set(n, product.status === 'archived' ? `${product.name} (arquivado)` : product.name);
  }

  const result = new Map<number, ProductCodeAssignment>();
  const rows = parsed.sheets.produtos.rows.flatMap((row) => {
    const cells = cellReader('produtos', row);
    const nome = cells.text('nome');
    return nome === null ? [] : [{ row: row.row, nome, codigo: cells.number('codigo') }];
  });

  for (const r of rows) {
    if (r.codigo === null) continue;
    if (used.has(r.codigo)) {
      result.set(r.row, {
        ok: false,
        code: 'duplicate_code',
        message: `O código ${r.codigo} já é usado pelo produto "${owner.get(r.codigo) ?? ''}"; deixe a coluna em branco para usar o próximo código livre.`,
      });
      continue;
    }
    result.set(r.row, { ok: true, code: r.codigo, explicit: true });
    used.add(r.codigo);
    owner.set(r.codigo, r.nome);
  }

  for (const r of rows) {
    if (r.codigo !== null) continue;
    let next = used.size === 0 ? 0 : Math.max(...used) + 1;
    if (next > 99) {
      next = -1;
      for (let c = 0; c <= 99; c += 1) {
        if (!used.has(c)) {
          next = c;
          break;
        }
      }
    }
    if (next < 0) {
      result.set(r.row, {
        ok: false,
        code: 'no_free_code',
        message: `Não há código livre de 0 a 99 para o produto "${r.nome}"; arquive ou renumere um produto antes.`,
      });
      continue;
    }
    result.set(r.row, { ok: true, code: next, explicit: false });
    used.add(next);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

type ExistingRow = { id: string; name: string; active: boolean };
type Registered = { planKey: string; label: string };

function existingRows(kind: RefKind, catalog: ImportCatalog): ExistingRow[] {
  switch (kind) {
    case 'area':
      return catalog.areas.map((r) => ({ id: r.id, name: r.name, active: r.status === 'active' }));
    case 'funcao':
      return catalog.funcoes.map((r) => ({ id: r.id, name: r.name, active: r.status === 'active' }));
    case 'product':
      return catalog.products.map((r) => ({ id: r.id, name: r.name, active: r.status === 'active' }));
    case 'person':
      return catalog.people.map((r) => ({ id: r.id, name: r.displayName, active: r.status === 'active' }));
    case 'client':
      return catalog.clients.map((r) => ({ id: r.id, name: r.name, active: true }));
    case 'stage':
      return catalog.stages.map((r) => ({ id: r.id, name: r.name, active: r.status === 'active' }));
  }
}

const KINDS: readonly RefKind[] = ['area', 'funcao', 'product', 'person', 'client', 'stage'];

export function buildRefIndex(parsed: ParsedWorkbook, catalog: ImportCatalog): ImportRefIndex {
  const existing = new Map<RefKind, ExistingRow[]>();
  for (const kind of KINDS) existing.set(kind, existingRows(kind, catalog));

  // ---- registration of workbook rows
  const registered = new Map<RefKind, Map<string, Registered[]>>();
  for (const kind of KINDS) {
    const sheet = MESSAGES[kind].sheet;
    const byKey = new Map<string, Registered[]>();
    registered.set(kind, byKey);
    const existingKeys = new Set(
      (existing.get(kind) ?? [])
        .filter((r) => (kind === 'product' ? r.active : true))
        .map((r) => normalizeLabel(r.name)),
    );
    const uniqueByName = kind === 'area' || kind === 'funcao' || kind === 'stage' || kind === 'product';
    for (const row of parsed.sheets[sheet].rows) {
      const nome = row.cells['nome'];
      if (typeof nome !== 'string') continue;
      const key = normalizeLabel(nome);
      if (key === '') continue;
      if (uniqueByName && (existingKeys.has(key) || byKey.has(key))) continue;
      const entry = { planKey: planKeyOf(sheet, row.row), label: nome };
      const list = byKey.get(key);
      if (list) list.push(entry);
      else byKey.set(key, [entry]);
    }
  }

  // ---- workbook product codes
  const workbookCodes = new Map<number, string>();
  for (const [row, assignment] of assignProductCodes(parsed, catalog)) {
    if (assignment.ok && !workbookCodes.has(assignment.code)) {
      workbookCodes.set(assignment.code, planKeyOf('produtos', row));
    }
  }
  const productLabelByPlanKey = new Map<string, string>();
  for (const list of registered.get('product')?.values() ?? []) {
    for (const entry of list) productLabelByPlanKey.set(entry.planKey, entry.label);
  }
  for (const row of parsed.sheets.produtos.rows) {
    const nome = row.cells['nome'];
    if (typeof nome === 'string') productLabelByPlanKey.set(planKeyOf('produtos', row.row), nome);
  }

  const toLookup = (
    kind: RefKind,
    typed: string,
    activeExisting: ExistingRow[],
    inactiveExisting: ExistingRow[],
    workbookEntries: Registered[],
    codeNumber: number | null,
  ): RefLookup => {
    const pool: Array<{ ref: EntityRef; label: string }> = [
      ...activeExisting.map((r) => ({ ref: { existingId: r.id } as EntityRef, label: r.name })),
      ...workbookEntries.map((r) => ({ ref: { planKey: r.planKey } as EntityRef, label: r.label })),
    ];
    const only = pool.length === 1 ? pool[0] : undefined;
    if (only) return { ok: true, ref: only.ref, label: only.label };
    const code: RefLookupFailureCode =
      pool.length > 1 ? 'ambiguous_ref' : inactiveExisting.length > 0 ? 'archived_ref' : 'unknown_ref';
    return codeNumber === null ? failure(kind, code, typed) : codeFailure(code, codeNumber);
  };

  const resolve = (kind: RefKind, name: string): RefLookup => {
    const typed = name.trim();
    const key = normalizeLabel(name);
    if (key === '') return failure(kind, 'unknown_ref', typed);
    const rows = existing.get(kind) ?? [];

    if (kind === 'product') {
      const m = /^#\s*(\d{1,2})$/.exec(typed);
      if (m?.[1] !== undefined) {
        const n = Number(m[1]);
        const matches = catalog.products.filter((p) => /^\d{1,2}$/.test(p.codeSuffix) && Number(p.codeSuffix) === n);
        const workbookKey = workbookCodes.get(n);
        const workbookEntries: Registered[] =
          workbookKey === undefined
            ? []
            : [{ planKey: workbookKey, label: productLabelByPlanKey.get(workbookKey) ?? typed }];
        return toLookup(
          kind,
          typed,
          matches.filter((p) => p.status === 'active').map((p) => ({ id: p.id, name: p.name, active: true })),
          matches.filter((p) => p.status !== 'active').map((p) => ({ id: p.id, name: p.name, active: false })),
          workbookEntries,
          n,
        );
      }
    }

    const matches = rows.filter((r) => normalizeLabel(r.name) === key);
    return toLookup(
      kind,
      typed,
      matches.filter((r) => r.active),
      matches.filter((r) => !r.active),
      registered.get(kind)?.get(key) ?? [],
      null,
    );
  };

  // ---- person funções (after funções are registered)
  const catalogFuncaoById = new Map(catalog.funcoes.map((f) => [f.id, f]));
  const existingPeople = new Map(catalog.people.map((p) => [p.id, p]));
  const workbookPeople = new Map<string, { refs: EntityRef[]; slugs: Set<string> }>();
  for (const row of parsed.sheets.pessoas.rows) {
    const nome = row.cells['nome'];
    if (typeof nome !== 'string' || normalizeLabel(nome) === '') continue;
    const names = cellReader('pessoas', row).list('funcoes') ?? [];
    const refs: EntityRef[] = [];
    const slugs = new Set<string>();
    const seen = new Set<string>();
    for (const n of names) {
      const r = resolve('funcao', n);
      if (!r.ok || seen.has(refKey(r.ref))) continue;
      seen.add(refKey(r.ref));
      refs.push(r.ref);
      if ('existingId' in r.ref) {
        const f = catalogFuncaoById.get(r.ref.existingId);
        if (f) slugs.add(f.slug);
      } else {
        slugs.add(slugifyFuncao(r.label));
      }
    }
    workbookPeople.set(planKeyOf('pessoas', row.row), { refs, slugs });
  }

  const personHasFuncaoSlug = (person: EntityRef, slug: string): boolean => {
    if ('existingId' in person) return existingPeople.get(person.existingId)?.funcaoSlugs.includes(slug) ?? false;
    return workbookPeople.get(person.planKey)?.slugs.has(slug) ?? false;
  };
  const personHasFuncao = (person: EntityRef, funcao: EntityRef): boolean => {
    if ('existingId' in person) {
      return 'existingId' in funcao && (existingPeople.get(person.existingId)?.funcaoIds.includes(funcao.existingId) ?? false);
    }
    return workbookPeople.get(person.planKey)?.refs.some((r) => sameRef(r, funcao)) ?? false;
  };

  return {
    resolve,
    personHasFuncaoSlug,
    personHasFuncao,
    funcaoIsSystem: (funcao) =>
      'existingId' in funcao && catalogFuncaoById.get(funcao.existingId)?.isSystem === true,
    resolvePersonWithFuncao: (name, slug) => {
      const r = resolve('person', name);
      if (!r.ok) return r;
      if (personHasFuncaoSlug(r.ref, slug)) return r;
      const f = slug === 'vendedor' ? 'Vendedor' : 'Finder';
      const message =
        'existingId' in r.ref
          ? `A pessoa "${r.label}" não tem a função ${f}; atribua a função em Cadastros > Pessoas antes de importar.`
          : `A pessoa "${r.label}" não tem a função ${f} na aba Pessoas; inclua ${f} na coluna Funções.`;
      return { ok: false, code: 'missing_funcao', message };
    },
  };
}
