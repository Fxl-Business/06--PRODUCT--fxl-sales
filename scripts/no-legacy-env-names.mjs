import { spawnSync } from 'node:child_process';

/**
 * Fails when a RETIRED environment variable name reappears in a tracked file.
 *
 * Modelled on `scripts/no-legacy-auth.mjs`, and wired into the root `test`
 * script beside it. Every entry here is a name this repo used to own and has
 * since renamed; the rename's whole point is that the old spelling now means
 * something else (or means nothing), so a straggler is a live defect rather
 * than untidiness.
 *
 * Spelled by CHARACTER CODE, exactly as the sibling guard spells its own
 * literal: written out, the name would be found by the very grep it defines and
 * the gate could never pass.
 */
const retired = [
  {
    // The v3.1.0 session-sealer rename. Its old spelling cannot be written here
    // for the reason stated above, so read it off the character codes.
    name: String.fromCharCode(
      72, 85, 66, 95, 83, 69, 83, 83, 73, 79, 78, 95, 69, 78, 67, 82, 89, 80, 84, 73, 79, 78, 95,
      75, 69, 89,
    ),
    replacement: 'SALES_SESSION_ENCRYPTION_IKM',
  },
];

/**
 * `nexo/` is the append-only delivery record and `CLAUDE.md` is the prose
 * record; both legitimately NAME a retired variable when they describe what was
 * renamed and why, and rewriting either to dodge a grep would falsify evidence.
 * This is the same pathspec, and the same reasoning, as `no-legacy-auth.mjs`.
 */
const PATHSPEC = ['.', ':(exclude)nexo', ':(exclude)CLAUDE.md'];

/**
 * `-w` and not a plain substring match. The retired session name is a strict
 * SUFFIX of the SDK's canonical `FXL_HUB_SESSION_ENCRYPTION_KEY`, which is a
 * real name this repo may legitimately mention once 2.3.0 lands. `_` is a word
 * character, so `-w` refuses that longer name while still matching the retired
 * one wherever it stands on its own - `env.X`, `X=`, `stubEnv('X', ...)`.
 */
let failed = false;

for (const { name, replacement } of retired) {
  const result = spawnSync('git', ['grep', '-n', '-w', '-i', '--', name, '--', ...PATHSPEC], {
    encoding: 'utf8',
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  // 1 is "no match", which is the passing case. Anything above 1 is git itself
  // failing, and must not read as a clean gate.
  if (result.status === 1) {
    continue;
  }

  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(1);
  }

  failed = true;
  process.stderr.write(`Retired env name found. Use ${replacement} instead:\n`);
  process.stderr.write(result.stdout);
}

process.exit(failed ? 1 : 0);
