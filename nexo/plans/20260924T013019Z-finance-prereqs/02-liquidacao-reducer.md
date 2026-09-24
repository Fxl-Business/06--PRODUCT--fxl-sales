---
id: 02-liquidacao-reducer
milestone: v4.1.0
status: todo
depends_on: []
files_modified: [packages/shared-utils/src/liquidacao.ts, packages/shared-utils/src/__tests__/liquidacao.test.ts, packages/shared-utils/src/index.ts, packages/shared-utils/package.json, CLAUDE.md, nexo/knowledge/reference/propostas.md]
goal: "Pure settlement reducer reduzirLiquidacao (Finance parity) plus pure pre-write validators validarNovaBaixa / validarEstorno in packages/shared-utils/src/liquidacao.ts, exported as @fxl-sales/shared-utils/liquidacao and from the root index."
acceptance: ["reduzirLiquidacao({ valorOriginalCentavos, eventos }) returns { pagoCentavos, abertoCentavos, dataUltimoPagamento, baixasAtivas } where active = baixa with no estorno citing it, pago = integer sum of active, aberto = max(original - pago, 0), dataUltimoPagamento = GREATEST active data (null when none), baixasAtivas sorted by (data, id) and copied", "Malformed histories throw LiquidacaoErro with the Finance codigo: EstornoSemBaixa (unknown id or estorno of an estorno), BaixaJaEstornada, EstornoValorDivergente, IdDuplicado, CentavosInvalidos, DataInvalida, EventoInvalido; LiquidacaoErro is not a RangeError", "A parity table copied from the Finance plan 01-liquidacao-redutor oracle list (cases 1-12 and 14-22) passes, and a meta test fails if any of those Finance case numbers is missing from the table", "validarNovaBaixa refuses in order sale_not_won, row_void, invalid_paid_on, paid_on_in_future, already_paid, accepts paidOn equal to today, and on success returns valorCentavos = the whole open amount from the reducer (never from the caller)", "validarEstorno refuses not_found (unknown id or id of an estorno) and already_reversed, and on success returns the reversal dated hojeSaoPaulo with the baixa's own amount", "statusCacheDaLinha keeps void as void, returns paid only when an active baixa exists and aberto is 0, else open; temBaixaAtiva is true iff baixasAtivas is non-empty", "Source guard: liquidacao.ts has no import statement and no new Date(, Date.now(, parseFloat(, Number(, toFixed(, toISOString(, getUTC, Intl, Math.round(, localeCompare, todayInSaoPaulo", "package.json exports ./liquidacao (dist/liquidacao.d.ts and dist/liquidacao.js), the root index re-exports it, `pnpm --filter @fxl-sales/shared-utils run build` emits dist/liquidacao.js, and node scripts/build-contract.mjs passes", "CLAUDE.md and nexo/knowledge/reference/propostas.md name reduzirLiquidacao as the one settlement rule in the same change"]
---

# 02-liquidacao-reducer

## Context

- `packages/shared-utils` is ESM, tested by vitest (`packages/shared-utils/package.json` script `test: vitest run`; `packages/shared-utils/vitest.config.ts` includes `src/**/__tests__/**/*.test.ts`), type-checked by `tsc --noEmit` against `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess: true`, `noUnusedLocals: true`).
  Test files live in `packages/shared-utils/src/__tests__/` and are excluded from the build (`packages/shared-utils/tsconfig.json` `exclude`).
- Code style of the package (see `packages/shared-utils/src/professional-split.ts` and `src/__tests__/professional-split.test.ts`): semicolons, single quotes, `import { describe, expect, it } from 'vitest'`, relative imports with `.js` suffix.
- `packages/shared-utils/package.json` `exports` has `.`, `./theme`, `./hmac`, `./sale-financials`, `./professional-split`, each `{ "types": "./dist/<x>.d.ts", "import": "./dist/<x>.js" }`.
- `packages/shared-utils/src/index.ts` is six `export * from './<x>.js';` lines.
  The web must import the SUBPATH, never the root, because the root re-exports the Node-only hmac module (`nexo/knowledge/reference/propostas.md:108-110`).
- `scripts/build-contract.mjs` (run by root `pnpm test`) fails when an app imports an `@fxl-sales/shared-utils/<subpath>` that is not declared in `exports` (v2.3.0 Vercel incident, `nexo/runs/20260731-hotfix-vercel-build-contract/run.md`).
- There is NO settlement code in Sales today: receivable and payable `status` is a plain `open|paid|void` column (`apps/api/src/db/schema.ts:1124`, `:1146` carry `amount_brl` integer cents).
- The Sales package has no civil-date validator: Finance's `serie.ts` / `parcelamento.ts` do not exist here, and slice 01's `isIsoDay` (C1) is planned in parallel with no dependency edge, so this slice carries its own private integer-only civil-day check.
- Finance source of truth: `F:nexo/plans/20260924T011357Z-feedback-socio-financeiro/01-liquidacao-redutor.md` (plan, `status: todo`) and `F:nexo/knowledge/decisions/2026-09-23-baixas-for-business-e-contrato-sales.md` section 3.2 and 3.6 E (F = `/Users/cauetpinciara/Documents/fxl/projects/01--PRODUCT--fxl-finance`).
  Verified on 2026-09-23: `git -C F log --all -- packages/shared-utils/src/liquidacao.ts` is empty and no Finance worktree (`F/.worktrees/*`, `~/conductor/workspaces/01--PRODUCT--fxl-finance/*`) has the file, so there is no code to mirror yet; this slice mirrors the PLAN.
