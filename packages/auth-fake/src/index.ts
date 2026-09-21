/**
 * @fxl-sales/auth-fake
 *
 * DEVELOPMENT ONLY. This package is a devDependency wherever it is declared, never a
 * dependency, and it is reached only through a dynamic `import('@fxl-sales/auth-fake')`.
 * Nothing in this slice wires it up: no shipped source imports it, and a build-time bundle
 * check (slice 05's `scripts/assert-web-bundle-clean.mjs`) fails the build if it ever leaks
 * into `apps/web/dist`.
 *
 * WHY IT EMITS CLAIMS, NEVER A READY-MADE PROFILE. This package deliberately does not export
 * an `AppRole[]`, a `SalesOpsWorkspace[]`, or any other pre-translated shape. It emits
 * Hub-SHAPED claims, the exact wire shape a real Hub access token carries, so that both
 * downstream halves run their REAL translation over it instead of bypassing it: the API
 * verifies and reads these claims the way `requireHubAuth` would, and the web decodes them
 * with `parseJwtPayload` and then runs the real `getRolesFromHubClaims` and
 * `getVisibleWorkspaces`. A fake that skipped straight to a profile would never exercise the
 * translation code that is most likely to break when the Hub contract moves.
 *
 * F1 - contractVersion is always the number 1. `@fxl-business/hub-sdk@2.3.0`'s `requireHubAuth`
 * answers 401 `contract_version_mismatch` to anything else, including an absent value, so a
 * fixture that omitted or varied it would model a token the real path refuses.
 *
 * F3 - THE ADMIN-ONLY ROLE SET IS UNREACHABLE, and that is a finding rather than a gap. Read
 * literally, `getRolesFromHubClaims` in `apps/web/src/auth/claims.ts` returns the full-access
 * array `['admin', 'seller', 'finder']` from every branch that can yield `admin` at all (the
 * workspace `owner` branch, the workspace `admin` branch, the `isSuperAdmin` branch, and the
 * `productRoles.has('admin')` branch); the only other return is a filter over `seller` and
 * `finder`. There is therefore no claim shape that produces the role set `['admin']` alone, and
 * faking that role set directly (bypassing the translation) would model a state the real app
 * can never reach. This roster instead carries three separate identities that reach the
 * full-access set by three DIFFERENT claim shapes (workspace `owner`, workspace `admin`,
 * `productRoles: ['admin']`), so each of the three literals in `getRolesFromHubClaims` has a
 * fixture standing on it, and it records in a named test that no fixture declares `['admin']`
 * alone.
 *
 * F5 - `entitlements.modules` is empty for every identity on purpose: modules carry ADD-ON
 * products only and must never be read for baseline access, so every fixture proves Effective
 * Access is readable with an empty `modules` array.
 */

/** The Hub-authoritative Organization role, matching the SDK's HubWorkspaceRole. */
export type FakeWorkspaceRole = 'owner' | 'admin' | 'member';

/** An app role as `getRolesFromHubClaims` returns it. Declared locally on purpose: this
 *  package imports NOTHING, and apps/web owns the real type. */
export type FakeAppRole = 'admin' | 'seller' | 'finder';

/** A Sales painel id as `getVisibleWorkspaces` returns it. Declared locally, same reason. */
export type FakeSalesPainel = 'tatico' | 'operacional' | 'cadastros' | 'meus-dados';

/** One Organization membership, in the Hub's wire shape (keyed `workspaceId`, never `id`). */
export interface FakeWorkspace {
  workspaceId: string;
  name: string;
  role: FakeWorkspaceRole;
  /** Application ids this Organization has live access to. Display-only. */
  products: string[];
}

export interface FakeIdentity {
  /** Stable switch key. This is what the dev switcher stores and sends. */
  id: string;
  /** Short human label for the picker. */
  label: string;
  /** What branch this identity exists to make reachable. Shown as help in the picker. */
  exercises: string;
  accountId: string;
  /** The ACTIVE Organization. MUST appear in `workspaces`. */
  activeWorkspaceId: string;
  /** Effective Access of the ACTIVE Organization. Carried EXPLICITLY, never derived. */
  hasAccess: boolean;
  /** ADD-ON module ids only. Empty for every fixture today - see the docblock. */
  modules: string[];
  /** The Hub Organization role in the ACTIVE Organization. */
  workspaceRole: FakeWorkspaceRole;
  /** This Application's own Seat roles. Absent means an unseated person. */
  productRoles?: string[];
  isSuperAdmin?: boolean;
  profile: { name: string; email: string };
  workspaces: FakeWorkspace[];
  /** What `getRolesFromHubClaims` MUST return for this identity, in that exact order.
   *  A DECLARED expectation, cross-checked against the real function by slice 03. */
  expectedRoles: readonly FakeAppRole[];
  /** What `getVisibleWorkspaces(expectedRoles)` MUST return, in that exact order. */
  expectedPaineis: readonly FakeSalesPainel[];
}

