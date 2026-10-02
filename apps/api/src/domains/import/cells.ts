import { isIsoDay } from '@fxl-sales/shared-utils/sao-paulo-day';
import type { CellKind } from './workbook-schema.js';
import type { CellValue } from './types.js';

export type RawScalar = string | number | boolean | Date | null;
/** One cell as the parser read it. `percent` is true when the cell's number format contains '%'. */
export type RawCell = { value: RawScalar; percent: boolean; problem: null | 'formula_without_result' | 'cell_error' };
export function rawCell(value: RawScalar, percent = false): RawCell {
  return { value, percent, problem: null };
}

export type CellIssueCode =
  | 'invalid_text'
  | 'too_long'
  | 'date_in_text_column'
  | 'invalid_money'
  | 'negative_value'
  | 'too_many_decimals'
  | 'invalid_int'
  | 'out_of_range'
  | 'invalid_pct'
  | 'invalid_day'
  | 'invalid_option'
  | 'invalid_bool'
  | 'too_many_items'
  | 'formula_without_result'
  | 'cell_error';
export type CoerceResult = { ok: true; value: CellValue } | { ok: false; code: CellIssueCode; message: string };

/** Postgres int4, the money columns' type. */
export const MONEY_MAX_CENTS = 2_147_483_647;

const pad2 = (n: number) => String(n).padStart(2, '0');
const pad4 = (n: number) => String(n).padStart(4, '0');

function fail(code: CellIssueCode, message: string): CoerceResult {
  return { ok: false, code, message };
}
function ok(value: CellValue): CoerceResult {
  return { ok: true, value };
}

export function isBlankRaw(raw: RawCell): boolean {
  if (raw.problem !== null) return false;
  if (raw.value === null) return true;
  return typeof raw.value === 'string' && raw.value.trim() === '';
}

/** THE matcher for tab names, headers, enum labels and refs: trim, NFD, strip accents, lowercase, collapse spaces. */
export function normalizeLabel(text: string): string {
  return text
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** How a value is quoted in messages. */
export function displayRaw(raw: RawCell): string {
  const v = raw.value;
  if (v === null) return '';
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return 'data inválida';
    return `${pad2(v.getUTCDate())}/${pad2(v.getUTCMonth() + 1)}/${pad4(v.getUTCFullYear())}`;
  }
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'number') return String(v);
  return v.trim();
}

function moneyFromNumber(n: number, display: string): CoerceResult {
  if (!Number.isFinite(n)) return fail('invalid_money', invalidMoneyMessage(display));
  if (n < 0) return fail('negative_value', `O valor "${display}" é negativo; use um valor igual ou maior que zero.`);
  const c = n * 100;
  if (Math.abs(c - Math.round(c)) > 1e-6) {
    return fail('too_many_decimals', `O valor "${display}" tem mais de duas casas decimais.`);
  }
  return moneyResult(BigInt(Math.round(c)), display);
}

function invalidMoneyMessage(display: string): string {
  return `"${display}" não é um valor em reais válido; use o formato 1.234,56.`;
}

function moneyResult(cents: bigint, display: string): CoerceResult {
  if (cents > BigInt(MONEY_MAX_CENTS)) {
    return fail('out_of_range', `O valor "${display}" passa do limite de R$ 21.474.836,47.`);
  }
  return ok(Number(cents));
}

function moneyFromString(text: string, display: string): CoerceResult {
  const stripped = text.replace(/R\$/gi, '').replace(/\s+/g, '');
  if (stripped.startsWith('-')) {
    return fail('negative_value', `O valor "${display}" é negativo; use um valor igual ou maior que zero.`);
  }
  let intPart: string;
  let frac = '';
  if (/^\d{1,3}(\.\d{3})*,\d+$/.test(stripped) || /^\d+,\d+$/.test(stripped)) {
    const [i = '', f = ''] = stripped.split(',');
    intPart = i.replace(/\./g, '');
    frac = f;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(stripped)) {
    intPart = stripped.replace(/\./g, '');
  } else if (/^\d+\.\d{1,2}$/.test(stripped)) {
    const [i = '', f = ''] = stripped.split('.');
    intPart = i;
    frac = f;
  } else if (/^\d+$/.test(stripped)) {
    intPart = stripped;
  } else {
    return fail('invalid_money', invalidMoneyMessage(display));
  }
  if (frac.length > 2) {
    return fail('too_many_decimals', `O valor "${display}" tem mais de duas casas decimais.`);
  }
  return moneyResult(BigInt(intPart) * 100n + BigInt(frac.padEnd(2, '0') || '0'), display);
}