- Finance keeps the pre-write API rules (future date, already settled, double reversal) in its API (`F:.../03-baixas-api.md:214-217`, `BaixaErro`), comparing ISO days lexicographically with today ACCEPTED (`dataPagamento > hojeIso` refuses).
  Sales puts the same rules in a pure helper in shared-utils so the API (slice 06) and the UI (slice 08) share one copy.

## Design

### File `packages/shared-utils/src/liquidacao.ts` (new, no imports at all)

Write it as below (comments may be reworded but must not contain any literal the source guard forbids, not even in prose: write "o relogio", "ponto flutuante", "formatacao de locale", never the API names).

```ts
/**
 * Regra unica de liquidacao do Sales: baixas e estornos de receivables e payables.
 *
 * Espelho do redutor do FXL Finance (`reduzirLiquidacao` em F:packages/shared-utils/src/liquidacao.ts,
 * plano F:nexo/plans/20260924T011357Z-feedback-socio-financeiro/01-liquidacao-redutor.md):
 * mesmas regras, mesmos nomes e mesmos codigos de erro. O oraculo de paridade em
 * __tests__/liquidacao.test.ts falha se as duas regras divergirem.
 *
 * Fatos imutaveis. O modulo nao le o relogio, nao usa ponto flutuante nem formatacao de locale
 * e nao importa nada: "hoje" chega como argumento (dia civil de Sao Paulo calculado pelo chamador).
 *
 * Etapa 1: so baixa integral e estorno integral (EstornoValorDivergente). Pagamento parcial,
 * juros, multa e desconto revisitam esta regra junto com o Finance.
 */

export interface BaixaEvento {
  readonly id: string;
  readonly tipo: 'baixa';
  readonly estornaBaixaId: null;
  /** YYYY-MM-DD, dia civil real do pagamento. */
  readonly data: string;
  /** Inteiro seguro > 0. */
  readonly valorCentavos: number;
}

export interface EstornoEvento {
  readonly id: string;
  readonly tipo: 'estorno';
  readonly estornaBaixaId: string;
  /** YYYY-MM-DD, dia civil do estorno. */
  readonly data: string;
  /** Inteiro seguro > 0, igual ao da baixa citada. */
  readonly valorCentavos: number;
}

export type LiquidacaoEvento = BaixaEvento | EstornoEvento;

export interface LiquidacaoEntrada {
  readonly valorOriginalCentavos: number;
  readonly eventos: readonly LiquidacaoEvento[];
}

export interface Liquidacao {
  pagoCentavos: number;
  abertoCentavos: number;
  dataUltimoPagamento: string | null;
  baixasAtivas: BaixaEvento[];
}

export type LiquidacaoErroCodigo =
  | 'CentavosInvalidos'
  | 'DataInvalida'
  | 'EventoInvalido'
  | 'IdDuplicado'
  | 'EstornoSemBaixa'
  | 'BaixaJaEstornada'
  | 'EstornoValorDivergente';

export class LiquidacaoErro extends Error {
  readonly codigo: LiquidacaoErroCodigo;
  constructor(codigo: LiquidacaoErroCodigo, mensagem: string) {
    super(`liquidacao: ${mensagem}`);
    this.name = 'LiquidacaoErro';
    this.codigo = codigo;
  }
}
```

Private helpers (not exported), each under 40 lines:

```ts
const DIA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function ehBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

function diasNoMes(ano: number, mes: number): number {
  if (mes === 2) return ehBissexto(ano) ? 29 : 28;
  return mes === 4 || mes === 6 || mes === 9 || mes === 11 ? 30 : 31;
}

function ehDiaCivil(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false;
  const partes = DIA_ISO.exec(valor);
  if (!partes) return false;
  const ano = parseInt(partes[1] ?? '', 10);
  const mes = parseInt(partes[2] ?? '', 10);
  const dia = parseInt(partes[3] ?? '', 10);
  if (ano < 1 || mes < 1 || mes > 12 || dia < 1) return false;
  return dia <= diasNoMes(ano, mes);
}

function assertCentavos(valor: unknown, minimo: 0 | 1, campo: string): void {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < minimo) {
    throw new LiquidacaoErro('CentavosInvalidos', `${campo} precisa ser inteiro seguro >= ${minimo}`);
  }
}

function validarEvento(evento: LiquidacaoEvento): void {
  const e = evento as unknown as Record<string, unknown>;
  if (typeof e.id !== 'string' || e.id.length === 0) throw new LiquidacaoErro('EventoInvalido', 'id vazio');
  if (e.tipo === 'baixa') {
    if (e.estornaBaixaId !== null) throw new LiquidacaoErro('EventoInvalido', `baixa ${e.id} com estornaBaixaId`);
  } else if (e.tipo === 'estorno') {
    if (typeof e.estornaBaixaId !== 'string' || e.estornaBaixaId.length === 0) {
      throw new LiquidacaoErro('EventoInvalido', `estorno ${e.id} sem estornaBaixaId`);
    }
  } else {
    throw new LiquidacaoErro('EventoInvalido', `tipo desconhecido em ${e.id}`);
  }
  if (!ehDiaCivil(e.data)) throw new LiquidacaoErro('DataInvalida', `data invalida em ${e.id}`);
  assertCentavos(e.valorCentavos, 1, `valorCentavos de ${e.id}`);
}

function compararBaixas(a: BaixaEvento, b: BaixaEvento): number {
  if (a.data !== b.data) return a.data < b.data ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}
```