/** The FXL Sales Application id, which is also the token Audience. */
export const SALES_APPLICATION = 'app.fxl-sales';

/** The display-only Organization preview cap the Hub applies to the `workspaces` claim. */
export const WORKSPACES_CLAIM_CAP = 40;

/** How long a minted development token claims to live. */
export const DEV_TOKEN_TTL_SECONDS = 15 * 60;

/** The issuer a minted development token names. Never a real Hub issuer. */
export const DEV_TOKEN_ISSUER = 'fxl-sales-auth-fake';

/** The placeholder occupying the signature segment. It is not a signature and never was. */
export const DEV_TOKEN_SIGNATURE = 'development-not-a-signature';

/** A unique literal that exists ONLY so slice 05's build-time bundle check has something
 *  unambiguous to look for in `apps/web/dist`. It is exported and referenced by the module
 *  docblock so a tree-shaker cannot drop it from the package source. */
export const FXL_SALES_DEV_FAKE_ROSTER_SENTINEL = 'FXL_SALES_DEV_FAKE_ROSTER_SENTINEL';

/** Builds one Organization membership in the Hub's wire shape. */
function workspace(
  workspaceId: string,
  name: string,
  role: FakeWorkspaceRole = 'owner',
  products: string[] = [SALES_APPLICATION],
): FakeWorkspace {
  return { workspaceId, name, role, products: [...products] };
}

/** Clones an Organization membership with a different role, for an identity whose own
 *  standing in that Organization differs from the Organization's own default fixture role. */
function asRole(org: FakeWorkspace, role: FakeWorkspaceRole): FakeWorkspace {
  return { ...org, role };
}

// Three Organizations, and exactly three. No accented characters in the org NAMES: these
// strings travel through a hand-rolled base64url minter and a hand-rolled base64 decoder, and
// keeping them ASCII removes an entire class of encoding question from a development fixture.
const NORTE = workspace('org_fake_norte', 'Agencia Norte'); // entitled, the everyday org
const SUL = workspace('org_fake_sul', 'Consultoria Sul'); // entitled, the switch target
const SEM = workspace('org_fake_sem_acesso', 'Marca Sem Acesso', 'member', []); // NOT entitled

