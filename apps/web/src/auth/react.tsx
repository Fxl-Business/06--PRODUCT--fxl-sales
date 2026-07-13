/* eslint-disable react-refresh/only-export-components */
import { createHubClient, type HubClient } from '@fxl-business/hub-sdk/client';
import { LogOut } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { getRoleFromHubClaims, getRolesFromHubClaims, parseJwtPayload, type AppRole } from './claims';
import { getHubBffBasePath, loadHubBrowserConfig } from './provider';
import { createHubAccessTokenCache } from './token';

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

const HubAuthContext = createContext<HubAuthState | null>(null);

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
  const [profile, setProfile] = useState<AuthProfile>({
    isLoaded: false,
    isSignedIn: false,
    roles: [],
  });
  const [workspaces, setWorkspaces] = useState<HubWorkspacePreview[]>([]);

  const applyToken = useCallback((token: string | null) => {
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

  const getToken = useCallback(async () => {
    const token = await tokenCache.getToken();
    applyToken(token);
    return token;
  }, [applyToken, tokenCache]);

  const login = useCallback(() => client.login(), [client]);

  const logout = useCallback(async () => {
    tokenCache.clear();
    applyToken(null);
    await client.logout();
  }, [applyToken, client, tokenCache]);

  const setActive = useCallback(
    async (workspaceId: string) => {
      const result = await client.setActive(workspaceId);
      tokenCache.seed(result.accessToken, result.expiresIn);
      applyToken(result.accessToken);
    },
    [applyToken, client, tokenCache],
  );

  useEffect(() => {
    let active = true;
    void tokenCache
      .getToken()
      .then((token) => {
        if (active) applyToken(token);
      })
      .catch(() => {
        if (active) applyToken(null);
      });
    return () => {
      active = false;
    };
  }, [applyToken, tokenCache]);

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

function HubProtected({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, login } = useHubAuthContext();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      login();
    }
  }, [isLoaded, isSignedIn, login]);

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
        <select
          aria-label="Workspace"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          defaultValue={workspaces.find((workspace) => workspace.name === workspaceName)?.id}
          onChange={(event) => {
            void setActive(event.target.value);
          }}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name ?? workspace.id}
            </option>
          ))}
        </select>
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