Exported reducer, steps in exactly the Finance order (validate every event first, then index, then resolve estornos):

```ts
export function reduzirLiquidacao(entrada: LiquidacaoEntrada): Liquidacao {
  assertCentavos(entrada.valorOriginalCentavos, 0, 'valorOriginalCentavos');
  for (const evento of entrada.eventos) validarEvento(evento);

  const porId = new Map<string, LiquidacaoEvento>();
  for (const evento of entrada.eventos) {
    if (porId.has(evento.id)) throw new LiquidacaoErro('IdDuplicado', `id repetido ${evento.id}`);
    porId.set(evento.id, evento);
  }

  const estornadas = new Set<string>();
  for (const evento of entrada.eventos) {
    if (evento.tipo !== 'estorno') continue;
    const alvo = porId.get(evento.estornaBaixaId);
    if (!alvo || alvo.tipo !== 'baixa') {
      throw new LiquidacaoErro('EstornoSemBaixa', `estorno ${evento.id} nao cita uma baixa da lista`);
    }
    if (estornadas.has(alvo.id)) throw new LiquidacaoErro('BaixaJaEstornada', `baixa ${alvo.id} ja estornada`);
    if (evento.valorCentavos !== alvo.valorCentavos) {
      throw new LiquidacaoErro('EstornoValorDivergente', `estorno ${evento.id} difere da baixa ${alvo.id}`);
    }
    estornadas.add(alvo.id);
  }

  const baixasAtivas = entrada.eventos
    .filter((e): e is BaixaEvento => e.tipo === 'baixa' && !estornadas.has(e.id))
    .map((b) => ({ ...b }))
    .sort(compararBaixas);
  let pagoCentavos = 0;
  for (const baixa of baixasAtivas) pagoCentavos += baixa.valorCentavos;
  const ultima = baixasAtivas[baixasAtivas.length - 1];
  return {
    pagoCentavos,
    abertoCentavos: Math.max(entrada.valorOriginalCentavos - pagoCentavos, 0),
    dataUltimoPagamento: ultima ? ultima.data : null,
    baixasAtivas,
  };
}
```

Rules this encodes (all from the Finance plan): resolution is by id, so array order never matters (an estorno listed before its baixa is valid); the estorno date is never compared with the baixa date; `pagoCentavos` is NOT clamped (two concurrent full baixas give pago = 2x original, the "registrada em duplicidade" case of audit 11.4 must stay visible); `abertoCentavos` is clamped at 0; the input is never mutated (`.filter` makes a new array and each baixa is spread before `.sort`).

Exported Sales helpers (same file, after the reducer):

```ts
export type StatusLinhaLiquidavel = 'open' | 'paid' | 'void';
export type StatusVendaLiquidavel = 'draft' | 'open' | 'won' | 'lost' | 'cancelled';

/** Codigos de wire de C5, iguais ao `error` que a API responde. */
export type RecusaBaixaCodigo =
  | 'sale_not_won'
  | 'row_void'
  | 'invalid_paid_on'
  | 'paid_on_in_future'
  | 'already_paid';
export type RecusaEstornoCodigo = 'not_found' | 'already_reversed';

export interface NovaBaixaEntrada {
  readonly valorOriginalCentavos: number;
  readonly eventos: readonly LiquidacaoEvento[];
  readonly statusLinha: StatusLinhaLiquidavel;
  readonly statusVenda: StatusVendaLiquidavel;
  readonly dataPagamento: string;
  readonly hojeSaoPaulo: string;
}

export type NovaBaixaResultado =
  | { readonly ok: true; readonly valorCentavos: number; readonly data: string }
  | { readonly ok: false; readonly codigo: RecusaBaixaCodigo };

export function validarNovaBaixa(entrada: NovaBaixaEntrada): NovaBaixaResultado {
  if (!ehDiaCivil(entrada.hojeSaoPaulo)) throw new LiquidacaoErro('DataInvalida', 'hojeSaoPaulo invalido');
  if (entrada.statusVenda !== 'won') return { ok: false, codigo: 'sale_not_won' };
  if (entrada.statusLinha === 'void') return { ok: false, codigo: 'row_void' };
  if (!ehDiaCivil(entrada.dataPagamento)) return { ok: false, codigo: 'invalid_paid_on' };
  if (entrada.dataPagamento > entrada.hojeSaoPaulo) return { ok: false, codigo: 'paid_on_in_future' };
  const { abertoCentavos } = reduzirLiquidacao({
    valorOriginalCentavos: entrada.valorOriginalCentavos,
    eventos: entrada.eventos,
  });
  if (abertoCentavos === 0) return { ok: false, codigo: 'already_paid' };
  return { ok: true, valorCentavos: abertoCentavos, data: entrada.dataPagamento };
}

export interface EstornoEntrada {
  readonly baixaId: string;
  readonly eventos: readonly LiquidacaoEvento[];
  readonly hojeSaoPaulo: string;
}

export type EstornoResultado =
  | { readonly ok: true; readonly estornaBaixaId: string; readonly valorCentavos: number; readonly data: string }
  | { readonly ok: false; readonly codigo: RecusaEstornoCodigo };

export function validarEstorno(entrada: EstornoEntrada): EstornoResultado {
  if (!ehDiaCivil(entrada.hojeSaoPaulo)) throw new LiquidacaoErro('DataInvalida', 'hojeSaoPaulo invalido');
  const { baixasAtivas } = reduzirLiquidacao({ valorOriginalCentavos: 0, eventos: entrada.eventos });
  const alvo = entrada.eventos.find((e) => e.id === entrada.baixaId && e.tipo === 'baixa');
  if (!alvo) return { ok: false, codigo: 'not_found' };
  if (!baixasAtivas.some((b) => b.id === alvo.id)) return { ok: false, codigo: 'already_reversed' };
  return { ok: true, estornaBaixaId: alvo.id, valorCentavos: alvo.valorCentavos, data: entrada.hojeSaoPaulo };
}

/** Cache de `status` da linha: `void` e decisao do Sales e nunca muda aqui. */
export function statusCacheDaLinha(statusAtual: StatusLinhaLiquidavel, liquidacao: Liquidacao): StatusLinhaLiquidavel {
  if (statusAtual === 'void') return 'void';
  return liquidacao.baixasAtivas.length > 0 && liquidacao.abertoCentavos === 0 ? 'paid' : 'open';
}

/** Trava de C5 (valor, vencimento, sair de won): existe baixa ativa? */
export function temBaixaAtiva(eventos: readonly LiquidacaoEvento[]): boolean {
  return reduzirLiquidacao({ valorOriginalCentavos: 0, eventos }).baixasAtivas.length > 0;
}

/** Linha de `sales_ops_settlements` (camelCase do Drizzle, C3) para o evento do redutor. */
export interface SettlementRowLike {
  readonly id: string;
  readonly type: string;
  readonly reversesSettlementId: string | null;
  readonly paidOn: string;
  readonly amountBrl: number;
}

export function eventoDeSettlement(row: SettlementRowLike): LiquidacaoEvento {
  return {
    id: row.id,
    tipo: row.type,
    estornaBaixaId: row.reversesSettlementId,
    data: row.paidOn,
    valorCentavos: row.amountBrl,
  } as unknown as LiquidacaoEvento;
}
```