// Nine identities, in this exact order. IDENTITIES[0] is the everyday driver, so
// DEFAULT_IDENTITY_ID needs no separate concept.
export const IDENTITIES: readonly FakeIdentity[] = [
  // 1. team-owner - the everyday path, and the `workspaceRole === 'owner'` literal in
  //    `getRolesFromHubClaims`.
  {
    id: 'team-owner',
    label: 'Ana (dona da organizacao)',
    exercises: 'papel owner da organizacao ativa: acesso total, todos os quatro paineis',
    accountId: 'user_fake_ana',
    activeWorkspaceId: NORTE.workspaceId,
    hasAccess: true,
    modules: [],
    workspaceRole: 'owner',
    profile: { name: 'Ana Diretora', email: 'ana@fake.local' },
    workspaces: [NORTE],
    expectedRoles: ['admin', 'seller', 'finder'],
    expectedPaineis: ['tatico', 'operacional', 'cadastros', 'meus-dados'],
  },
  // 2. team-admin - the `workspaceRole === 'admin'` literal, which is a SEPARATE disjunct:
  //    deleting it leaves fixture 1 green, so it needs its own fixture.
  {
    id: 'team-admin',
    label: 'Bruno (admin da organizacao)',
    exercises: 'papel admin da organizacao ativa: acesso total, todos os quatro paineis',
    accountId: 'user_fake_bruno',
    activeWorkspaceId: NORTE.workspaceId,
    hasAccess: true,
    modules: [],
    workspaceRole: 'admin',
    profile: { name: 'Bruno Administrador', email: 'bruno@fake.local' },
    workspaces: [asRole(NORTE, 'admin')],
    expectedRoles: ['admin', 'seller', 'finder'],
    expectedPaineis: ['tatico', 'operacional', 'cadastros', 'meus-dados'],
  },
  // 3. product-admin - the `productRoles.has('admin')` early return, the third and last way to
  //    reach the full-access set, and the only one that does it from a workspace `member`.
  {
    id: 'product-admin',
    label: 'Carla (papel admin do produto)',
    exercises: 'Seat admin do produto a partir de um membro comum: acesso total mesmo sem ser dona ou admin da organizacao',
    accountId: 'user_fake_carla',
    activeWorkspaceId: NORTE.workspaceId,
    hasAccess: true,
    modules: [],
    workspaceRole: 'member',
    productRoles: ['admin'],
    profile: { name: 'Carla Produto', email: 'carla@fake.local' },
    workspaces: [asRole(NORTE, 'member')],
    expectedRoles: ['admin', 'seller', 'finder'],
    expectedPaineis: ['tatico', 'operacional', 'cadastros', 'meus-dados'],
  },
  // 4. seller - seller-only: sees ONLY meus-dados and lands on meus-dados/vendedores, which is
  //    meusDadosSeller[0] in apps/web/src/sales-ops/navigation.ts.
  {
    id: 'seller',
    label: 'Diego (somente vendedor)',
    exercises: 'somente Seat vendedor: ve apenas meus-dados',
    accountId: 'user_fake_diego',
    activeWorkspaceId: NORTE.workspaceId,
    hasAccess: true,
    modules: [],
    workspaceRole: 'member',
    productRoles: ['seller'],
    profile: { name: 'Diego Vendedor', email: 'diego@fake.local' },
    workspaces: [asRole(NORTE, 'member')],
    expectedRoles: ['seller'],
    expectedPaineis: ['meus-dados'],
  },
  // 5. finder - finder-only: sees ONLY meus-dados and lands on meus-dados/finders, which is
  //    meusDadosFinder[0].
  {
    id: 'finder',
    label: 'Elena (somente finder)',
    exercises: 'somente Seat finder: ve apenas meus-dados',
    accountId: 'user_fake_elena',
    activeWorkspaceId: NORTE.workspaceId,
    hasAccess: true,
    modules: [],
    workspaceRole: 'member',
    productRoles: ['finder'],
    profile: { name: 'Elena Finder', email: 'elena@fake.local' },
    workspaces: [asRole(NORTE, 'member')],
    expectedRoles: ['finder'],
    expectedPaineis: ['meus-dados'],
  },
  // 6. seller-finder - both product roles at once, which merges the two meus-dados nav lists
  //    and is a distinct navigation branch from either 4 or 5.
  {
    id: 'seller-finder',
    label: 'Fabio (vendedor e finder)',
    exercises: 'Seats vendedor e finder ao mesmo tempo: meus-dados combinado',
    accountId: 'user_fake_fabio',
    activeWorkspaceId: NORTE.workspaceId,
    hasAccess: true,
    modules: [],
    workspaceRole: 'member',
    productRoles: ['seller', 'finder'],
    profile: { name: 'Fabio Duplo', email: 'fabio@fake.local' },
    workspaces: [asRole(NORTE, 'member')],
    expectedRoles: ['seller', 'finder'],
    expectedPaineis: ['meus-dados'],
  },
  // 7. no-role - lands on /no-role. It carries productRoles: ['viewer'] rather than []
  //    DELIBERATELY: an UNRECOGNIZED role is strictly stronger than an empty list, because it
  //    proves productRoleOrder.filter DROPS what it does not know rather than merely that
  //    nothing filters to nothing, and it is exactly the case CLAUDE.md's NoRoleGuard oracle
  //    "keeps the unauthorized screen for a role the app does not recognize, and does not
  //    ping-pong" is about.
  {
    id: 'no-role',
    label: 'Gisele (sem papel reconhecido)',
    exercises: 'Seat com papel que o app nao reconhece: cai em /no-role',
    accountId: 'user_fake_gisele',
    activeWorkspaceId: NORTE.workspaceId,
    hasAccess: true,
    modules: [],
    workspaceRole: 'member',
    productRoles: ['viewer'],
    profile: { name: 'Gisele Sem Papel', email: 'gisele@fake.local' },
    workspaces: [asRole(NORTE, 'member')],
    expectedRoles: [],
    expectedPaineis: [],
  },
  // 8. no-access - entitlements.access: false, so requireHubAuth answers 402 and the shell must
  //    render MissingEntitlementPanel rather than the generic "Verifique o servidor local"
  //    copy. Its workspaces carries NORTE as a second entry on purpose: useOrganizations
  //    derives `others` as workspaces.filter((w) => w.id !== active?.id), and the panel offers
  //    switching BEFORE checkout, so a single-Organization fixture would leave the panel's
  //    primary escape unrendered and untested. It keeps productRoles: ['seller'] so that the
  //    402 is provably about the ORGANIZATION and not about the person having no role - the two
  //    dead ends look identical on screen otherwise.
  {
    id: 'no-access',
    label: 'Heitor (organizacao sem acesso)',
    exercises: 'a organizacao ativa nao carrega acesso: 402 e MissingEntitlementPanel, com outra organizacao para onde trocar',
    accountId: 'user_fake_heitor',
    activeWorkspaceId: SEM.workspaceId,
    hasAccess: false,
    modules: [],
    workspaceRole: 'member',
    productRoles: ['seller'],
    profile: { name: 'Heitor Sem Acesso', email: 'heitor@fake.local' },
    workspaces: [SEM, asRole(NORTE, 'member')],
    expectedRoles: ['seller'],
    expectedPaineis: ['meus-dados'],
  },
  // 9. multi-org - two ENTITLED Organizations, so the account dropdown's Organization section
  //    renders and setActive plus its queryClient.clear() critical section is reachable.
  //    Fixture 8 is also multi-Organization but is stuck at 402, so it can never exercise a
  //    SUCCESSFUL switch. A separate multi-org fixture is therefore warranted.
  {
    id: 'multi-org',
    label: 'Iris (duas organizacoes)',
    exercises: 'duas organizacoes com acesso: troca de organizacao bem sucedida no dropdown',
    accountId: 'user_fake_iris',
    activeWorkspaceId: NORTE.workspaceId,
    hasAccess: true,
    modules: [],
    workspaceRole: 'owner',
    profile: { name: 'Iris Multi', email: 'iris@fake.local' },
    workspaces: [NORTE, SUL],
    expectedRoles: ['admin', 'seller', 'finder'],
    expectedPaineis: ['tatico', 'operacional', 'cadastros', 'meus-dados'],
  },
];

