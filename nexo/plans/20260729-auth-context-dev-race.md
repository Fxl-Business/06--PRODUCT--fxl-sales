---
id: auth-context-dev-race
milestone: v2.3.0
status: done
flow: quick
---

# Quick: fix "Hub auth context is missing" cold-start crash

## Intent

On a cold Chrome start the Vite dev server discovered `@radix-ui/react-dropdown-menu` late, re-optimized mid-load, and served `src/auth/react.tsx` twice (plain and `?t=` URLs).
Two module instances mean two `HubAuthContext` objects, so `Protected` read `null` and threw, and the user saw React Router's default error page.

## Change

1. Make `HubAuthContext` a `globalThis` singleton so duplicated module instances share one context object.
2. Make dev dep optimization deterministic in `apps/web/vite.config.ts` (`resolve.dedupe`, `optimizeDeps.include` with the late-discovered packages, `server.warmup`).
3. Normalize `router.tsx` to import `@/auth/react` like every other consumer.
4. Add a `RouteErrorPage` with a Recarregar button as `errorElement` on every top-level route so route errors never render the raw default page.

## Acceptance

Given a route element that throws during render, when the router renders it, then the user sees the "Algo deu errado" page with a Recarregar button instead of React Router's default error screen, and the vite config and auth context carry the dedupe/singleton guards (locked by contract test `apps/web/src/__tests__/route-error-and-auth-context.test.tsx`).