Notes the executor must keep:
- The validators compare ISO days as strings (`>`), strictly greater refuses, so today is accepted, exactly as Finance (`F:.../03-baixas-api.md:214`).
- A malformed `hojeSaoPaulo` is a programming error, so it THROWS `LiquidacaoErro('DataInvalida')` (API answers 500); a malformed `dataPagamento` is user input, so it RETURNS `invalid_paid_on` (API answers 422).
- A corrupt history (for example two estornos of one baixa) makes both validators throw the reducer's `LiquidacaoErro`, never a refusal: the DB constraints of C3 make it impossible, and hiding it would be worse.
- `validarNovaBaixa` reads "already paid" from the REDUCER (`abertoCentavos === 0`), never from `statusLinha === 'paid'`: the cache can be stale, the facts cannot.
- `eventoDeSettlement` casts on purpose and does not validate; `reduzirLiquidacao` is the validator (a DB row with `type = 'baixa'` and a `reversesSettlementId` surfaces as `EventoInvalido`).

### `packages/shared-utils/src/index.ts`

Append one line: `export * from './liquidacao.js';`.
Before committing, prove no name collision with the other five modules: `git grep -nE "export (function|const|class|type|interface) (reduzirLiquidacao|LiquidacaoErro|validarNovaBaixa|validarEstorno|statusCacheDaLinha|temBaixaAtiva|eventoDeSettlement|BaixaEvento|EstornoEvento|LiquidacaoEvento|LiquidacaoEntrada|Liquidacao|NovaBaixaEntrada|NovaBaixaResultado|EstornoEntrada|EstornoResultado|SettlementRowLike|StatusLinhaLiquidavel|StatusVendaLiquidavel|RecusaBaixaCodigo|RecusaEstornoCodigo|LiquidacaoErroCodigo)\b" -- packages/` must list only `packages/shared-utils/src/liquidacao.ts`.

### `packages/shared-utils/package.json`

Add to `exports`, after `./professional-split`:

```json
"./liquidacao": {
  "types": "./dist/liquidacao.d.ts",
  "import": "./dist/liquidacao.js"
}
```

Slice 01 adds `./sao-paulo-day` to the same map and the same index; execution is serial (H6), so the second slice to merge simply keeps both entries.

## Steps

1. Red - create `packages/shared-utils/src/__tests__/liquidacao.test.ts` with every describe block listed under Oracle tests, importing from `../liquidacao.js`.
   Run `pnpm --filter @fxl-sales/shared-utils exec vitest run src/__tests__/liquidacao.test.ts` and confirm it fails because the module does not exist.
2. Green - create `packages/shared-utils/src/liquidacao.ts` exactly as in Design; re-run the same command until every test passes.
3. Green - add the `./liquidacao` export to `packages/shared-utils/package.json` and the `export * from './liquidacao.js';` line to `src/index.ts`; the `package boundary` describe block now passes.
4. Refactor - run the collision `git grep` from Design; run `pnpm --filter @fxl-sales/shared-utils run type-check`; run `pnpm --filter @fxl-sales/shared-utils run build` and check `packages/shared-utils/dist/liquidacao.js` and `dist/liquidacao.d.ts` exist (delete `packages/shared-utils/tsconfig.tsbuildinfo` first if `dist/` was absent; the script already uses `tsc --build --force`); run `node scripts/build-contract.mjs`.
5. Mutation proof - apply each mutation listed under Oracle tests one at a time to `liquidacao.ts`, confirm at least one named test fails, and revert (record the results in the exec notes).
6. Docs - apply the CLAUDE.md and propostas.md edits under Docs.
7. Lint on changed files: the package has no linter (`lint` echoes); run `pnpm run lint` at the root once to prove nothing else regressed.