/** The identity a session adopts when none was named. */
export const DEFAULT_IDENTITY_ID: string = IDENTITIES[0]!.id;

/** Look up by switch key. Returns undefined for an unknown key, never a guess. */
export function findIdentity(id: string | undefined | null): FakeIdentity | undefined {
  if (!id) {
    return undefined;
  }
  return IDENTITIES.find((identity) => identity.id === id);
}

/** Look up by the account id a token carries. This is what lets the browser send an ordinary
 *  bearer and the API recover which fixture it was, with no dev-only header. */
export function findIdentityByAccountId(
  accountId: string | undefined | null,
): FakeIdentity | undefined {
  if (!accountId) {
    return undefined;
  }
  return IDENTITIES.find((identity) => identity.accountId === accountId);
}

/** Options every claim producer takes. One object, so the three cannot drift apart. */
export interface FakeClaimOptions {
  nowSeconds?: number;
  /** Adopt a DIFFERENT active Organization than `identity.activeWorkspaceId`. IGNORED, never
   *  honoured, when it is not a member of `identity.workspaces`. */
  organizationId?: string;
}

/** Resolves which Organization a claim set is minted for. An `organizationId` the identity does
 *  not belong to is IGNORED and the identity's own active Organization is used instead. That is
 *  a membership RAIL and not a convenience: `identityHasWorkspace` is the same predicate
 *  exported for the API middleware, so the browser and the API refuse the same values. */
function resolveActiveWorkspace(identity: FakeIdentity, requested: string | undefined): FakeWorkspace {
  const own = identity.workspaces.find((entry) => entry.workspaceId === identity.activeWorkspaceId);
  if (!own) {
    throw new Error(
      `auth-fake: identity "${identity.id}" is not a member of its own active organization "${identity.activeWorkspaceId}"`,
    );
  }
  if (!requested) {
    return own;
  }
  return identity.workspaces.find((entry) => entry.workspaceId === requested) ?? own;
}

/** The FULL contract-v1 claim set a Hub access token would carry for this identity. */
export function toHubClaims(identity: FakeIdentity, options?: FakeClaimOptions): Record<string, unknown> {
  const nowSeconds = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
  const active = resolveActiveWorkspace(identity, options?.organizationId);

  return {
    iss: DEV_TOKEN_ISSUER,
    aud: SALES_APPLICATION,
    sub: identity.accountId,
    workspaceId: active.workspaceId,
    contractVersion: 1,
    entitlements: {
      access: active.products.includes(SALES_APPLICATION),
      modules: [...identity.modules],
    },
    roles: {
      workspace: identity.workspaceRole,
      ...(identity.productRoles ? { productRoles: [...identity.productRoles] } : {}),
    },
    typ: 'at+jwt',
    iat: nowSeconds,
    exp: nowSeconds + DEV_TOKEN_TTL_SECONDS,
    jti: `dev-${identity.id}-${nowSeconds}`,
    name: identity.profile.name,
    email: identity.profile.email,
    ...(identity.isSuperAdmin ? { isSuperAdmin: true } : {}),
    ...(active ? { workspaceName: active.name } : {}),
    workspaces: identity.workspaces.slice(0, WORKSPACES_CLAIM_CAP),
  };
}

