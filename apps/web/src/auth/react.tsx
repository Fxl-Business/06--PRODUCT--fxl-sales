/* eslint-disable react-refresh/only-export-components */
import { createHubClient, type HubClient } from '@fxl-business/hub-sdk/client';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Skeleton } from '@/components/ui/skeleton';
import { isOrgLabelFallback, orgLabel } from '@/lib/displayNames';
import { getRoleFromHubClaims, getRolesFromHubClaims, parseJwtPayload, type AppRole } from './claims';
import { getHubBffBasePath, loadHubBrowserConfig } from './provider';
import { requestHubAccessToken, TRANSIENT_TOKEN_RESULT, type HubTokenResult } from './refresh';
import {
  captureReturnTo,
  clearLoginAttempts,
  clearLogoutIntent,
  consumeReturnTo,
  hasLogoutIntent,
  isLoginBlocked,
  markLogoutIntent,
  registerLoginAttempt,
} from './session-recovery';
import { createHubAccessTokenCache } from './token';

/**
 * The bounded revalidation ladder, entered only by a TRANSIENT refresh failure.
 *
 * `requestHubAccessToken` classifies against the BFF's status: a `401` means the
 * session is dead and `failSession()` runs at once, with no rung ever scheduled.
 * Everything else - `503 refresh_unavailable`, `502 invalid_refresh_response`, a
 * network throw, an unparseable body - preserves the session and schedules a
 * re-read instead, because treating a Hub blip as a dead session is what destroyed
 * a half-filled form every time a refresh hiccuped.
 *
 * Four CONSECUTIVE transient failures (about six seconds) exhaust the ladder and
 * the session really is torn down, so a Hub that never recovers cannot leave the
 * app stranded half-authenticated. The counter resets on every recovery; a
 * lifetime total reships the original bug.
 */
export const SESSION_REVALIDATE_DELAYS_MS = [500, 1_500, 4_000] as const;

/**
 * How long before a token's `exp` the proactive renewal fires, while the document is
 * VISIBLE.
 *
 * Nothing in the app reads a token while the tab is idle, so without this the cached
 * token simply lapses and the first read after the operator returns pays for a refresh -
 * and, when that refresh fails, used to pay with their unsaved form. An open tab that
 * renews itself never reaches that read at all.
 *
 * Deliberately LONGER than `ACCESS_TOKEN_EXPIRY_SKEW_MS` (30s), which is why the cache
 * exposes `renew()`: at this point `getToken()` would still answer from memory, so a
 * renewal driven through it would issue no request whatsoever.
 */
export const SESSION_RENEWAL_LEAD_MS = 60_000;

/** `''` makes every `new URL(value, origin)` throw, so a missing DOM means "no restore". */
function currentOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

type AuthProfile = {
  isLoaded: boolean;
  isSignedIn: boolean;
  role?: AppRole;
  roles: AppRole[];
  name?: string;
  email?: string;
  avatarUrl?: string;
  workspaceName?: string;
};

type HubWorkspacePreview = {
  id: string;
  name?: string;
  products?: string[];
};

type HubAuthState = AuthProfile & {
  /**
   * A session that was LIVE in this document and then went away, as opposed to a document
   * that was opened without one. The two need opposite treatments and `HubProtected`
   * cannot tell them apart from `isSignedIn` alone, which is false for both.
   */
  sessionLost: boolean;
  client: HubClient;
  getToken: () => Promise<string | null>;
  login: () => void;
  logout: () => Promise<void>;
  setActive: (workspaceId: string) => Promise<void>;
  workspaces: HubWorkspacePreview[];
};

type AccessTokenHook = () => { getToken: () => Promise<string | null> };
type LogoutHook = () => () => Promise<void>;

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readWorkspaces(value: unknown): HubWorkspacePreview[] {
  if (!Array.isArray(value)) return [];
  return value.reduce<HubWorkspacePreview[]>((acc, item) => {
    if (typeof item !== 'object' || item === null) return acc;
    const workspace = item as Record<string, unknown>;
    /*
      The Hub mints this entry keyed `workspaceId`, NOT `id` - see
      `packages/shared-types/src/hub/claims.ts` in the Hub repo, and the minter
      and repo agree with it. Reading only `id` silently dropped every entry, so
      `workspaces` was always `[]` against a real token and the workspace
      switcher in `UserControls` (which renders only when `length > 1`) had never
      appeared in production at all.

      Nothing caught it because the test fixtures were written against the web
      type rather than the token, so they used `id` and agreed with the bug.
      `id` is kept as a fallback deliberately: it costs one `??`, and it is what
      the pre-existing fixtures and any older Hub emit.
    */
    const id = readString(workspace.workspaceId) ?? readString(workspace.id);
    if (!id) return acc;
    const products = Array.isArray(workspace.products)
      ? workspace.products.filter((product): product is string => typeof product === 'string')
      : undefined;
    acc.push({
      id,
      name: readString(workspace.name),
      products,
    });
    return acc;
  }, []);
}