## Oracle tests

File: `packages/shared-utils/src/__tests__/liquidacao.test.ts` (vitest, `import { describe, expect, it } from 'vitest'`, `import { readFileSync } from 'node:fs'`).
Every date is a literal; the file never builds a date from the clock.
Local helpers: `const baixa = (id: string, data: string, valorCentavos: number): BaixaEvento => ({ id, tipo: 'baixa', estornaBaixaId: null, data, valorCentavos });` and `const estorno = (id: string, alvo: string, data: string, valorCentavos: number): EstornoEvento => ({ id, tipo: 'estorno', estornaBaixaId: alvo, data, valorCentavos });`.

### describe('liquidacao parity with Finance')

A table `const PARIDADE_FINANCE: readonly CasoParidade[]` with a header comment naming the source (`F:nexo/plans/20260924T011357Z-feedback-socio-financeiro/01-liquidacao-redutor.md`, section "Testes oraculo", copied 2026-09-23) and the instruction "when Finance changes a rule, change it here in the same breath; a failure here is a cross-app divergence".

```ts
type Esperado =
  | { pago: number; aberto: number; data: string | null; ativas: string[] }
  | { erro: LiquidacaoErroCodigo };
interface CasoParidade {
  readonly financeCaso: number;
  readonly nome: string;
  readonly original: number;
  readonly eventos: readonly LiquidacaoEvento[];
  readonly esperado: Esperado;
}
```

Rows (financeCaso: nome, original, eventos -> esperado):
- 1 `sem eventos`: 1000, [] -> pago 0, aberto 1000, data null, ativas [].
- 2 `baixa integral`: 1000, [baixa b1 2026-03-25 1000] -> 1000, 0, '2026-03-25', ['b1'].
- 3 `um centavo em aberto (8.15 x 8.14)`: 815, [baixa b1 2026-03-10 814] -> 814, 1, '2026-03-10', ['b1'] (Finance built these with `centavosDeNumeric`; Sales stores cents, so the literals are the same numbers).
- 4 `valor que nao divide exato, parcial`: 1000, [b1 2026-01-10 333, b2 2026-02-10 333] -> 666, 334, '2026-02-10', ['b1','b2'].
- 4 `valor que nao divide exato, completo`: the same plus b3 2026-03-10 334 -> 1000, 0, '2026-03-10', ['b1','b2','b3'].
- 5 `data = a MAIOR, nao a ultima do array nem a menor`: 3000, [b1 2026-03-25 1000, b2 2026-01-05 1000, b3 2026-02-14 1000] -> 3000, 0, '2026-03-25', ['b2','b3','b1'].
- 6 `empate de data ordena por id`: 20, [b2 2026-03-01 10, b1 2026-03-01 10] -> 20, 0, '2026-03-01', ['b1','b2'].
- 7 `estorno desativa a baixa citada, inclusive a data`: 1000, [b1 2026-03-25 1000, estorno e1->b1 2026-03-26 1000] -> 0, 1000, null, [].
- 8 `estorno e nova baixa`: 1000, [b1 2026-03-25 1000, e1->b1 2026-03-26 1000, b2 2026-03-28 1000] -> 1000, 0, '2026-03-28', ['b2'].
- 9 `estorno da baixa mais recente devolve a data anterior`: 1000, [b1 2026-01-10 500, b2 2026-02-10 500, e1->b2 2026-02-11 500] -> 500, 500, '2026-01-10', ['b1'].
- 10 `ordem do array nao importa`: case 8's events reversed (e1 before b1) -> same as case 8.
- 11 `pago acima do original nao e truncado e aberto nao fica negativo`: 1000, [b1 2026-03-01 1000, b2 2026-03-02 1000] -> 2000, 0, '2026-03-02', ['b1','b2'].
- 12 `original zero`: 0, [] -> 0, 0, null, [].
- 14 `estorno citando id desconhecido`: 1000, [b1 ... 1000, e1->'x' ... 1000] -> erro EstornoSemBaixa.
- 15 `estorno de um estorno`: 1000, [b1 2026-03-01 1000, e1->b1 2026-03-02 1000, e2->e1 2026-03-03 1000] -> erro EstornoSemBaixa.
- 16 `dois estornos da mesma baixa`: 1000, [b1, e1->b1, e2->b1] (all 1000) -> erro BaixaJaEstornada.
- 17 `estorno com valor diferente`: 1000, [b1 1000, e1->b1 999] -> erro EstornoValorDivergente.
- 18 `ids repetidos`: 2000, [b1 2026-03-01 1000, b1 2026-03-02 1000] -> erro IdDuplicado.
- 19 `valorCentavos invalido`: one row each for 0, -100, 10.5, NaN, Infinity, 2 ** 53 in a baixa -> erro CentavosInvalidos.
- 20 `original invalido`: rows for -1 and 10.5 -> erro CentavosInvalidos (0 is case 12).
- 21 `data invalida`: one row each for '2026-3-05', '2026-02-30', '2026-13-01', '25/03/2026', '', '2026-03-05T00:00:00Z' -> erro DataInvalida; plus `bissexto aceito`: 1000, [b1 '2024-02-29' 1000] -> 1000, 0, '2024-02-29', ['b1'].
- 22 `evento malformado`: rows for a baixa with estornaBaixaId 'x', an estorno with estornaBaixaId null, tipo 'pagamento', id '' (built with `as unknown as LiquidacaoEvento`) -> erro EventoInvalido.