/** The verified-context shape `requireHubAuth` would expose as `c.get('hubAuth')`. */
export interface FakeHubAuthContext {
  accountId: string;
  workspaceId: string;
  entitlements: { access: boolean; modules: string[] };
  roles: { workspace: FakeWorkspaceRole; productRoles?: string[] };
  aud: string;
  claims: Record<string, unknown>;
}

/** Projects `toHubClaims`'s own output into the shape `requireHubAuth` exposes. `claims` is the
 *  same object `toHubClaims` returned, never a rebuild, so the API half and the browser half
 *  cannot drift apart. */
export function toHubAuthContext(identity: FakeIdentity, options?: FakeClaimOptions): FakeHubAuthContext {
  const claims = toHubClaims(identity, options);
  const entitlements = claims.entitlements as { access: boolean; modules: string[] };
  const roles = claims.roles as { workspace: FakeWorkspaceRole; productRoles?: string[] };
  return {
    accountId: claims.sub as string,
    workspaceId: claims.workspaceId as string,
    entitlements,
    roles,
    aud: claims.aud as string,
    claims,
  };
}

/** Encodes a UTF-8 string as base64url, using only DOM globals available in Node and the
 *  browser alike: TextEncoder, then btoa. No Buffer, ever. */
function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A structurally valid JWT with a PLACEHOLDER signature. It is never verified by anything;
 *  its only job is to decode the same way a real access token would. */
export function mintDevToken(identity: FakeIdentity, options?: FakeClaimOptions): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'at+jwt' }));
  const payload = base64UrlEncode(JSON.stringify(toHubClaims(identity, options)));
  return `${header}.${payload}.${DEV_TOKEN_SIGNATURE}`;
}

/** Decodes a base64url string back to UTF-8 text, the inverse of `base64UrlEncode`. */
function base64UrlDecode(value: string): string {
  const restored = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = restored.padEnd(Math.ceil(restored.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Decodes a token's middle segment into a JSON object, verifying NOTHING. Returns null for
 *  anything that is not three parts with a non-empty middle part, anything that does not
 *  base64url-decode, anything that is not valid JSON, and anything whose JSON is not a plain
 *  object. */
function decodeTokenPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const payloadPart = parts[1];
  if (!payloadPart) {
    return null;
  }
  try {
    const decoded = base64UrlDecode(payloadPart);
    const parsed: unknown = JSON.parse(decoded);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Reads `sub` out of a token payload without verifying anything. Null for anything else. */
export function readTokenSubject(token: string | null | undefined): string | null {
  const payload = decodeTokenPayload(token);
  if (!payload) {
    return null;
  }
  const sub = payload.sub;
  return typeof sub === 'string' ? sub : null;
}

/** Reads `workspaceId` out of a token payload without verifying anything. Null for anything
 *  else. It is the twin of `readTokenSubject` and shares its whole decode path. */
export function readTokenWorkspaceId(token: string | null | undefined): string | null {
  const payload = decodeTokenPayload(token);
  if (!payload) {
    return null;
  }
  const workspaceId = payload.workspaceId;
  return typeof workspaceId === 'string' ? workspaceId : null;
}

/** Is this Organization one the identity actually belongs to. The membership RAIL. */
export function identityHasWorkspace(identity: FakeIdentity, workspaceId: string): boolean {
  return identity.workspaces.some((entry) => entry.workspaceId === workspaceId);
}

/** Every distinct org id the roster references - what the seed slice must create. Collected
 *  from `workspaces` and NOT from `activeWorkspaceId`, because the roster coherence guarantees
 *  the active one is always a member, and a second source would be a second thing to keep in
 *  sync. The order is first-seen across IDENTITIES and is NOT part of the contract. */
export function allFakeOrgIds(): string[] {
  const seen = new Set<string>();
  for (const identity of IDENTITIES) {
    for (const entry of identity.workspaces) {
      seen.add(entry.workspaceId);
    }
  }
  return [...seen];
}