function profileFromToken(token: string | null): Omit<AuthProfile, 'isLoaded' | 'isSignedIn'> & {
  workspaces: HubWorkspacePreview[];
} {
  const claims = token ? parseJwtPayload(token) : null;
  if (!claims) {
    return { roles: [], workspaces: [] };
  }

  return {
    role: getRoleFromHubClaims(claims),
    roles: getRolesFromHubClaims(claims),
    name: readString(claims.name),
    email: readString(claims.email),
    avatarUrl: readString(claims.avatarUrl),
    workspaceName: readString(claims.workspaceName),
    workspaces: readWorkspaces(claims.workspaces),
  };
}

// Pinned to globalThis so a duplicated module instance (Vite dev re-optimization
// serving this file under both plain and ?t= URLs) still shares one context object.
type HubAuthContextType = ReturnType<typeof createContext<HubAuthState | null>>;
const hubAuthGlobal = globalThis as typeof globalThis & {
  __fxlHubAuthContext?: HubAuthContextType;
};
const HubAuthContext = (hubAuthGlobal.__fxlHubAuthContext ??=
  createContext<HubAuthState | null>(null));

function useHubAuthContext() {
  const value = useContext(HubAuthContext);
  if (!value) {
    throw new Error('Hub auth context is missing');
  }
  return value;
}

