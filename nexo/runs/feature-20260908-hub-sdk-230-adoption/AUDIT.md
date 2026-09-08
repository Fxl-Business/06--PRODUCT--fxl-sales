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
