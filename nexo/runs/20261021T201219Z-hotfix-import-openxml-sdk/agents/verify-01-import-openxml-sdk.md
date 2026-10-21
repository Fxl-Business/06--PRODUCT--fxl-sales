# Verify 01-import-openxml-sdk: PASS

Commands (all run-once, stdin from /dev/null):
- `pnpm run lint`: exit 0.
- `pnpm run type-check`: exit 0.
- `CI=true pnpm test`: exit 0. auth-fake 2 files/48 tests, shared-utils 9/198, api 109/1609, web 156/1968, node guards 112 pass/0 fail.
- `pnpm run build`: exit 0 (web bundle-clean assertion passed).
- `pnpm install --frozen-lockfile --offline`: exit 0, nothing to change.
- Integration (local Docker DB on 127.0.0.1:5006 up): `pnpm --filter @fxl-sales/api test:integration`: exit 0, 61 files/549 tests (the path filter was not applied, so the whole integration suite ran, including import-routes and executor).

Review:
- jszip pinned exactly `3.10.2` in apps/api/package.json, lockfile consistent. No U+2014 in the diff.
- Zip-bomb: JSZip.loadAsync plus per-part full in-memory decompression of .xml/.rels only, same library exceljs uses; the 5 MB upload cap bounds it. Worst case is about 2x decompression and one recompress when a rewrite is needed. Not a material amplification. Load failure returns input untouched.
- No-rewrite path returns the identical `input` reference (changed flag), so exceljs templates follow the old path.
- Rels: `TargetMode="External"` skipped; relative targets rewritten only when absolute or renamed; internal paths are normalized with posix and only ever re-expressed relative to the source dir. Nothing is read outside the package that exceljs would not already resolve. Minor, non-blocking: a `../` that climbs above root is left as normalize yields, same as before.
- unprefixMainNamespace: skipped when any default `xmlns=` exists, strips only the prefix bound to the main namespace, escapes the prefix. Non-blocking: a bare `\sxmlns="` match inside an attribute value could skip a rewrite (fails safe, unchanged).
- Leia-me one-sentence-per-row rule is enforced by template.test.ts, which passed.