function HubAuthProvider({ children }: { children: ReactNode }) {
  /**
   * Read from context, never imported: this is the exact client this provider's own
   * subtree reads, so the flush and the reads can never diverge onto two instances.
   * `App.tsx` mounts `QueryClientProvider` above `AppAuthProvider` to make this legal,
   * and a source-level test pins that nesting.
   *
   * Every key in `@/lib/query-keys` is account- and org-agnostic - the bootstrap key is
   * literally `['sales-ops','bootstrap']` - and the client is a module-level singleton
   * that survives every auth event short of a page reload. So one cache entry is shared
   * by every identity the tab ever holds unless it is emptied at each identity change.
   */
  const queryClient = useQueryClient();
  /**
   * Computed ONCE and handed to both constructions. `refresh.ts` spells the BFF path
   * out itself, so this shared value is what makes the hand-rolled request unable to
   * resolve to a different origin than the SDK client's.
   */
  const bffBasePath = useMemo(() => getHubBffBasePath(import.meta.env), []);
  const client = useMemo(
    () => createHubClient(loadHubBrowserConfig(import.meta.env), { bffBasePath }),
    [bffBasePath],
  );
  const tokenCache = useMemo(
    () => createHubAccessTokenCache(() => requestHubAccessToken(bffBasePath)),
    [bffBasePath],
  );
  const operationGeneration = useRef(0);
  /**
   * The token last pushed into React state. `undefined` is a sentinel that no apply
   * has happened yet, so the very first apply - including a first apply of `null`,
   * which must flip `isLoaded` - always runs.
   */
  const lastAppliedToken = useRef<string | null | undefined>(undefined);
  const revalidateAttempts = useRef(0);
  const revalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The proactive renewal, and the SECOND timer source in this file. `renewalTarget` is
   * the expiry the pending rung was armed for, so ~40 token reads per screen re-arm
   * nothing: one renewal per token lifetime, the same shape as the ladder's "while a
   * timer is pending, further nulls are no-ops".
   */
  const renewalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renewalTarget = useRef<number | null>(null);
  /**
   * Clearing the pending timer at unmount does not cover the interleaving where the
   * timer has ALREADY fired and its refresh is still in flight: `revalidateTimer` is
   * null by then, so the cleanup finds nothing, and the late resolution schedules a
   * fresh rung that nothing will ever clear.
   */
  const mountedRef = useRef(true);
  const [profile, setProfile] = useState<AuthProfile>({
    isLoaded: false,
    isSignedIn: false,
    roles: [],
  });
  const [workspaces, setWorkspaces] = useState<HubWorkspacePreview[]>([]);
  const [sessionLost, setSessionLost] = useState(false);

  const applyToken = useCallback((token: string | null) => {
    // `profileFromToken` is pure over the token, so the same token deterministically
    // yields the same profile. Without this guard every one of the ~40 token reads per
    // screen built a fresh profile object and a fresh workspaces array, both of which
    // only bail out on `Object.is`, and re-rendered every consumer of the auth context.
    if (lastAppliedToken.current === token) return;
    /*
      COLD ENTRY versus LIVE LOSS, read off the same ref that already discriminates the
      cache flush below. `undefined` before the first apply, `null` after a loss, a string
      while signed in - so a live loss is exactly "was a string, is now null".

      Read BEFORE the ref is overwritten, and pushed into STATE rather than left in a ref,
      because `HubProtected` has to render on it. It rides the same batch as `setProfile`,
      so the pair can never be committed out of step.
    */
    const wasSignedIn = typeof lastAppliedToken.current === 'string';
    setSessionLost(token === null && wasSignedIn);
    lastAppliedToken.current = token;
    const next = profileFromToken(token);
    setWorkspaces(next.workspaces);
    setProfile({
      isLoaded: true,
      isSignedIn: token !== null,
      role: next.role,
      roles: next.roles,
      name: next.name,
      email: next.email,
      avatarUrl: next.avatarUrl,
      workspaceName: next.workspaceName,
    });
  }, []);

  /**
   * One `useMemo` so `scheduleRevalidate` and `observeToken` can call each other
   * directly (hoisted function declarations) instead of through a latest-ref, and so
   * every one of them keeps a stable identity - `getToken` is handed to ~40 call sites
   * and must not change on every render.
   */
  const { clearTimers, failSession, handleVisibilityChange, observeToken } = useMemo(() => {
    function clearRevalidateTimer() {
      if (revalidateTimer.current === null) return;
      clearTimeout(revalidateTimer.current);
      revalidateTimer.current = null;
    }

    function clearRenewalTimer() {
      renewalTarget.current = null;
      if (renewalTimer.current === null) return;
      clearTimeout(renewalTimer.current);
      renewalTimer.current = null;
    }

    function clearTimers() {
      clearRevalidateTimer();
      clearRenewalTimer();
    }

    /** A missing DOM (SSR, a unit test without one) is treated as "not visible". */
    function documentIsVisible() {
      return typeof document !== 'undefined' && document.visibilityState === 'visible';
    }

    function renewNow() {
      clearRenewalTimer();
      void tokenCache.renew().then(observeToken, () => observeToken(TRANSIENT_TOKEN_RESULT));
    }

    function scheduleRenewal() {
      /*
        NEVER while hidden. A background tab's timers are throttled to minutes, so the
        rung would fire late and useless, and keeping a session alive for a tab nobody is
        looking at is not a service to anyone. `handleVisibilityChange` re-arms on the way
        back, which is the moment it starts mattering again.
      */
      if (!documentIsVisible()) {
        clearRenewalTimer();
        return;
      }
      const expiresAt = tokenCache.expiresAt();
      if (expiresAt === null) {
        clearRenewalTimer();
        return;
      }
      if (renewalTimer.current !== null && renewalTarget.current === expiresAt) return;
      clearRenewalTimer();
      /*
        STRICTLY positive. A non-positive delay means the token is already inside the
        renewal window, and renewing from here would arm the next rung out of the answer
        to this one - an unbounded loop for any token whose whole life is shorter than the
        lead. That case belongs to `handleVisibilityChange`, which fires once per event.
      */
      const delay = expiresAt - SESSION_RENEWAL_LEAD_MS - Date.now();
      if (delay <= 0) return;
      renewalTarget.current = expiresAt;
      renewalTimer.current = setTimeout(() => {
        renewalTimer.current = null;
        renewalTarget.current = null;
        renewNow();
      }, delay);
    }

    function handleVisibilityChange() {
      if (!documentIsVisible()) {
        clearRenewalTimer();
        return;
      }
      // A tab with no session has nothing to renew, and must not be given one behind the
      // operator's back - `undefined` is a boot still in flight, `null` a signed-out tab.
      if (typeof lastAppliedToken.current !== 'string') return;
      const expiresAt = tokenCache.expiresAt();
      if (expiresAt !== null && expiresAt - SESSION_RENEWAL_LEAD_MS > Date.now()) {
        scheduleRenewal();
        return;
      }
      /*
        Expired, inside the window, or holding a token the cache would not keep. Renewed
        SYNCHRONOUSLY on the event, before any focus-triggered query refetch can read the
        token: a refetch that wins that race reads a lapsed token and walks straight into
        the failure path this slice exists to avoid.
      */
      renewNow();
    }

    function failSession() {
      clearTimers();
      revalidateAttempts.current = 0;
      applyToken(null);
    }

    function scheduleRevalidate() {
      // While a timer is pending, further nulls are no-ops. ~40 concurrent readers
      // must produce ONE ladder, not 40.
      if (revalidateTimer.current !== null) return;
      const attempt = revalidateAttempts.current;
      if (attempt >= SESSION_REVALIDATE_DELAYS_MS.length) {
        failSession();
        return;
      }
      revalidateAttempts.current = attempt + 1;
      revalidateTimer.current = setTimeout(() => {
        revalidateTimer.current = null;
        void tokenCache
          .getToken()
          .then(observeToken, () => observeToken(TRANSIENT_TOKEN_RESULT));
      }, SESSION_REVALIDATE_DELAYS_MS[attempt]);
    }

    function observeToken(result: HubTokenResult) {
      // A resolution that lands after unmount is dropped whole: applying it would be a
      // setState on a dead root, and rescheduling from it would leak a timer forever.
      if (!mountedRef.current) return;
      if (result.token !== null) {
        /*
          The in-page signed-out to signed-in transition. `lastAppliedToken` is
          `undefined` before the first apply, `null` while signed out, and a token string
          while signed in, so a non-string here means the previous identity was already
          torn down and anything still in the cache belongs to it.

          A ladder RECOVERY leaves the previous token string in place and therefore must
          NOT flush: destroying the operator's cached screen over a transient blip is the
          same class of bug the ladder itself exists to prevent. Do NOT weaken this to
          "flush on every non-null token".

          It must be read BEFORE `applyToken`, which is what overwrites the ref, and it
          must live here rather than inside `applyToken`, whose unchanged-token early
          return would skip it whenever a re-login yielded a byte-identical token.

          Firing once at cold start, on `undefined`, is a provable no-op: every data hook
          in the app lives inside `Protected`, which renders a Skeleton until `isSignedIn`,
          so no query can exist yet. The unconditional form is the one that stays correct
          if a query ever mounts outside `Protected`.

          A workspace switch does not reach this branch with a non-string, so it can never
          double-flush with `setActive`'s own explicit flush below.
        */
        const wasSignedIn = typeof lastAppliedToken.current === 'string';
        if (!wasSignedIn) queryClient.clear();
        clearRevalidateTimer();
        revalidateAttempts.current = 0;
        // A normal re-login (attempt 1, callback, token) leaves the loop guard at
        // zero, so it can never fire during ordinary operation.
        clearLoginAttempts();
        // A token in hand is proof the session is live, so any intent still sitting in
        // storage is stale by definition. This is the BACKSTOP that makes a lockout
        // impossible: the intent can only ever persist while no token is obtainable,
        // and the instant one is, it is gone - via the callback round trip, via a
        // workspace switch, via a ladder recovery, via anything at all. It sits next to
        // `clearLoginAttempts()` because it is the same argument about the same event,
        // and deliberately NOT inside `applyToken`, whose unchanged-token early return
        // would skip it whenever a re-login happened to yield a byte-identical token.
        clearLogoutIntent();
        applyToken(result.token);
        // AFTER the apply, and on every observed token rather than only on a changed one:
        // a `seed` from a workspace switch replaces the expiry under an unchanged-looking
        // read, and the pending rung has to follow it.
        scheduleRenewal();
        return;
      }
      /*
        The BFF's own `401`. The session is provably dead - revoked, reused, expired,
        or never there - so the ladder has nothing left to prove and six seconds of
        retries would be pure latency in front of a login the operator already needs.
      */
      if (result.failure === 'session_expired') {
        failSession();
        return;
      }
      /*
        Transient, and that includes a COLD START. Signing out on a boot-time Hub blip
        would redirect into a login that also fails, burn the `registerLoginAttempt`
        budget and strand the operator on `SessionRecoveryPanel` - the same class of
        bug the ladder exists to prevent, reached from the other end. `isLoaded` stays
        false meanwhile, so `HubProtected` holds its Skeleton rather than flashing a
        signed-out screen.
      */
      scheduleRevalidate();
    }

    return { clearTimers, failSession, handleVisibilityChange, observeToken };
  }, [applyToken, queryClient, tokenCache]);

  /**
   * Keeps its `Promise<string | null>` signature deliberately. Roughly forty call
   * sites and `AccessTokenHook` depend on it, and the classification stops here: see
   * the `nexo/ROADMAP.md` entry about `Sessão expirada` still reading wrong for a
   * transient failure in the sales-ops panels.
   */
  const getToken = useCallback(async () => {
    const result = await tokenCache.getToken();
    observeToken(result);
    return result.token;
  }, [observeToken, tokenCache]);

  const login = useCallback(() => client.login(), [client]);

  const logout = useCallback(async () => {
    /*
      SYNCHRONOUS, and BEFORE THE FIRST `await` in this function. Written as the first
      statement as the defensive position: it is the only placement that stays correct
      if an `await` is ever inserted above it.

      React 18 flushes a discrete event's state update when the handler returns, so
      `HubProtected` re-renders and its effects run BEFORE the `await` at the bottom
      resolves. Without a durable intent, `consumeReturnTo()` clears the slot and the
      login effect then refills it with the exact path this logout is clearing, spends a
      login attempt, and redirects to the Hub. That is the measured bug.

      Note this is NOT an ordering bug INSIDE the synchronous block - React cannot
      re-render in the middle of a synchronous function, so every statement below
      completes before any flush. Do not conflate it with the proposta wizard's submit
      button, which races two browser phases within a single click.
    */
    markLogoutIntent();
    operationGeneration.current += 1;
    tokenCache.clear();
    // Kills any in-flight ladder and applies the signed-out profile. A read that lands
    // after this can still start a fresh ladder, which is harmless: `applyToken(null)`
    // is idempotent through `lastAppliedToken`, so an exhausted post-logout ladder
    // re-applies a state the app is already in, and the unmount effect clears the
    // pending timer. The durable logout intent above is the real guard.
    failSession();
    /*
      Synchronous and before the first `await`, in the same block as `failSession()`, so
      React commits ONE render: signed-out profile and empty cache together, with no
      frame in which the tree is live over the previous operator's rows. `clear()` and
      not `invalidateQueries()` - invalidation leaves the data in the cache to be
      rendered while the refetch is in flight, which is the leak itself - and `clear()`
      also empties the mutation cache, so a paused mutation started by this operator
      cannot resume under the next one's token.
    */
    queryClient.clear();
    clearLoginAttempts();
    /*
      No longer inert. `markLogoutIntent()` above is what stops `HubProtected`'s login
      effect refilling the slot on the synchronous re-render, so this really does leave
      it empty: a deliberate logout must not bounce the next login into the previous
      operator's screen.
    */
    consumeReturnTo(currentOrigin());
    await client.logout();
  }, [client, failSession, queryClient, tokenCache]);

  const setActive = useCallback(
    async (workspaceId: string) => {
      operationGeneration.current += 1;
      const switchGeneration = operationGeneration.current;
      const result = await client.setActive(workspaceId);
      if (switchGeneration !== operationGeneration.current) return;
      /*
        The sharpest of the three: no reload, components stay mounted, and it crosses
        TENANTS inside one account. Every mounted screen would otherwise keep rendering
        the previous tenant's rows until each query happened to refetch.

        AFTER the `await`, never before - flushing early would wipe the current tenant's
        data on a switch that then fails or is superseded, stranding the operator on an
        empty screen for a workspace they never left. AFTER the generation check, because
        a superseded switch discards its result whole and must discard its flush too.
        BEFORE `seed` and `observeToken`, which are the two statements that make the new
        identity reachable and visible; the three are one synchronous block today, and
        this ordering is what keeps it correct if an `await` is ever inserted between
        them.
      */
      queryClient.clear();
      tokenCache.seed(result.accessToken, result.expiresIn);
      observeToken({ token: result.accessToken });
    },
    [client, observeToken, queryClient, tokenCache],
  );

  useEffect(() => {
    let active = true;
    void tokenCache
      .getToken()
      .then((result) => {
        if (active) observeToken(result);
      })
      .catch(() => {
        // `requestHubAccessToken` already absorbs a network throw, so reaching here is
        // a bug rather than an outage. It is still transient: a throw is not a verdict.
        if (active) observeToken(TRANSIENT_TOKEN_RESULT);
      });
    return () => {
      active = false;
    };
  }, [observeToken, tokenCache]);

  /**
   * The renewal is armed only while the document is visible, so the transition itself has
   * to be observed. This is also the only place a tab that has been hidden for hours
   * learns that its token lapsed while nobody was watching.
   */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [handleVisibilityChange]);

  // Re-armed in the effect body, not only initialized at `useRef`, so a StrictMode
  // mount-unmount-mount cannot leave the provider permanently marked as unmounted.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimers();
    };
  }, [clearTimers]);

  const value = useMemo(
    () => ({
      ...profile,
      sessionLost,
      client,
      getToken,
      login,
      logout,
      setActive,
      workspaces,
    }),
    [client, getToken, login, logout, profile, sessionLost, setActive, workspaces],
  );

  return <HubAuthContext.Provider value={value}>{children}</HubAuthContext.Provider>;
}

