import fs from 'node:fs';
import path from 'node:path';

export interface Violation {
  rule: string;
  excerpt: string;
}

export interface FileViolation extends Violation {
  file: string;
}

/**
 * Removes comments and neutralises string/identifier contents so keywords inside
 * them never match. Single-quoted literals (with `''` escapes) become `''`,
 * double-quoted identifiers become `"x"`.
 */
export function sanitizeSql(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      out += ' ';
      continue;
    }
    if (ch === "'") {
      i += 1;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      out += "''";
      continue;
    }
    if (ch === '"') {
      i += 1;
      while (i < n && sql[i] !== '"') i += 1;
      i += 1;
      out += '"x"';
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const IDENT = '(?:"x"|[A-Za-z_]\\w*)';

/**
 * Forbidden in every migration after the single-role cut-off. `ON DELETE
 * RESTRICT|CASCADE` is NOT matched: it removes no data by itself, and the
 * CASCADE ban on history FKs is enforced by review.
 */
export const FORBIDDEN_RULES: readonly { rule: string; pattern: RegExp }[] = [
  { rule: 'DROP', pattern: /\bDROP\b/i },
  { rule: 'DELETE FROM', pattern: /\bDELETE\s+FROM\b/i },
  { rule: 'TRUNCATE', pattern: /\bTRUNCATE\b/i },
  { rule: 'RENAME', pattern: /\bRENAME\b/i },
  {
    rule: 'ALTER COLUMN TYPE',
    pattern: new RegExp(`\\bALTER\\s+(?:COLUMN\\s+)?${IDENT}\\s+(?:SET\\s+DATA\\s+)?TYPE\\b`, 'i'),
  },
  { rule: 'GRANT', pattern: /\bGRANT\b/i },
  { rule: 'REVOKE', pattern: /\bREVOKE\b/i },
  { rule: 'CREATE ROLE', pattern: /\bCREATE\s+(?:ROLE|USER)\b/i },
  { rule: 'ALTER ROLE', pattern: /\bALTER\s+(?:ROLE|USER)\b/i },
  { rule: 'BYPASSRLS', pattern: /\bBYPASSRLS\b/i },
];

export function scanSql(sql: string): Violation[] {
  const clean = sanitizeSql(sql);
  const found: Violation[] = [];
  for (const { rule, pattern } of FORBIDDEN_RULES) {
    const m = pattern.exec(clean);
    if (m) {
      found.push({
        rule,
        excerpt: clean.slice(Math.max(0, m.index - 20), m.index + 60).replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return found;
}

export function migrationNumber(fileName: string): number | null {
  const m = /^(\d{4})_.*\.sql$/.exec(fileName);
  return m ? Number(m[1]) : null;
}

/** Scans every migration whose number is strictly greater than `after`. Throws when the folder is missing. */
export function scanMigrationDir(dir: string, after: number): { scanned: string[]; violations: FileViolation[] } {
  if (!fs.existsSync(dir)) throw new Error(`migration folder not found: ${dir}`);
  const scanned: string[] = [];
  const violations: FileViolation[] = [];
  for (const file of fs.readdirSync(dir).sort()) {
    const n = migrationNumber(file);
    if (n === null || n <= after) continue;
    scanned.push(file);
    for (const v of scanSql(fs.readFileSync(path.join(dir, file), 'utf8'))) {
      violations.push({ file, ...v });
    }
  }
  return { scanned, violations };
}
