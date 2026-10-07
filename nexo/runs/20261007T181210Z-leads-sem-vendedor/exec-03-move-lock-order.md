# Exec 03-move-lock-order

- Red (before service change): 4 failed | 1 passed. Cases 1 and 2: the write was rejected: 40P01; case 4: duplicate position (Segundo 2 / Primeiro 2); case 5: gap in column; case 3 passed.
- Green: oracle 5 passed (5) on 3 consecutive runs.
- Regression integration (8 files): 94 passed. Unit (leads + import): 19 files, 301 passed.
- tsc --noEmit (src and tsconfig.test.json) clean; eslint --max-warnings=0 on both files clean; no diff in drizzle or src/db.
- Commit: b6066dd
- Deviations: none.