/**
 * The terminal state of the anti-redirect-loop guard. Strings are hardcoded pt-BR to
 * match the rest of this file (`Sair`, `Buscar workspace...`); `src/i18n/**` is outside
 * this slice's boundary.
 */
function SessionRecoveryPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Não foi possível restabelecer sua sessão</h1>
      <p className="max-w-md text-muted-foreground">
        Tentamos entrar novamente algumas vezes e a sessão não foi aceita. Isso costuma ser
        temporário.
      </p>
      <Button onClick={onRetry} variant="outline">
        Tentar novamente
      </Button>
    </div>
  );
}

/**
 * The terminal state of an EXPLICIT `Sair`, and - with different copy - of a session lost
 * while the app was open. Deliberately not an automatic redirect to the Hub: on a shared
 * machine, auto-re-login undoes the one action the product offers for ending a session,
 * and the Hub's own SSO cookie can complete it with no prompt at all, so the next person
 * at that desk finds an authenticated app. Signing back in has to be a deliberate act by
 * whoever is actually sitting there.
 *
 * The default `Button` variant, not `outline`: `SessionRecoveryPanel`'s retry is a
 * secondary action under an error message, while this is the single primary action on
 * the screen. Strings are hardcoded pt-BR to match the rest of this file.
 */
function SignedOutPanel({
  onSignIn,
  title = 'Você saiu da sua conta',
  description = 'Sua sessão foi encerrada neste navegador. Entre novamente para continuar.',
}: {
  onSignIn: () => void;
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="max-w-md text-muted-foreground">{description}</p>
      <Button onClick={onSignIn}>Entrar</Button>
    </div>
  );
}

