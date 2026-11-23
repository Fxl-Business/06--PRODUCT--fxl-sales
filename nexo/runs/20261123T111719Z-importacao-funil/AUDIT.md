# AUDIT importacao-funil

- Codex (Test Author and Reviewer) was out of usage until 14:01 (local) at 08:25. The owner's rule is "Codex reviews and authors tests when available", so the blind tests and the Verify of every slice run on separate Sonnet agents instead of parking on `cross-check-unavailable`.
- The Builder of every slice is a host Sonnet sub-agent, because the owner's rule names Sonnet for building and the `nexo-agent.py` policy resolves `model: inherit`.
- Slice 01 touches more than 8 files: it is one cohesive contract change of the import planner and cannot be split without a red intermediate state.
