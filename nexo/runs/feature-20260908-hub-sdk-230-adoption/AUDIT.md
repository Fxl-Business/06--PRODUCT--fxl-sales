# Audit - run feature-20260908-hub-sdk-230-adoption

Operator items raised by this run.
Started by slice 06; the Capture step appends to this file rather than replacing it.

## DO before the next deploy of this repo

- [ ] **Set `FXL_HUB_TRUSTED_ORIGINS` in staging and in production.**
      This is a PROMOTION gate and not a `.env` matter, so nothing in the repository can do it.
      Slice 05 moved `trustedOrigins` off `env.CORS_ORIGIN` and onto the SDK's canonical
      `FXL_HUB_TRUSTED_ORIGINS`, resolved by `loadHubConfig`.
      Unset, the list is `[]`.
      In both deployed environments the web app is on `sales.fxlbusiness.com` and the API on
      `sales-api.fxlbusiness.com`, so the BFF's own-origin computation alone does not admit the
      browser's POST, and every POST to `/auth/*` is answered `403 origin_not_trusted`.
      That is the 2026-08-10 cross-origin outage, exactly.
      The value is the WEB origin, comma-separated if there is more than one:
      `https://sales.fxlbusiness.com` in production, and the staging web origin in staging.
      Local development is unaffected and needs nothing: vite proxies `/auth` with
      `changeOrigin: false`, so the request origin already equals the BFF's own computed origin and
      the POST is admitted with the variable unset.
      Verified against the shipped `dist`, not assumed.

- [ ] **Confirm `FXL_HUB_REDIRECT_URI` is set in staging and in production.**
      Not a presence rule, which is why this reads as a confirmation rather than a rename.
      An absent value is not left absent: the SDK's `parseRedirectUri` defaults it to
      `${FXL_HUB_API_URL}/auth/callback`, which is the HUB's own origin, and outside development
      `assertBootConfiguration` refuses any effective value whose origin equals `apiUrl`'s.
      So an unset variable there is a hard BOOT FAILURE - loud, not silent - but it fails because of
      where the default landed, not because the variable was missing.
      Each environment's value is that environment's own web origin plus `/auth/callback`, and it
      must match a `redirect_uri` registered on the Client byte for byte.

## Accepted regression, recorded rather than left to be found

- **Deleting `nameDiscreteVar` costs one diagnostic.**
  The SDK's `operationalMessage` names the discrete variable for the four OPERATIONAL fields, but
  the five IDENTITY fields still format as `FXL_HUB_CONFIG.<field>`.
  An operator configuring this app with the five discrete variables who misconfigures one is
  therefore pointed at a variable they never set.
  Taken knowingly, to keep exactly one resolver rather than one hand-maintained mapping standing
  between this repo and a contract the SDK now publishes.
  Reported upstream as 2.4.0 feedback.

## Appended at Capture

### The variable VALUES that must be carried across, not just the names

The prep run renamed three variables out of the `FXL_HUB_` namespace. Names must exist under their
new spelling BEFORE the deploy that reads them, and where a value exists today it must be copied
byte-for-byte. Create the new name ALONGSIDE the old rather than renaming in place, so a revert
inside the rollback window still finds its value.

- [ ] `HUB_SESSION_ENCRYPTION_KEY` -> `SALES_SESSION_ENCRYPTION_IKM`.
      HIGHEST DATA RISK. It is the HKDF input for the BFF session sealer. Miss it and the sealer
      silently derives from `FXL_HUB_CLIENT_SECRET` instead, every `hub_bff_sessions` seal stops
      opening, and every user is logged out once. Nothing throws and nothing logs a warning; an
      unopenable seal reports ABSENT by design. Self-healing after one re-login.
      If it is blank in an environment today there is nothing to carry and the rename is free -
      CONFIRM per environment rather than assuming. This run could not read Infisical.
- [ ] `FXL_HUB_POST_LOGIN_REDIRECT` -> `SALES_POST_LOGIN_REDIRECT`
- [ ] `FXL_HUB_POST_LOGIN_ERROR_REDIRECT` -> `SALES_POST_LOGIN_ERROR_REDIRECT`
      Both optional. A miss is quiet: no crash, no log, post-login just lands on `CORS_ORIGIN`
      instead of the configured destination. Has to be checked rather than noticed.

### `FXL_HUB_REDIRECT_URI` must be explicit in every non-development environment

Not because it is a presence rule - it is NOT, and that wording must not enter the runbook. An
absent value takes the SDK's default `${apiUrl}/auth/callback`, which is the HUB's origin, and the
boot then refuses it because the callback's ORIGIN equals the Hub's. The failure is loud and the
message says so. Set it to the exact URI registered on the Client, byte for byte.

### DEVELOPER item, immediate, and it will bite on this machine first

- [ ] **`apps/api/.env` on this machine is pre-2.2.0** - it carries `FXL_HUB_PUBLISHABLE_KEY` and
      `FXL_HUB_SECRET_KEY`, names that no longer exist, alongside a set `FXL_HUB_API_URL`. Under the
      new contract that is a PARTIAL configuration, which is now a boot failure, so `pnpm dev` for
      the API will refuse to start until the file is migrated to the five canonical names.
      This is the intended behaviour change working, not a defect. The wave-verify deliberately did
      not modify the file, because it is untracked and it is yours.
      Either fill in all five canonical identity variables, or blank all five and get the `503`
      door. `apps/api/.env.dev.example` now shows exactly that shape.

## Ready to ship

- [ ] **`/nexo-ship`** - `master` carries ten merged slices across two runs and is green on lint,
      type-check, the full unit suite, a cold real build, both guards and the integration suite.
      Autopilot never ships and Gate 3 is human. Nothing is tagged and nothing is promoted; the last
      release remains v3.0.0. NOTE: shipping is what makes the operator items above load-bearing -
      they are not needed while the code sits on `master`.

## Process gaps in the ADOPTION run, recorded rather than hidden

- [ ] **The first wave-verify dispatch was LOST.** The agent stalled with no progress for 600s and
      never wrote a verdict, yet `agent-wait.sh` still exited 0 - so a stalled dispatch and a green
      one were indistinguishable by exit code alone. The result FILE was absent, which is what
      caught it. It was re-dispatched once to a NEW result path with guidance derived from how it
      died (it hung importing the boot module in-process, which opens a listener and a database
      pool) and passed. Worth knowing: trust the result file, never the exit code, and never the
      task registry.
- [ ] **The orchestrator broke its own concurrency rule twice**, both caught by agents rather than
      by a control: it staged broadly while an executor held the tree, hiding a dependency bump
      inside a `docs(nexo)` commit, and it merged a slice and switched branches while that slice's
      verifier was still running its gates. Neither invalidated a verdict. The durable fix is
      sequencing, not care.
- [ ] **No mutation-testing tool** is configured in this repo, so per-slice mutation batteries stood
      in. Every oracle in this run was proven non-vacuous by mutating the real mechanism and
      observing RED, including from BOTH directions where the assertion had two failure modes.
