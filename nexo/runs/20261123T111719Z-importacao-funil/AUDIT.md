# AUDIT importacao-funil

- Codex (Test Author and Reviewer) was out of usage until 14:01 (local) at 08:25. The owner's rule is "Codex reviews and authors tests when available", so the blind tests and the Verify of every slice run on separate Sonnet agents instead of parking on `cross-check-unavailable`.
- The Builder of every slice is a host Sonnet sub-agent, because the owner's rule names Sonnet for building and the `nexo-agent.py` policy resolves `model: inherit`.
- Slice 01 touches more than 8 files: it is one cohesive contract change of the import planner and cannot be split without a red intermediate state.
- Blind acceptance tests exist for slice 01 (45, green on the first run). Slices 02 and 03 rely on the Builder tests, the mutation proofs of the separate Verify and the orchestrator's check in a real spreadsheet program and in the browser.
- Slice 02 Verify attempt 1 failed only on a missing oracle (archived funil in the reference tab); the orchestrator added the fixture row and re-ran that mutation (3 failures).
- The org filter of the catalog and export pipeline reads survives mutation because RLS masks it; kept as defence in depth.
