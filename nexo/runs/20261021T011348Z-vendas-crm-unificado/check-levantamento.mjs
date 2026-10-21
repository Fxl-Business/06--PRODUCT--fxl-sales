#!/usr/bin/env node
// Oracle for slice 04-levantamento-entidades.
// usage: node check-levantamento.mjs --doc <levantamento-entidades.md> [--root <repo>] [--fix] [--git-base <ref>] [--self <this script repo path>]
// Exit 0 only when every citation resolves and the document structure is complete.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const root = path.resolve(opt('--root', process.cwd()));
const docPath = path.resolve(opt('--doc', ''));
const FIX = argv.includes('--fix');
const gitBase = opt('--git-base', null);
const SAMPLE = Number(opt('--sample', '0'));
const selfRel = opt('--self', null);
if (!fs.existsSync(docPath)) {
  console.error(`FAIL document not found: ${docPath}`);
  process.exit(1);
}

const failures = [];
const fail = (msg) => failures.push(msg);
let docLines = fs.readFileSync(docPath, 'utf8').split('\n');

// ---------- 1. citations ----------
const CITE = /\[([^\]]+)\]\(([A-Za-z0-9_./@-]+):(\d+)\)/g;
const fileCache = new Map();
const readLines = (rel) => {
  if (!fileCache.has(rel)) {
    const abs = path.join(root, rel);
    fileCache.set(rel, fs.existsSync(abs) && fs.statSync(abs).isFile() ? fs.readFileSync(abs, 'utf8').split('\n') : null);
  }
  return fileCache.get(rel);
};
const norm = (s) => s.replaceAll('`', '');
let total = 0;
const unique = new Set();
const fixed = [];
const citationsByLine = []; // [{docLine, path, line, text}]
docLines = docLines.map((raw, idx) =>
  raw.replace(CITE, (whole, text, rel, lineStr) => {
    total += 1;
    let line = Number(lineStr);
    const lines = readLines(rel);
    if (!lines) {
      fail(`doc:${idx + 1} file missing: ${rel}`);
      return whole;
    }
    const needle = norm(text);
    const ok = (n) => n >= 1 && n <= lines.length && norm(lines[n - 1]).includes(needle);
    if (!ok(line)) {
      let best = -1;
      for (let i = 0; i < lines.length; i++) {
        if (norm(lines[i]).includes(needle) && (best < 0 || Math.abs(i + 1 - line) < Math.abs(best - line))) best = i + 1;
      }
      if (best < 0) {
        fail(`doc:${idx + 1} identifier not found anywhere: "${needle}" in ${rel}`);
        return whole;
      }
      if (!FIX) {
        fail(`doc:${idx + 1} ${rel}:${line} does not contain "${needle}" (nearest: ${best})`);
        return whole;
      }
      fixed.push(`doc:${idx + 1} ${rel}:${line} -> ${best}`);
      line = best;
    }
    unique.add(`${rel}:${line}`);
    citationsByLine.push({ docLine: idx + 1, rel, line, text: needle });
    return `[${text}](${rel}:${line})`;
  }),
);
if (FIX && fixed.length) {
  fs.writeFileSync(docPath, docLines.join('\n'));
  console.log(`FIXED ${fixed.length} line numbers:\n  ${fixed.join('\n  ')}`);
}

// every `](path:line)` in the document must have been parsed as a citation (a `]` inside the link text would hide it)
const rawCount = (docLines.join('\n').match(/\]\([A-Za-z0-9_./@-]+:\d+\)/g) ?? []).length;
if (rawCount !== total) fail(`unparsed citations: ${rawCount} link targets of the form (path:line) but only ${total} parsed (a link text contains "]")`);

