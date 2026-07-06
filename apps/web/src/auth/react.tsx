/* eslint-disable react-refresh/only-export-components */
import { ClerkProvider, OrganizationSwitcher, RedirectToSignIn, SignedIn, SignedOut, UserButton, useAuth as useClerkAuth, useClerk, useUser as useClerkUser } from '@clerk/clerk-react';
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
import { getRoleFromHubClaims, parseJwtPayload, type AppRole } from './claims';
import { getHubBffBasePath, loadHubBrowserConfig, loadWebAuthProvider } from './provider';

type AuthProfile = {
  isLoaded: boolean;
  isSignedIn: boolean;
  role?: AppRole;
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

const webAuthProvider = loadWebAuthProvider(import.meta.env);
const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

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
    return { workspaces: [] };
  }

  return {
    role: getRoleFromHubClaims(claims),
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
  const [profile, setProfile] = useState<AuthProfile>({
    isLoaded: false,
    isSignedIn: false,
  });
  const [workspaces, setWorkspaces] = useState<HubWorkspacePreview[]>([]);

  const applyToken = useCallback((token: string | null) => {
    const next = profileFromToken(token);
    setWorkspaces(next.workspaces);
    setProfile({
      isLoaded: true,
      isSignedIn: token !== null,
      role: next.role,
      name: next.name,
      email: next.email,
      avatarUrl: next.avatarUrl,
      workspaceName: next.workspaceName,
    });
  }, []);

  const getToken = useCallback(async () => {
    const token = await client.getToken();
    applyToken(token);
    return token;
  }, [applyToken, client]);

  const login = useCallback(() => client.login(), [client]);

  const logout = useCallback(async () => {
    await client.logout();
    applyToken(null);
  }, [applyToken, client]);

  const setActive = useCallback(
    async (workspaceId: string) => {
      const result = await client.setActive(workspaceId);
      applyToken(result.accessToken);
    },
    [applyToken, client],
  );

  useEffect(() => {
    let active = true;
    void client
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
  }, [applyToken, client]);

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

function ClerkAppAuthProvider({ children }: { children: ReactNode }) {
  if (!clerkPublishableKey) {
    console.warn(
      '[fxl-sales] VITE_CLERK_PUBLISHABLE_KEY not set. Edit apps/web/.env to add the key.',
    );
  }

  return (
    <ClerkProvider publishableKey={clerkPublishableKey ?? 'pk_test_missing'}>
      {children}
    </ClerkProvider>
  );
}

function ClerkProtected({ children }: { children: ReactNode }) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
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

function useClerkAccessToken(): { getToken: () => Promise<string | null> } {
  const { getToken } = useClerkAuth();
  return { getToken };
}

function useHubAccessToken() {
  const { getToken } = useHubAuthContext();
  return { getToken };
}

function useClerkProfile(): AuthProfile {
  const { isLoaded, isSignedIn, user } = useClerkUser();
  const role = user?.publicMetadata?.role as AppRole | undefined;
  return {
    isLoaded,
    isSignedIn: isSignedIn ?? false,
    role,
    name: user?.fullName ?? undefined,
    email: user?.primaryEmailAddress?.emailAddress,
    avatarUrl: user?.imageUrl,
  };
}

function useHubProfile(): AuthProfile {
  const { isLoaded, isSignedIn, role, name, email, avatarUrl, workspaceName } =
    useHubAuthContext();
  return { isLoaded, isSignedIn, role, name, email, avatarUrl, workspaceName };
}

function useClerkLogout(): () => Promise<void> {
  const { signOut } = useClerk();
  return async () => {
    await signOut();
  };
}

function useHubLogout(): () => Promise<void> {
  const { logout } = useHubAuthContext();
  return logout;
}

function ClerkUserControls() {
  return (
    <>
      <OrganizationSwitcher
        appearance={{
          elements: {
            rootBox: 'flex items-center',
          },
        }}
      />
      <UserButton afterSignOutUrl="/" />
    </>
  );
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

export const AppAuthProvider = webAuthProvider === 'hub' ? HubAuthProvider : ClerkAppAuthProvider;
export const Protected = webAuthProvider === 'hub' ? HubProtected : ClerkProtected;
export const useAccessToken: AccessTokenHook =
  webAuthProvider === 'hub' ? useHubAccessToken : useClerkAccessToken;
export const useAuthProfile = webAuthProvider === 'hub' ? useHubProfile : useClerkProfile;
export const useLogout: LogoutHook = webAuthProvider === 'hub' ? useHubLogout : useClerkLogout;
export const UserControls = webAuthProvider === 'hub' ? HubUserControls : ClerkUserControls;