function coerceMoney(raw: RawCell, display: string): CoerceResult {
  const v = raw.value;
  if (typeof v === 'number') return moneyFromNumber(v, display);
  if (typeof v === 'string') return moneyFromString(v, display);
  return fail('invalid_money', invalidMoneyMessage(display));
}

function coerceInt(kind: { min: number; max: number }, raw: RawCell, display: string): CoerceResult {
  const v = raw.value;
  let n: number;
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) return fail('invalid_int', `"${display}" não é um número inteiro.`);
    n = v;
  } else if (typeof v === 'string') {
    if (!/^-?\d+$/.test(v.trim())) return fail('invalid_int', `"${display}" não é um número inteiro.`);
    n = Number(v.trim());
  } else {
    return fail('invalid_int', `"${display}" não é um número inteiro.`);
  }
  if (!Number.isSafeInteger(n) || n < kind.min || n > kind.max) {
    return fail('out_of_range', `O número ${display} está fora do intervalo de ${kind.min} a ${kind.max}.`);
  }
  return ok(n);
}

function pctFromString(text: string, display: string): { ok: true; value: number } | { ok: false; code: 'invalid_pct' | 'out_of_range'; message: string } {
  const s = text.replace(/\s+/g, '').replace(/%$/, '');
  if (!/^-?\d+([.,]\d+)?$/.test(s)) {
    return {
      ok: false,
      code: 'invalid_pct',
      message: `"${display}" não é um percentual válido; use por exemplo 10 ou 12,5%.`,
    };
  }
  return finishPct(Number(s.replace(',', '.')), display);
}

function finishPct(v: number, display: string) {
  if (!Number.isFinite(v) || v < 0 || v > 100) {
    return {
      ok: false as const,
      code: 'out_of_range' as const,
      message: `O percentual ${display} deve estar entre 0 e 100.`,
    };
  }
  return { ok: true as const, value: Math.round(v * 100) / 100 };
}

function coercePct(raw: RawCell, display: string): CoerceResult {
  const v = raw.value;
  if (typeof v === 'number') {
    const r = finishPct(raw.percent ? v * 100 : v, display);
    return r.ok ? ok(r.value) : fail(r.code, r.message);
  }
  if (typeof v === 'string') {
    const r = pctFromString(v, display);
    return r.ok ? ok(r.value) : fail(r.code, r.message);
  }
  return fail('invalid_pct', `"${display}" não é um percentual válido; use por exemplo 10 ou 12,5%.`);
}

