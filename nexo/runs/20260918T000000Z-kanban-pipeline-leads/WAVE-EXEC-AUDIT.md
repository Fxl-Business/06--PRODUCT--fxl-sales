
## Culprit parked — 2026-09-19T02:30:25Z
- Wave-verify failed in serial re-run
- Culprit: 06-web-kanban-board (branch: feat/20260918-06-web-kanban-board)
- Status: parked — NOT merged to main
- Action: re-run on feat/20260918-06-web-kanban-board after fixing the failing test; re-merge manually

## RESOLVIDO - 2026-09-19, pelo orquestrador do run 20260918T000000Z-kanban-pipeline-leads

A entrada acima foi escrita corretamente pelo `nexo-wave-exec.sh` com a evidência que ele tinha, e
está OBSOLETA. A slice `06-web-kanban-board` NÃO tinha defeito e ESTÁ mergeada em `master`
(reaplicada em `ce12b96`, append-only, por `git revert` do revert).

Causa real: o `--wave-verify` deste run rodava a suíte no checkout principal SEM `pnpm install`. A
slice 06 adiciona `@dnd-kit` ao `package.json`, e `git merge` não materializa dependência nova, então
no trunk integrado todo import falhava em resolver. O culpado era o GATE, não a slice.

Consertos: o gate passou a rodar `pnpm install --frozen-lockfile` e `build:packages` antes de tudo, e
a escrever log POR INVOCAÇÃO (o anterior truncava a cada chamada, então a execução que falhou era
sobrescrita pela execução de recuperação que passou - foi isso que tornou o diagnóstico difícil).

No caminho ainda apareceu um flake REAL, independente disso, em
`stage_changed_at advances when and only when stage_id actually changes`, que falhava em 2 de 5
execuções desde a wave 3. Consertado em `7650e44`.

Registro completo: `nexo/runs/20260918T000000Z-kanban-pipeline-leads/AUDIT.md` e `run.md`.
