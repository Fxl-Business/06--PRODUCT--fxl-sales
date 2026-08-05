# Run: v2.4.0 release blocker repair

- Milestone: `v2.4.0`
- Mode: `autopilot`
- Design: `nexo/plans/20260805-release-blocker-repair/00-DESIGN.md`
- Failed release evidence: `nexo/runs/20260805-ship-v2.4.0/release-verify.md`

## Queue

| Slice | Intent | Status |
|---|---|---|
| `01-session-refresh-serialization` | Serialize durable refreshes across replicas. | todo |
| `02-professional-payable-identity` | Persist and use sale-professional identity on payables. | todo |
| `03-dependency-audit-remediation` | Remove all high-severity dependency findings. | todo |
| `04-generated-diff-hygiene` | Keep generated context packs out of false whitespace failures. | todo |

## Gate 1

Skipped because the user approved the written design and explicitly selected `--auto` on 2026-08-05.

## Slice log

Planning and execution evidence will be appended here as each slice completes.
