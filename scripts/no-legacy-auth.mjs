import { spawnSync } from 'node:child_process';

const banned = String.fromCharCode(99, 108, 101, 114, 107);
// The gate asks "was the removed auth provider REINTRODUCED", which is a question about
// source, configuration and dependencies. `nexo/` is the append-only delivery record and
// `CLAUDE.md` is the prose record; both legitimately NAME the removed provider when they
// describe what was taken out, and rewriting either to dodge a grep would falsify evidence.
// Everything that can actually reintroduce it - apps/, packages/, scripts/, lockfiles and
// every .env example - stays inside the gate.
const result = spawnSync(
  'git',
  ['grep', '-n', '-i', '--', banned, '--', '.', ':(exclude)nexo', ':(exclude)CLAUDE.md'],
  {
    encoding: 'utf8',
  },
);

if (result.status === 1) {
  process.exit(0);
}

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.stderr.write(result.stdout);
process.exit(1);