export function coercePctList(
  text: string,
): { ok: true; value: number[] | null } | { ok: false; code: 'invalid_pct' | 'out_of_range'; message: string } {
  const parts = text
    .trim()
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (parts.length === 0) return { ok: true, value: null };
  const out: number[] = [];
  for (const part of parts) {
    const r = pctFromString(part, part);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return { ok: true, value: out };
}

function civilDay(y: number, m: number, d: number): string | null {
  const iso = `${pad4(y)}-${pad2(m)}-${pad2(d)}`;
  return y >= 1900 && isIsoDay(iso) ? iso : null;
}

function coerceDay(raw: RawCell, display: string): CoerceResult {
  const bad = fail('invalid_day', `"${display}" não é uma data válida; use o formato dd/mm/aaaa.`);
  const v = raw.value;
  let day: string | null = null;
  if (v instanceof Date) {
    if (!Number.isNaN(v.getTime())) day = civilDay(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  } else if (typeof v === 'number') {
    const k = Math.floor(v);
    if (Number.isFinite(v) && k >= 61 && k <= 2958465) {
      const d = new Date(Date.UTC(1899, 11, 30 + k));
      day = civilDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  } else if (typeof v === 'string') {
    const s = v.trim();
    const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (br) day = civilDay(Number(br[3]), Number(br[2]), Number(br[1]));
    else if (iso) day = civilDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  return day === null ? bad : ok(day);
}

function joinOptions(labels: string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} ou ${labels[labels.length - 1]}`;
}

function coerceEnum(options: readonly { label: string; value: string }[], raw: RawCell, display: string): CoerceResult {
  const v = raw.value;
  if (v !== null && !(v instanceof Date)) {
    const s = normalizeLabel(String(v));
    const hit = options.find((o) => normalizeLabel(o.label) === s || normalizeLabel(o.value) === s);
    if (hit) return ok(hit.value);
  }
  return fail(
    'invalid_option',
    `"${display}" não é uma opção válida; use ${joinOptions(options.map((o) => o.label))}.`,
  );
}

const TRUE_WORDS = new Set(['sim', 's', 'x', 'true', 'verdadeiro', '1', 'yes']);
const FALSE_WORDS = new Set(['nao', 'n', 'false', 'falso', '0', 'no']);

function coerceBool(raw: RawCell, display: string): CoerceResult {
  const v = raw.value;
  if (typeof v === 'boolean') return ok(v);
  if (typeof v === 'number') {
    if (v === 1) return ok(true);
    if (v === 0) return ok(false);
  } else if (typeof v === 'string') {
    const s = normalizeLabel(v);
    if (TRUE_WORDS.has(s)) return ok(true);
    if (FALSE_WORDS.has(s)) return ok(false);
  }
  return fail('invalid_bool', `"${display}" não é Sim ou Não.`);
}

function coerceText(max: number, raw: RawCell, display: string): CoerceResult {
  const v = raw.value;
  if (v instanceof Date) {
    return fail(
      'date_in_text_column',
      `O Excel transformou "${display}" em data; formate a coluna como texto e digite o valor de novo.`,
    );
  }
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : display;
  const len = [...s].length;
  if (len > max) return fail('too_long', `O texto tem ${len} caracteres; o limite é ${max}.`);
  return ok(s);
}

function coerceList(max: number, raw: RawCell, display: string): CoerceResult {
  const v = raw.value;
  if (typeof v !== 'string' && typeof v !== 'number') {
    return fail('invalid_text', `"${display}" não é uma lista de nomes.`);
  }
  const seen = new Set<string>();
  const items: string[] = [];
  for (const part of String(v).split(/[;,]/)) {
    const item = part.trim();
    if (item === '') continue;
    const key = normalizeLabel(item);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  for (const item of items) {
    const len = [...item].length;
    if (len > 200) return fail('too_long', `O texto tem ${len} caracteres; o limite é 200.`);
  }
  if (items.length === 0) return ok(null);
  if (items.length > max) return fail('too_many_items', `A lista tem ${items.length} nomes; o limite é ${max}.`);
  return ok(items);
}

export function coerceCell(kind: CellKind, raw: RawCell): CoerceResult {
  const display = displayRaw(raw);
  if (raw.problem === 'formula_without_result') {
    return fail(
      'formula_without_result',
      'A célula tem uma fórmula sem valor calculado; abra o arquivo no Excel, salve e envie de novo.',
    );
  }
  if (raw.problem === 'cell_error') {
    return fail('cell_error', `A célula contém um erro do Excel (${display}).`);
  }
  if (isBlankRaw(raw)) return ok(null);
  switch (kind.type) {
    case 'text':
      return coerceText(kind.max, raw, display);
    case 'money':
      return coerceMoney(raw, display);
    case 'int':
      return coerceInt(kind, raw, display);
    case 'pct':
      return coercePct(raw, display);
    case 'day':
      return coerceDay(raw, display);
    case 'enum':
      return coerceEnum(kind.options, raw, display);
    case 'bool':
      return coerceBool(raw, display);
    case 'list':
      return coerceList(kind.max, raw, display);
  }
}