// ---------- 2. structure ----------
const text = docLines.join('\n');
if (text.includes(String.fromCharCode(0x2014))) fail('document contains an em dash');
if (/EXECUTOR-TODO/.test(text)) fail('document still contains EXECUTOR-TODO markers (replace each one, see the slice plan step 5)');
const H = (re) => docLines.findIndex((l) => re.test(l));
const REQUIRED_H2 = [/^## 1\. Resumo de riscos/, /^## 2\. Legenda/, /^## 3\. Entidades/, /^## 4\. Pendências de risco alto/, /^## 5\. Restrições para o modelo \(1b\)/, /^## 6\. Perguntas abertas/];
for (const re of REQUIRED_H2) if (H(re) < 0) fail(`missing heading ${re}`);
for (const n of ['5.1', '5.2', '5.3', '5.4']) if (H(new RegExp(`^### ${n} `)) < 0) fail(`missing heading ### ${n}`);

const section = (startRe) => {
  const s = H(startRe);
  if (s < 0) return { s: -1, e: -1, lines: [] };
  let e = docLines.length;
  const level = docLines[s].match(/^#+/)[0].length;
  for (let i = s + 1; i < docLines.length; i++) {
    const m = docLines[i].match(/^(#+) /);
    if (m && m[1].length <= level) {
      e = i;
      break;
    }
  }
  return { s, e, lines: docLines.slice(s, e) };
};

const SUBS = ['Onde vive hoje', 'Schema Drizzle', 'API', 'Web', 'Eventos e outbox', 'RLS', 'Testes', 'O que quebra se virar campo dinâmico', 'Recomendação', 'Risco'];
const RISKS = ['alto', 'médio', 'baixo'];
const entityRisk = {};
const MIN_CITATIONS = 6;
for (let n = 1; n <= 13; n++) {
  const sec = section(new RegExp(`^### 3\\.${n} `));
  if (sec.s < 0) {
    fail(`missing entity section 3.${n}`);
    continue;
  }
  const subIdx = [];
  let cursor = 0;
  for (const sub of SUBS) {
    const i = sec.lines.findIndex((l, k) => k >= cursor && l.trim() === `#### ${sub}`);
    if (i < 0) {
      fail(`3.${n} missing or out-of-order sub-heading "#### ${sub}"`);
      continue;
    }
    subIdx.push([sub, i]);
    cursor = i + 1;
  }
  subIdx.forEach(([sub, i], k) => {
    const end = k + 1 < subIdx.length ? subIdx[k + 1][1] : sec.lines.length;
    const body = sec.lines.slice(i + 1, end).filter((l) => l.trim() !== '' && !l.startsWith('#'));
    if (body.length === 0) fail(`3.${n} "${sub}" is empty`);
    if (sub === 'Testes' && !body.some((l) => new RegExp(CITE.source).test(l))) fail(`3.${n} "Testes" has no citation`);
    if (sub === 'Risco') {
      const found = RISKS.filter((r) => body.join(' ').includes(`**${r}**`));
      if (found.length !== 1) fail(`3.${n} "Risco" must contain exactly one of **alto**, **médio**, **baixo** (found ${found.join(',') || 'none'})`);
      else entityRisk[n] = found[0];
    }
  });
  const count = citationsByLine.filter((c) => c.docLine > sec.s && c.docLine <= sec.e).length;
  if (count < MIN_CITATIONS) fail(`3.${n} has only ${count} citations (min ${MIN_CITATIONS})`);
}

// summary table
const sum = section(/^## 1\. Resumo de riscos/);
const rows = sum.lines.filter((l) => /^\| \d+ \|/.test(l)).map((l) => l.split('|').map((c) => c.trim()));
if (rows.length !== 13) fail(`summary table must have 13 rows, has ${rows.length}`);
const tableRisk = {};
for (const r of rows) {
  const n = Number(r[1]);
  tableRisk[n] = r[4];
  if (!RISKS.includes(r[4])) fail(`summary row ${n} risk "${r[4]}" is not alto/médio/baixo`);
  if (entityRisk[n] && entityRisk[n] !== r[4]) fail(`summary row ${n} says ${r[4]} but section 3.${n} says ${entityRisk[n]}`);
}
for (const n of [2, 10]) if (tableRisk[n] !== 'alto' || entityRisk[n] !== 'alto') fail(`entity ${n} MUST be classified alto (fixed by definition)`);

// required content
const has = (re, where, label) => { if (!re.test(where)) fail(`missing required content: ${label}`); };
const s310 = section(/^### 3\.10 /).lines.join('\n');
for (const ev of ['fxl-sales.obligation.upserted', 'fxl-sales.settlement.recorded', 'fxl-sales.settlement.reversed']) has(new RegExp(ev.replaceAll('.', '\\.')), s310, `3.10 mentions ${ev}`);
has(/FXS01/, s310, '3.10 FXS01');
has(/FXS02/, s310, '3.10 FXS02');
const s51 = section(/^### 5\.1 /).lines.join('\n');
for (const id of ['sales_ops_lead_stages_org_kind_idx', 'sales_ops_lead_stages_system_kind_check', 'sales_ops_lead_stages_kind_check', 'sales_ops_leads_org_stage_fk']) has(new RegExp(id), s51, `5.1 mentions ${id}`);
const s4 = section(/^## 4\. /).lines.join('\n');
for (const p of ['P1', 'P2', 'P3']) has(new RegExp(`\\| ${p} \\|`), s4, `section 4 row ${p}`);
has(/`leads`/, s4, 'section 4 names legacy leads');
has(/sales_ops_settlements/, s4, 'section 4 names sales_ops_settlements');

// ---------- 3. reader completeness (5.2 kind, 5.3 stage_id) ----------
const walk = (dir, out = []) => {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '__tests__', '.git', 'coverage'].includes(e.name)) continue;
      walk(rel, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) && !/\.bak/.test(e.name)) out.push(rel);
  }
  return out;
};
const codeLines = (rel) => (readLines(rel) ?? []).filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
const prod = ['apps/api/src', 'apps/api/scripts', 'apps/web/src'].flatMap((d) => walk(d));
const KIND_RE = /salesOpsLeadStages\.kind|\bstage\??\.kind\b|\bdestination\.kind\b|KIND_COLORS|\b(?:s|row|stage)\.kind (?:===|!==) '(?:normal|conversion|lost)'|kind: 'normal' \| 'conversion' \| 'lost'|LeadStageKind|\bseed\.kind\b/;
const SID_RE = /\bstageId\b|\bstage_id\b/;
const kindFiles = prod.filter((f) => codeLines(f).some((l) => KIND_RE.test(l)));
const sidFiles = prod.filter((f) => /sales-ops|domains\/import|apps\/api\/scripts/.test(f) && codeLines(f).some((l) => SID_RE.test(l)));
const citedIn = (secRe) => {
  const sec = section(secRe);
  return new Set(citationsByLine.filter((c) => c.docLine > sec.s && c.docLine <= sec.e).map((c) => c.rel));
};
const c52 = citedIn(/^### 5\.2 /);
const c53 = citedIn(/^### 5\.3 /);
for (const f of kindFiles) if (!c52.has(f)) fail(`5.2 does not cite reader of stage kind: ${f}`);
for (const f of sidFiles) if (!c53.has(f)) fail(`5.3 does not cite reader of stage_id: ${f}`);

// ---------- 4. git: nothing but the document (and this script) changed ----------
if (gitBase) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const changed = new Set([...git('diff', '--name-only', gitBase), ...git('ls-files', '--others', '--exclude-standard'), ...git('diff', '--name-only')]);
  const allowed = new Set([path.relative(root, docPath), ...(selfRel ? [selfRel] : [])]);
  for (const f of changed) if (!allowed.has(f)) fail(`product or unexpected file changed: ${f}`);
}

// ---------- sample (human spot check) ----------
if (SAMPLE > 0) {
  const pool = [...citationsByLine].sort(() => Math.random() - 0.5).slice(0, SAMPLE);
  for (const c of pool) console.log(`sample ${c.rel}:${c.line} | ${(readLines(c.rel)[c.line - 1] ?? '').trim().slice(0, 100)}`);
}

// ---------- report ----------
console.log(`citations: ${total} total, ${unique.size} unique, entities classified: ${JSON.stringify(entityRisk)}`);
console.log(`stage-kind reader files: ${kindFiles.length}, stage_id reader files: ${sidFiles.length}`);
if (failures.length) {
  console.error(`FAIL (${failures.length})\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('PASS');
