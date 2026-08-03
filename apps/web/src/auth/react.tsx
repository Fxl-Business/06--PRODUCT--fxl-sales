/* eslint-disable react-refresh/only-export-components */
import { createHubClient, type HubClient } from '@fxl-business/hub-sdk/client';
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
import {
  captureReturnTo,
  clearLoginAttempts,
  consumeReturnTo,
  isLoginBlocked,
  registerLoginAttempt,
} from './session-recovery';
import { createHubAccessTokenCache } from './token';

/**
 * The bounded revalidation ladder. `HubClient.getToken()` collapses three genuinely
 * different outcomes - the network threw, the BFF answered non-200, the body did not
 * parse - into a single `null`, so the provider cannot tell "the network hiccuped"
 * from "your session is dead". Treating both as dead is what destroyed a half-filled
 * form every time a refresh blipped.
 *
 * A `null` observed while a token is already held therefore does not touch the
 * profile; it schedules a re-read instead. Four consecutive nulls (~6 seconds of
 * continuous failure) exhaust the ladder and the session really is torn down, so a
 * genuinely dead session can never leave the app stranded half-authenticated.
 */
export const SESSION_REVALIDATE_DELAYS_MS = [500, 1_500, 4_000] as const;

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
    const id = readString(workspace.id);
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
  const client = useMemo(
    () =>
      createHubClient(loadHubBrowserConfig(import.meta.env), {
        bffBasePath: getHubBffBasePath(import.meta.env),
      }),
    [],
  );
  const tokenCache = useMemo(() => createHubAccessTokenCache(client), [client]);
  const operationGeneration = useRef(0);
  /**
   * The token last pushed into React state. `undefined` is a sentinel that no apply
   * has happened yet, so the very first apply - including a first apply of `null`,
   * which must flip `isLoaded` - always runs.
   */
  const lastAppliedToken = useRef<string | null | undefined>(undefined);
  /** A token has been observed and not yet invalidated. Gates the ladder. */
  const hasSessionRef = useRef(false);
  const revalidateAttempts = useRef(0);
  const revalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const applyToken = useCallback((token: string | null) => {
    // `profileFromToken` is pure over the token, so the same token deterministically
    // yields the same profile. Without this guard every one of the ~40 token reads per
    // screen built a fresh profile object and a fresh workspaces array, both of which
    // only bail out on `Object.is`, and re-rendered every consumer of the auth context.
    if (lastAppliedToken.current === token) return;
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
  const { clearRevalidateTimer, failSession, observeToken } = useMemo(() => {
    function clearRevalidateTimer() {
      if (revalidateTimer.current === null) return;
      clearTimeout(revalidateTimer.current);
      revalidateTimer.current = null;
    }

    function failSession() {
      clearRevalidateTimer();
      revalidateAttempts.current = 0;
      hasSessionRef.current = false;
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
        void tokenCache.getToken().then(observeToken, () => observeToken(null));
      }, SESSION_REVALIDATE_DELAYS_MS[attempt]);
    }

    function observeToken(token: string | null) {
      // A resolution that lands after unmount is dropped whole: applying it would be a
      // setState on a dead root, and rescheduling from it would leak a timer forever.
      if (!mountedRef.current) return;
      if (token !== null) {
        clearRevalidateTimer();
        revalidateAttempts.current = 0;
        hasSessionRef.current = true;
        // A normal re-login (attempt 1, callback, token) leaves the loop guard at
        // zero, so it can never fire during ordinary operation.
        clearLoginAttempts();
        applyToken(token);
        return;
      }
      // Cold start: no profile to preserve and no in-progress work to lose, so an
      // immediate sign-out and re-login is the fastest correct answer.
      if (!hasSessionRef.current) {
        applyToken(null);
        return;
      }
      scheduleRevalidate();
    }

    return { clearRevalidateTimer, failSession, observeToken };
  }, [applyToken, tokenCache]);

  const getToken = useCallback(async () => {
    const token = await tokenCache.getToken();
    observeToken(token);
    return token;
  }, [observeToken, tokenCache]);

  const login = useCallback(() => client.login(), [client]);

  const logout = useCallback(async () => {
    operationGeneration.current += 1;
    tokenCache.clear();
    // Kills any in-flight ladder and clears `hasSessionRef`, so a late resolution
    // cannot resurrect a profile after an explicit sign-out.
    failSession();
    clearLoginAttempts();
    // A deliberate logout must not bounce the next login into the previous
    // operator's screen.
    consumeReturnTo(currentOrigin());
    await client.logout();
  }, [client, failSession, tokenCache]);

  const setActive = useCallback(
    async (workspaceId: string) => {
      operationGeneration.current += 1;
      const switchGeneration = operationGeneration.current;
      const result = await client.setActive(workspaceId);
      if (switchGeneration !== operationGeneration.current) return;
      tokenCache.seed(result.accessToken, result.expiresIn);
      observeToken(result.accessToken);
    },
    [client, observeToken, tokenCache],
  );

  useEffect(() => {
    let active = true;
    void tokenCache
      .getToken()
      .then((token) => {
        if (active) observeToken(token);
      })
      .catch(() => {
        // A throw on cold start is still an immediate sign-out because
        // `hasSessionRef` is false; a throw once signed in enters the ladder.
        if (active) observeToken(null);
      });
    return () => {
      active = false;
    };
  }, [observeToken, tokenCache]);

  // Re-armed in the effect body, not only initialized at `useRef`, so a StrictMode
  // mount-unmount-mount cannot leave the provider permanently marked as unmounted.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearRevalidateTimer();
    };
  }, [clearRevalidateTimer]);

  const value = useMemo(
    () => ({
      ...profile,
      client,
      getToken,
      login,
      logout,
      setActive,
      workspaces,
    }),
    [client, getToken, login, logout, profile, setActive, workspaces],
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

function HubProtected({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, login } = useHubAuthContext();
  // The router location, not `window.location`: it is the app's own truth, identical
  // to the browser's under `BrowserRouter`, and testable without stubbing globals.
  const location = useLocation();
  const navigate = useNavigate();
  // The manual retry is the only thing that can change the loop guard's answer while
  // this component stays mounted, so it is the only thing that has to force a re-read.
  const [, recheckLoginGuard] = useReducer((ticks: number) => ticks + 1, 0);
  const restoredRef = useRef(false);
  const currentPath = `${location.pathname}${location.search}`;
  /**
   * Derived from the stored attempt counter, never mirrored into React state. A
   * `setLoginBlocked(true)` inside the login effect would create a second source of
   * truth for one fact and would be a synchronous setState in an effect body.
   */
  const loginBlocked = isLoaded && !isSignedIn && isLoginBlocked();

  useEffect(() => {
    // `restoredRef` plus consume-before-validate makes a StrictMode double effect inert.
    if (!isLoaded || !isSignedIn || restoredRef.current) return;
    restoredRef.current = true;
    const target = consumeReturnTo(currentOrigin());
    // `replace` so the post-callback root entry does not linger in history and send
    // the operator back to the dashboard on Back.
    if (target && target !== currentPath) navigate(target, { replace: true });
  }, [currentPath, isLoaded, isSignedIn, navigate]);

  useEffect(() => {
    if (!isLoaded || isSignedIn || loginBlocked) return;
    // Belt and braces: the render guard above already refuses, and `registerLoginAttempt`
    // refuses again here without incrementing, so the counter cannot run away.
    if (!registerLoginAttempt()) return;
    // CLAUDE.md, "Sales Ops Routing": the URL is the single source of truth for the
    // active workspace and page, so restoring the URL restores the screen.
    captureReturnTo(currentPath, currentOrigin());
    login();
  }, [currentPath, isLoaded, isSignedIn, login, loginBlocked]);

  if (loginBlocked) {
    return (
      <SessionRecoveryPanel
        onRetry={() => {
          // Clearing the counter flips `loginBlocked` back to false on the next render,
          // which re-arms the login effect. No direct `login()` call is needed.
          clearLoginAttempts();
          recheckLoginGuard();
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
