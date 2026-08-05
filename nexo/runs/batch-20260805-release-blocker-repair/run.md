# Run: v2.4.0 release blocker repair

- Milestone: `v2.4.0`
- Mode: `autopilot`
- Design: `nexo/plans/20260805-release-blocker-repair/00-DESIGN.md`
- Failed release evidence: `nexo/runs/20260805-ship-v2.4.0/release-verify.md`

## Queue

| Slice | Intent | Status |
|---|---|---|
| `01-session-refresh-serialization` | Serialize durable refreshes across replicas. | done |
| `02-professional-payable-identity` | Persist and use sale-professional identity on payables. | done |
| `03-dependency-audit-remediation` | Remove all high-severity dependency findings. | done |
| `04-generated-diff-hygiene` | Keep generated context packs out of false whitespace failures. | done |
| `05-legacy-professional-one-shot-reconciliation` | Preserve paid v2.3.1 one-shot professional costs across upgrade and re-win. | done |
| `06-phased-professional-identity-migration` | Apply migration 0018 without holding the initial table lock through long work. | done |
| `07-capture-professional-payable-guidance` | Align standing guidance and backlog with verified behavior. | done |

## Gate 1

Skipped because the user approved the written design and explicitly selected `--auto` on 2026-08-05.

## Slice log

- `04-generated-diff-hygiene`: review clean and Gate 2 PASS at `5edc086`.
- `03-dependency-audit-remediation`: review clean and Gate 2 PASS at `127cd40`.
- `01-session-refresh-serialization`: review clean after follow-up and Gate 2 PASS at `69b355c`.
- `02-professional-payable-identity`: review clean after follow-up and Gate 2 PASS at `8ac14bc`.
- `06-phased-professional-identity-migration`: review clean after follow-up and Gate 2 PASS at `00d8385`.
- `05-legacy-professional-one-shot-reconciliation`: review clean and Gate 2 PASS at `93950c6`.
- `07-capture-professional-payable-guidance`: standing guidance and roadmap aligned with the verified implementation.
