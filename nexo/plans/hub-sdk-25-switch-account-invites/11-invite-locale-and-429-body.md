---
id: 11-invite-locale-and-429-body
milestone: v4.1.0
status: todo
depends_on: [09-admin-sellers-invite-ui]
files_modified:
  - apps/web/src/admin/sellers/AdminSellersPage.tsx
  - apps/web/src/admin/sellers/hooks/useSellers.ts
  - apps/web/src/lib/api-client.ts
  - apps/web/src/admin/sellers/__tests__/AdminSellersPage.test.tsx
acceptance: "given an admin using the sellers page in pt-BR or en, when they create a seller or resend an invitation, then the request body carries locale equal to the active UI language mapped to 'pt-BR' | 'en' (anything else -> 'pt-BR'); and a resend 429 whose retryAfterSeconds is only in the JSON body (no Retry-After header) still renders the exact wait."
goal: "Close the two non-blocking findings of slice 09's Gate 2: invite emails follow the admin's UI language, and the body-only retryAfterSeconds path is pinned by a test."
verifier_focus: "Locale is derived from i18n.language with a closed mapping, never free text; the server's z.enum(['pt-BR','en']) is respected. The body-only 429 test goes RED when apiFetch's body check is removed."
must_not_break:
  - "Every slice 09 oracle."
rules:
  - "Map i18n.resolvedLanguage/language: startsWith('en') -> 'en', else 'pt-BR'. One helper, used by create and resend."
  - "Added at Execute from 09-verify.result.json (engine adapt). Dark-mode copy for the warning box was considered and dropped: the app has no dark-mode theme (one `dark:` class in the whole web app)."
---

# Slice 11 - invite locale + body-only retryAfterSeconds

Runs in wave 4 after slice 09 and beside slice 10 (no shared file).

## Oracle

- `apps/web/src/admin/sellers/__tests__/AdminSellersPage.test.tsx`.