function HubProtected({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, login, sessionLost } = useHubAuthContext();
  // The router location, not `window.location`: it is the app's own truth, identical
  // to the browser's under `BrowserRouter`, and testable without stubbing globals.
  const location = useLocation();
  const navigate = useNavigate();
  // The two panel buttons are the only things that can change either guard's answer
  // while this component stays mounted, so they are the only things that have to force
  // a re-read.
  const [guardTick, recheckRecoveryGuards] = useReducer((ticks: number) => ticks + 1, 0);
  /**
   * The operator's own decision to leave this page, and the ONLY thing that re-arms the
   * login effect after a live loss.
   *
   * A ref rather than state, consumed by the login it re-arms, because it is a one-shot
   * REQUEST and not a fact about the session: mirroring it into state would need a second
   * effect to clear it, which is a setState in an effect body and which `loginBlocked`
   * and `logoutIntent` already refuse to do for the same reason. `guardTick` is what makes
   * the effect re-run on the click - exactly the job that reducer already had.
   */
  const signInRequested = useRef(false);
  const restoredRef = useRef(false);
  const currentPath = `${location.pathname}${location.search}`;
  /**
   * Derived from storage on every render, never mirrored into React state, for the same
   * reason `loginBlocked` is. Both writers re-render this component anyway: `logout()`
   * flips `isSignedIn` in the same synchronous block as the write, and the `Entrar`
   * click dispatches `recheckRecoveryGuards`.
   */
  const logoutIntent = isLoaded && !isSignedIn && hasLogoutIntent();
  /**
   * Derived from the stored attempt counter, never mirrored into React state. A
   * `setLoginBlocked(true)` inside the login effect would create a second source of
   * truth for one fact and would be a synchronous setState in an effect body.
   */
  const loginBlocked = isLoaded && !isSignedIn && isLoginBlocked();
  /**
   * A session that was live in this document and went away, with the operator's own
   * `Sair` excluded because that has its own state and its own copy.
   */
  const liveSessionLoss = isLoaded && !isSignedIn && sessionLost && !logoutIntent;

  useEffect(() => {
    // `restoredRef` plus consume-before-validate makes a StrictMode double effect inert.
    if (!isLoaded || !isSignedIn || restoredRef.current) return;
    restoredRef.current = true;
    const target = consumeReturnTo(currentOrigin());
    // `replace` so the post-callback root entry does not linger in history and send
    // the operator back to the dashboard on Back.
    if (target && target !== currentPath) navigate(target, { replace: true });
  }, [currentPath, isLoaded, isSignedIn, navigate]);

  /**
   * An explicit `Sair` must not leave the previous operator's route in the URL bar, and
   * must not leave it sitting in `location` for the login effect to capture the instant
   * the intent is cleared. Reducing it to `/` here makes both structural rather than
   * dependent on the order two state updates happen to batch in: `sanitizeReturnTo('/')`
   * is `null`, so by the time a capture is possible there is nothing left to capture.
   * `replace` so Back cannot walk into it either.
   */
  useEffect(() => {
    if (!logoutIntent || currentPath === '/') return;
    navigate('/', { replace: true });
  }, [currentPath, logoutIntent, navigate]);

  useEffect(() => {
    if (!isLoaded || isSignedIn || loginBlocked || logoutIntent) return;
    /*
      THE FIX for the destroyed-form report. `login()` is `window.location.assign` to the
      Hub, so calling it destroys the document and every byte of unsaved form state with
      it; `captureReturnTo` restores the ROUTE and has never restored form state.

      A COLD ENTRY keeps redirecting exactly as before - there is nothing on screen yet,
      so nothing is destroyed, and breaking that path means nobody can ever sign in. A
      LIVE LOSS waits for the operator instead, so the navigation is theirs and the loss
      is expected rather than inflicted.
    */
    if (sessionLost && !signInRequested.current) return;
    // Belt and braces: the render guard above already refuses, and `registerLoginAttempt`
    // refuses again here without incrementing, so the counter cannot run away.
    if (!registerLoginAttempt()) return;
    /*
      Spent by the login it re-armed, and spent AFTER the attempt guard so a refusal there
      leaves the request intact for a later re-read rather than turning the button dead.
      `login()` normally destroys the document before this matters, but it is a navigation
      REQUEST and not a guarantee - a blocked assign leaves the tab alive - and a request
      that survived would silently restore the auto-navigation this effect just removed,
      on the NEXT loss instead of the first.
    */
    signInRequested.current = false;
    // CLAUDE.md, "Sales Ops Routing": the URL is the single source of truth for the
    // active workspace and page, so restoring the URL restores the screen.
    captureReturnTo(currentPath, currentOrigin());
    login();
    /*
      `guardTick` is a dependency, not decoration: it is the only thing that re-runs this
      effect when the live-loss panel's `Entrar` sets the ref above, since neither
      `isSignedIn` nor either storage-derived guard changes on that click.
    */
  }, [currentPath, guardTick, isLoaded, isSignedIn, login, loginBlocked, logoutIntent, sessionLost]);

  /**
   * Ahead of `loginBlocked` deliberately. `SessionRecoveryPanel` says "Tentamos entrar
   * novamente algumas vezes", which would be a lie after an explicit sign-out, since no
   * automatic attempt was made at all. In practice the two are almost never both true,
   * because `logout()` calls `clearLoginAttempts()`, but the ordering must not depend on
   * that.
   */
  if (logoutIntent) {
    return (
      <SignedOutPanel
        onSignIn={() => {
          // Clearing the intent re-arms the login effect on the next render, exactly as
          // the retry below re-arms it by clearing the counter. No direct `login()`
          // call: one path into `login()` is what keeps `captureReturnTo` and
          // `registerLoginAttempt` on that path too. By now the URL reset effect has
          // already reduced `currentPath` to `/`, and `sanitizeReturnTo('/')` is `null`,
          // so the capture that follows stores nothing.
          clearLogoutIntent();
          recheckRecoveryGuards();
        }}
      />
    );
  }

  /**
   * AHEAD of `loginBlocked`, and the only branch in this component that keeps `children`
   * mounted. That is the whole point: React state lives exactly as long as the component
   * holding it, so the operator's half-filled wizard survives precisely because the
   * subtree underneath this overlay is never unmounted.
   *
   * Ahead of `loginBlocked` because the loop guard exists to stop AUTOMATIC re-login
   * loops, and a live loss never spends an attempt on its own. Letting a leftover counter
   * swap this for `SessionRecoveryPanel` would unmount the work this branch exists to
   * protect, in order to describe retries that never happened.
   */
  if (liveSessionLoss) {
    return (
      <>
        {children}
        <div className="fixed inset-0 z-50 overflow-y-auto bg-background/95 backdrop-blur-sm">
          <SignedOutPanel
            description="Entre novamente para continuar. Nada do que você digitou nesta página foi perdido."
            onSignIn={() => {
              /*
                The click IS the deliberate retry the loop guard makes room for, exactly as
                `SessionRecoveryPanel`'s does, so it clears the counter rather than leaving
                a dead button sitting on top of unsaved work. The login effect does the
                rest: one path into `login()` is what keeps `captureReturnTo` and
                `registerLoginAttempt` on that path too.
              */
              clearLoginAttempts();
              signInRequested.current = true;
              recheckRecoveryGuards();
            }}
            title="Sua sessão expirou"
          />
        </div>
      </>
    );
  }

  if (loginBlocked) {
    return (
      <SessionRecoveryPanel
        onRetry={() => {
          // Clearing the counter flips `loginBlocked` back to false on the next render,
          // which re-arms the login effect. No direct `login()` call is needed.
          clearLoginAttempts();
          recheckRecoveryGuards();
        }}
      />
    );
  }

  if (!isLoaded || !isSignedIn) {
    return <Skeleton className="h-screen w-full" />;
  }

  return <>{children}</>;
}