Tests:
- `it.each(PARIDADE_FINANCE)('Finance case $financeCaso: $nome', ...)`: for a success row assert `{ pagoCentavos, abertoCentavos, dataUltimoPagamento, ids: baixasAtivas.map((b) => b.id) }` equals the expectation; for an error row assert `expect(() => ...).toThrow(LiquidacaoErro)` and that the caught error's `codigo` equals the expected one (use a `try/catch` capture helper `const capturar = (fn: () => unknown): unknown => { try { fn(); } catch (e) { return e; } throw new Error('nao lancou'); }`).
- `covers every Finance reducer oracle case`: `expect([...new Set(PARIDADE_FINANCE.map((c) => c.financeCaso))].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22])` (Finance case 13 is the no-mutation test below, 23 is the error-class test below, 24-31 are Finance's numeric converters and source guard that Sales does not need).

### describe('reduzirLiquidacao - invariants')
- `does not mutate its input and copies the active baixas` (Finance 13): freeze each event and the array (`Object.freeze`), in unsorted order; the call does not throw, the array keeps its order, and `result.baixasAtivas[0]` is not `===` any input event.
- `LiquidacaoErro is not a RangeError` (Finance 23): capture the error of Finance case 16; `instanceof LiquidacaoErro`, `not instanceof RangeError`, `name === 'LiquidacaoErro'`.

### describe('validarNovaBaixa')
Base input: `{ valorOriginalCentavos: 1000, eventos: [], statusLinha: 'open', statusVenda: 'won', dataPagamento: '2026-03-26', hojeSaoPaulo: '2026-03-26' }`.
- `accepts today and returns the whole open amount`: `{ ok: true, valorCentavos: 1000, data: '2026-03-26' }`.
- `accepts a past day`: dataPagamento '2026-03-10' -> ok, data '2026-03-10'.
- `refuses tomorrow as paid_on_in_future`: '2026-03-27' -> `{ ok: false, codigo: 'paid_on_in_future' }`.
- `refuses a malformed day as invalid_paid_on`: '2026-02-30' and '26/03/2026' -> invalid_paid_on.
- `refuses a row that is already paid by its facts`: eventos [baixa b1 2026-03-01 1000] -> already_paid.
- `trusts the facts over a stale status cache`: statusLinha 'paid', eventos [] -> ok with valorCentavos 1000; statusLinha 'open', eventos [b1 1000] -> already_paid.
- `settles again after a reversal`: eventos [b1 1000, e1->b1 1000] -> ok, valorCentavos 1000.
- `refuses a void row as row_void`: statusLinha 'void' -> row_void.
- `refuses a proposta that is not won`: for each of 'draft', 'open', 'lost', 'cancelled' -> sale_not_won.
- `checks in a fixed order`: statusVenda 'open' + statusLinha 'void' + dataPagamento '2026-03-27' -> sale_not_won; statusLinha 'void' + '2026-03-27' -> row_void; '2026-03-27' + eventos [b1 1000] -> paid_on_in_future.
- `a zero-amount row has nothing to settle`: valorOriginalCentavos 0 -> already_paid.
- `throws on a malformed today`: hojeSaoPaulo '2026-3-26' -> throws LiquidacaoErro with codigo DataInvalida.
- `throws on a corrupt history`: two estornos of b1 -> throws LiquidacaoErro BaixaJaEstornada.

### describe('validarEstorno')
- `reverses an active baixa on today with its own amount`: eventos [b1 2026-03-01 1000], baixaId 'b1', hoje '2026-03-26' -> `{ ok: true, estornaBaixaId: 'b1', valorCentavos: 1000, data: '2026-03-26' }`.
- `refuses an unknown id as not_found`: baixaId 'x' -> not_found.
- `refuses the id of an estorno as not_found`: eventos [b1, e1->b1], baixaId 'e1' -> not_found.
- `refuses a baixa already reversed`: eventos [b1, e1->b1], baixaId 'b1' -> already_reversed.
- `throws on a malformed today`: hoje '' -> LiquidacaoErro DataInvalida.

### describe('statusCacheDaLinha and temBaixaAtiva')
- `void stays void even with an active baixa`: statusCacheDaLinha('void', reduce(1000, [b1 1000])) -> 'void'.
- `paid only when an active baixa leaves nothing open`: ('open', reduce(1000,[b1 1000])) -> 'paid'; ('paid', reduce(1000,[b1 1000, e1->b1 1000])) -> 'open'; ('open', reduce(0, [])) -> 'open'.
- `temBaixaAtiva`: [] -> false; [b1] -> true; [b1, e1->b1] -> false; [b1, e1->b1, b2] -> true.
- `eventoDeSettlement maps a DB row and lets the reducer validate it`: `{ id: 's1', type: 'baixa', reversesSettlementId: null, paidOn: '2026-03-01', amountBrl: 1000 }` reduces to pago 1000; the same row with `reversesSettlementId: 's0'` makes `reduzirLiquidacao` throw EventoInvalido.

### describe('source guard')
- `liquidacao.ts reads no clock, no float, no locale and imports nothing`: `const fonte = readFileSync(new URL('../liquidacao.ts', import.meta.url), 'utf8');` then `expect(fonte).not.toMatch(re)` for each of `/^\s*import\s/m`, `/new\s+Date\s*\(/`, `/Date\.now\s*\(/`, `/parseFloat\s*\(/`, `/\bNumber\s*\(/`, `/toFixed\s*\(/`, `/\.toISOString\s*\(/`, `/\.getUTC/`, `/\bIntl\b/`, `/Math\.round\s*\(/`, `/localeCompare/`, `/todayInSaoPaulo/`; and `expect(fonte).toMatch(/export function reduzirLiquidacao\(/)` so an empty or wrong file cannot pass vacuously.
  Sanity inside the same test: `expect('Number.isSafeInteger(x)').not.toMatch(/\bNumber\s*\(/)` and `expect('x = new Date(1)').toMatch(/new\s+Date\s*\(/)`.

### describe('package boundary')
- `the root index re-exports the reducer`: `const raiz = await import('../index.js'); expect(raiz.reduzirLiquidacao).toBe(reduzirLiquidacao); expect(raiz.LiquidacaoErro).toBe(LiquidacaoErro); expect(raiz.validarNovaBaixa).toBe(validarNovaBaixa); expect(raiz.validarEstorno).toBe(validarEstorno);`.
- `package.json exports the ./liquidacao subpath`: parse `readFileSync(new URL('../../package.json', import.meta.url), 'utf8')` and expect `exports['./liquidacao']` toEqual `{ types: './dist/liquidacao.d.ts', import: './dist/liquidacao.js' }`.

### Commands (run-once)

```bash
pnpm --filter @fxl-sales/shared-utils exec vitest run src/__tests__/liquidacao.test.ts
pnpm --filter @fxl-sales/shared-utils run test
pnpm --filter @fxl-sales/shared-utils run type-check
pnpm --filter @fxl-sales/shared-utils run build && test -f packages/shared-utils/dist/liquidacao.js && test -f packages/shared-utils/dist/liquidacao.d.ts
node scripts/build-contract.mjs
```

The worktree has no `node_modules`; the executor runs `pnpm install --frozen-lockfile` once before the first command (no dependency changes in this slice).
Verify confirms the vitest output names `liquidacao.test.ts` with a non-zero test count (a missing file exits 0 with `passWithNoTests: true`, see memory "Vacuous green checks").

### Mutations that must each turn at least one named test red

- Estorno subtracts its own amount instead of deactivating the cited baixa (keep the baixa in `baixasAtivas`, subtract from pago): kills Finance cases 7 and 9 (date stays set).
- `dataUltimoPagamento` = the last baixa of the INPUT array, or the smallest date: kills Finance case 5.
- Remove `Math.max(..., 0)`: kills Finance case 11 (aberto -1000).
- Clamp `pagoCentavos` to the original: kills Finance case 11 (pago 1000).
- Drop the `alvo.tipo !== 'baixa'` check: kills Finance case 15.
- Drop the `estornadas.has` check: kills Finance case 16.
- Drop the `valorCentavos` equality: kills Finance case 17.
- Replace `diasNoMes` with a constant 31: kills Finance case 21 ('2026-02-30').
- In `validarNovaBaixa`, change `>` to `>=`: kills `accepts today and returns the whole open amount`.
- In `validarNovaBaixa`, read `statusLinha === 'paid'` instead of the reducer: kills `trusts the facts over a stale status cache`.
- In `statusCacheDaLinha`, drop the void branch: kills `void stays void even with an active baixa`.
- Delete a row of `PARIDADE_FINANCE`: kills `covers every Finance reducer oracle case`.
- Point the guard at a non-existent path: the test throws ENOENT (red), proving it reads the real file.

## Docs

`CLAUDE.md`, section `## Propostas domain`, block `Statuses and payables:`, append these bullets after the `sales_ops_settings.commission_on_recurring` line (do NOT touch the `Leaving won` line; slice 06 owns it):

```markdown
- `reduzirLiquidacao` in `packages/shared-utils/src/liquidacao.ts` is the ONE settlement rule and mirrors the Finance reducer: a baixa is active while no estorno cites it, paid is the sum of active baixas, and the displayed date is the GREATEST active date.
- `validarNovaBaixa` and `validarEstorno` in the same file are the only pre-write settlement checks; they take today as an argument and never read the clock. Web imports the `/liquidacao` subpath, never the root.
- `liquidacao.ts` imports nothing; its parity table in `liquidacao.test.ts` must change in the same change as any Finance rule change.
```

`nexo/knowledge/reference/propostas.md`, insert after the `computeSaleFinancials` bullet (the one ending "because the API's `validatePaymentPlan` requires the parcelas to equal exactly that.", currently line 111):

```markdown
- `reduzirLiquidacao` in `packages/shared-utils/src/liquidacao.ts` (subpath `@fxl-sales/shared-utils/liquidacao`) is the ONE settlement rule of the Sales ledger and a deliberate mirror of the FXL Finance reducer of the same name (`F:nexo/plans/20260924T011357Z-feedback-socio-financeiro/01-liquidacao-redutor.md`).
  It is a copy and not an import because the two repos share no package yet; audit section 11 says the future contract package must make both reducers agree, and until then the table `PARIDADE_FINANCE` in `packages/shared-utils/src/__tests__/liquidacao.test.ts` holds Finance's oracle cases verbatim, so a rule change on either side shows up as a red test.
  Its names, field names and error codes are Finance's (`valorOriginalCentavos`, `data`, `dataUltimoPagamento`, `baixasAtivas`, `LiquidacaoErro.codigo`), which is why they are Portuguese in an otherwise English codebase.
  A baixa is active while no estorno cites it; paid is the integer sum of the active baixas and is never clamped, so two concurrent full baixas stay visible as double payment; open is clamped at zero; the displayed date is the GREATEST active date (Finance decision E, which replaced the "smallest" of audit section 5.6).
  A malformed history (an estorno of an estorno, an estorno of an unknown id, a second estorno of one baixa, an estorno whose amount differs) THROWS `LiquidacaoErro` rather than being ignored, because the settlement table's constraints make it impossible and silently skipping it would hide corruption.
  The file imports nothing and never reads the clock, float or locale APIs; a source guard in the same test file enforces it.
- `validarNovaBaixa` and `validarEstorno` are the pure pre-write checks the API runs before inserting a fact, and they return the C5 wire codes directly.
  A new baixa is refused in the fixed order `sale_not_won`, `row_void`, `invalid_paid_on`, `paid_on_in_future`, `already_paid`; today is accepted and tomorrow is not (string comparison of São Paulo days, today passed in by the caller); the amount is always the reducer's whole open amount, never a caller value, which is what makes v1 full-payment-only.
  "Already paid" is read from the facts through the reducer, never from the `status` column, because `status = 'paid'` is only a cache (`statusCacheDaLinha`), and `void` stays a Sales decision that the cache never overwrites.
  A zero-amount row answers `already_paid`: it has nothing open, and the settlements table refuses a zero amount.
  An estorno is refused `not_found` when the id is unknown or names an estorno, and `already_reversed` when the baixa already has one; it is dated today and carries the baixa's own amount.
```

## Security notes

- Pure module, no I/O, no tenant data: the org scoping of the facts it reduces is the API's job (slices 04 and 06, `eq(table.orgId, orgId)` inside `withTenant`).
- The amount of a baixa never comes from the request body: `validarNovaBaixa` returns it from the reducer, and slice 06 must write `result.valorCentavos`, never a body field.
- `validarNovaBaixa` must be called INSIDE the transaction that holds the row lock (`SELECT ... FOR UPDATE` on the receivable or payable), with the facts read in that same transaction; calling it on a pre-transaction read reopens the double-baixa race. This is slice 06's obligation; this slice documents it in the reference.

## Contract deviations

C2 in `00-OVERVIEW.md` does not match the Finance plan; the task says follow Finance, so this slice does, and slices 03, 04, 06 and 08 must code against the names below:
1. Input field `valorCentavos` of the row is `valorOriginalCentavos` (Finance N2 signature).
2. The event date field is `data`, not `dataPagamento` (for an estorno it is the reversal day, matching C3's `paid_on` semantics).
3. Output date is `dataUltimoPagamento`, not `dataPagamento`.
4. `baixasAtivas` is `BaixaEvento[]` (full copied facts sorted by `(data, id)`), not `string[]`; ids are `baixasAtivas.map((b) => b.id)`.
5. There is no `quitado` field (Finance has none). Use `statusCacheDaLinha(status, liquidacao)` for the `status` cache and `temBaixaAtiva(eventos)` for the C5 locks; bootstrap's `paidOn` (C6) is `liquidacao.dataUltimoPagamento`.
6. The reducer THROWS `LiquidacaoErro` on an estorno of an estorno or of an unknown id (Finance cases 14 and 15), it does not ignore them.
7. Finance's `centavosDeNumeric` / `numericDeCentavos` are not ported: Sales stores `amount_brl` as integer cents, so there is no numeric column to convert.
8. Added beyond C2, same subpath: `validarNovaBaixa`, `validarEstorno`, `statusCacheDaLinha`, `temBaixaAtiva`, `eventoDeSettlement` and their types.
   `eventoDeSettlement` assumes slice 03 declares `paid_on` with Drizzle `date('paid_on', { mode: 'string' })` (the default mode for `date` is string; slice 03 must not switch it to `mode: 'date'`) and `amount_brl` as `integer`.

## Decisions for AUDIT

- Refusal order of a new baixa is `sale_not_won`, `row_void`, `invalid_paid_on`, `paid_on_in_future`, `already_paid` (state of the target first, then the input date, then the facts); Finance has no Sales-only states, and its shared part (date, future, already settled) keeps Finance's order.
- A zero-amount receivable or payable answers `409 already_paid` to a baixa (nothing is open, and C3 forbids a zero-amount fact) instead of a new error code.
- An estorno does not check the proposta status or the row status: C5 forbids leaving `won` and voiding a row while a baixa is active, so an active baixa can only sit on a non-void row of a won proposta, and blocking an estorno would make that state unrecoverable if it ever occurred.

## Out of scope

- Any SQL, migration, Drizzle schema, trigger or RLS (slice 03).
- Routes, HTTP status mapping, the cache write, bootstrap fields, the row lock (slices 04 and 06).
- The São Paulo "today" helper (slice 01, C1); callers pass `hojeSaoPaulo` from `todayInSaoPaulo()`.
- UI (slice 08).
- Partial payment, interest, fines, discounts, `origin`, actor and reason metadata (they do not affect the reduction).
- Any integration code.
