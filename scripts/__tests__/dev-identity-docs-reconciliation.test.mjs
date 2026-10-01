import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/**
 * Docs guard for the development identity mode
 * (feature-20260921-dev-fake-identity-switch, slice 07).
 *
 * It asserts ONE mechanical invariant and nothing more:
 *
 *   The tree must never simultaneously DO a thing and FORBID it without saying
 *   the prohibition was superseded.
 *
 * The parked plan
 * nexo/plans/feature-20260827-hub-sdk-210-access-model/05-dev-identity-fixtures.md
 * forbids a runtime development-identity path, and packages/auth-fake is one. So
 * while that package exists, the parked plan must carry its dated supersession
 * note ABOVE the prohibition, and CLAUDE.md must carry the section that describes
 * what exists today.
 *
 * Whether every clause of that CLAUDE.md section is TRUE against the shipped code
 * is a clause-by-clause human or verify-agent reading, and is not automated here.
 *
 * When packages/auth-fake is absent the guard says nothing, because a tree that
 * does not do the thing is free to forbid it, and reverting the feature must not
 * require editing this guard.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MODE_MANIFEST = 'packages/auth-fake/package.json';
const PARKED_PLAN = 'nexo/plans/feature-20260827-hub-sdk-210-access-model/05-dev-identity-fixtures.md';
const CLAUDE_FILE = 'CLAUDE.md';

const SENTINEL = 'SUPERSEDED IN PART - 2026-09-21 - the prohibition only.';
const PROHIBITION = 'No `createDevHubClient`, ever';
const CLAUDE_HEADING = '## Development identity mode';

/** Pure classifier: no I/O. One line per violation, `[]` when the tree is consistent. */
function reconciliationViolations({ modeExists, planText, claudeText }) {
  if (!modeExists) return [];
  const violations = [];
  const sentinelAt = planText.indexOf(SENTINEL);
  const prohibitionAt = planText.indexOf(PROHIBITION);
  if (sentinelAt === -1) {
    violations.push(`${PARKED_PLAN} forbids what ${MODE_MANIFEST} does and lacks "${SENTINEL}"`);
  }
  if (!(sentinelAt !== -1 && (prohibitionAt === -1 || sentinelAt < prohibitionAt))) {
    violations.push(
      `${PARKED_PLAN}: the supersession note must sit ABOVE the first "${PROHIBITION}"`,
    );
  }
  if (!claudeText.includes(CLAUDE_HEADING)) {
    violations.push(`${CLAUDE_FILE} lacks the "${CLAUDE_HEADING}" section`);
  }
  return violations;
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

const PROHIBITION_ONLY_PLAN = ['---', 'status: parked', '---', '', '# 05', '', `### 1. ${PROHIBITION}`, '', 'Never.'].join('\n');

test('D1 passes against the tree as shipped', () => {
  const modeExists = fs.existsSync(path.join(ROOT, MODE_MANIFEST));
  // Vacuity guard: the mode is in the tree today, so D1 exercises the real checks.
  assert.equal(modeExists, true, `${MODE_MANIFEST} is expected in the tree`);
  assert.deepEqual(
    reconciliationViolations({
      modeExists,
      planText: read(PARKED_PLAN),
      claudeText: read(CLAUDE_FILE),
    }),
    [],
  );
});

test('D2 flags a tree that still forbids what it does', () => {
  const violations = reconciliationViolations({
    modeExists: true,
    planText: PROHIBITION_ONLY_PLAN,
    claudeText: `# CLAUDE.md\n\n${CLAUDE_HEADING}\n`,
  });
  assert.ok(violations.length > 0);
  assert.ok(violations.some((line) => line.includes(PARKED_PLAN)), violations.join('\n'));
});

test('D3 flags a supersession note that sits below the prohibition it supersedes', () => {
  const planText = `${PROHIBITION_ONLY_PLAN}\n\n> **${SENTINEL}**\n`;
  // A plain substring check passes this text; only the ordering check catches it.
  assert.ok(planText.includes(SENTINEL));
  const violations = reconciliationViolations({
    modeExists: true,
    planText,
    claudeText: `${CLAUDE_HEADING}\n`,
  });
  assert.equal(violations.length, 1, violations.join('\n'));
  assert.match(violations[0], /ABOVE/);
});

test('D4 says nothing about a tree that has no development identity mode', () => {
  assert.deepEqual(reconciliationViolations({ modeExists: false, planText: '', claudeText: '' }), []);
});

test('flags a CLAUDE.md without the development identity mode section', () => {
  const violations = reconciliationViolations({
    modeExists: true,
    planText: `> **${SENTINEL}**\n\n### 1. ${PROHIBITION}\n`,
    claudeText: '# CLAUDE.md\n',
  });
  assert.equal(violations.length, 1, violations.join('\n'));
  assert.ok(violations[0].includes(CLAUDE_FILE));
});