function useHubAccessToken() {
  const { getToken } = useHubAuthContext();
  return { getToken };
}

function useHubProfile(): AuthProfile {
  const { isLoaded, isSignedIn, role, roles, name, email, avatarUrl, workspaceName } =
    useHubAuthContext();
  return { isLoaded, isSignedIn, role, roles, name, email, avatarUrl, workspaceName };
}

function useHubLogout(): () => Promise<void> {
  const { logout } = useHubAuthContext();
  return logout;
}

function HubUserControls() {
  const { logout, setActive, workspaceName, workspaces } = useHubAuthContext();

  return (
    <>
      {workspaces.length > 1 ? (
        <div className="w-56">
          <Combobox
            aria-label="Workspace"
            className="h-9 rounded-md border-input bg-background px-3 text-sm"
            onChange={(workspaceId) => {
              void setActive(workspaceId);
            }}
            options={workspaces.map((workspace) => ({
              value: workspace.id,
              label: orgLabel(workspace),
              // CLAUDE.md forbids a raw workspace id as a primary label. When there is no
              // name, the id drops to the muted secondary line instead.
              description: isOrgLabelFallback(workspace) ? workspace.id : undefined,
            }))}
            searchPlaceholder="Buscar workspace..."
            value={workspaces.find((workspace) => workspace.name === workspaceName)?.id ?? ''}
          />
        </div>
      ) : null}
      <button
        aria-label="Sair"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          void logout();
        }}
        title="Sair"
        type="button"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
      </button>
    </>
  );
}

export const AppAuthProvider = HubAuthProvider;
export const Protected = HubProtected;
export const useAccessToken: AccessTokenHook = useHubAccessToken;
export const useAuthProfile = useHubProfile;
export const useLogout: LogoutHook = useHubLogout;
export const UserControls = HubUserControls;
