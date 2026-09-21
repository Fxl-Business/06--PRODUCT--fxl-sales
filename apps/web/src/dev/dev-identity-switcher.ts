/**
 * The floating dev identity switcher: imperative DOM, mounted on
 * `document.body`, entirely OUTSIDE the React root.
 *
 * WHY OUTSIDE THE REACT ROOT. Two screens the roster exists to reach replace
 * the whole subtree: an identity with zero recognized roles lands on
 * `/no-role`, and an identity whose Organization carries no access renders
 * `MissingEntitlementPanel`. A switcher living inside the app tree would be
 * unmounted by exactly the two screens it exists to get the developer out
 * of, and a switcher inside `Protected` would additionally vanish behind the
 * Skeleton. Mounted on `document.body` it is reachable from every screen the
 * roster can produce, including the signed-out and forbidden panels too.
 *
 * It also never enters the React tree, so it cannot perturb component state
 * or a re-render while a developer is debugging exactly that, and it stays
 * out of `src/i18n/**` because it is not product copy.
 *
 * The UI-controls ban applies in full: no `select`, no `option`, no
 * `datalist`, in JSX or through `document.createElement` - see
 * `dev-identity-isolation.test.ts`'s source scan, which closes the gap the
 * JSX-only ESLint selector leaves open. `Combobox` is deliberately NOT used
 * either: it is a React component, and this widget is outside the React
 * root by design. Search is implemented directly instead.
 */

export interface DevIdentityOption {
  id: string;
  label: string;
  exercises: string;
}

const HOST_ID = 'fxl-sales-dev-identity-switcher';
const COLLAPSED_STORAGE_KEY = 'fxl-sales.dev-identity.collapsed';

function readCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    // Absent means "never asked" - defaults to collapsed.
    return stored === null ? true : stored === '1';
  } catch {
    return true;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // Absorbed. A developer preference is not worth failing anything over.
  }
}

/** Case- and accent-folded, for term-by-term search over label plus `exercises`. */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function matches(option: DevIdentityOption, query: string): boolean {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fold(`${option.label} ${option.exercises} ${option.id}`);
  return terms.every((term) => haystack.includes(term));
}

type MountState = {
  host: HTMLDivElement;
  pill: HTMLButtonElement;
  panel: HTMLDivElement;
  searchInput: HTMLInputElement;
  list: HTMLDivElement;
  identities: readonly DevIdentityOption[];
  activeId: string;
  onSelect: (id: string) => void;
  collapsed: boolean;
};

// Module-scoped so a second `mountDevIdentitySwitcher` call - a hot reload
// re-running `install-dev-identity.ts` - updates the SAME DOM instead of
// stacking a second one.
let mounted: MountState | null = null;

function setCollapsed(state: MountState, collapsed: boolean): void {
  state.collapsed = collapsed;
  writeCollapsed(collapsed);
  state.panel.style.display = collapsed ? 'none' : 'flex';
  state.pill.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

function activeLabel(state: MountState): string {
  const active = state.identities.find((identity) => identity.id === state.activeId);
  return active?.label ?? state.activeId;
}

function renderPill(state: MountState): void {
  state.pill.textContent = `Dev: ${activeLabel(state)}`;
}

/**
 * Rebuilds the row list. Called only when the FILTER changes (or on mount),
 * never on hover: a browser fires `click` only when mousedown and mouseup
 * land on the same element, and a list that rebuilds on `mouseenter`
 * destroys the row under the cursor, silently turning a click into nothing.
 * Highlighting on hover instead mutates the existing row's own style, in
 * `attachRow` below.
 */
function renderList(state: MountState, query: string): void {
  state.list.replaceChildren();
  const visible = state.identities.filter((identity) => matches(identity, query));
  for (const identity of visible) {
    state.list.append(buildRow(state, identity));
  }
  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'Nenhuma identidade encontrada.';
    empty.style.padding = '8px';
    empty.style.color = '#9a9aa2';
    empty.style.fontSize = '12px';
    state.list.append(empty);
  }
}

function buildRow(state: MountState, identity: DevIdentityOption): HTMLDivElement {
  const row = document.createElement('div');
  row.setAttribute('role', 'button');
  row.setAttribute('data-identity-id', identity.id);
  row.tabIndex = 0;
  row.style.cursor = 'pointer';
  row.style.padding = '6px 8px';
  row.style.borderRadius = '6px';
  const isActive = identity.id === state.activeId;
  row.style.background = isActive ? '#2a2a33' : 'transparent';
  row.style.display = 'flex';
  row.style.flexDirection = 'column';
  row.style.gap = '2px';

  const primary = document.createElement('div');
  primary.textContent = identity.label;
  primary.style.fontSize = '13px';
  primary.style.fontWeight = isActive ? '600' : '400';
  primary.style.color = '#f5f5f7';

  const secondary = document.createElement('div');
  secondary.textContent = identity.exercises;
  secondary.style.fontSize = '11px';
  secondary.style.color = '#9a9aa2';

  row.append(primary, secondary);

  // Hover highlight MUTATES this same node, never rebuilds the list - see
  // `renderList`'s docblock for why a rebuild on hover breaks the click.
  row.addEventListener('mouseenter', () => {
    row.style.background = '#38383f';
  });
  row.addEventListener('mouseleave', () => {
    row.style.background = identity.id === state.activeId ? '#2a2a33' : 'transparent';
  });
  row.addEventListener('click', () => {
    state.onSelect(identity.id);
  });

  return row;
}

function buildDom(
  identities: readonly DevIdentityOption[],
  activeId: string,
  onSelect: (id: string) => void,
): MountState {
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.position = 'fixed';
  host.style.bottom = '16px';
  host.style.right = '16px';
  host.style.zIndex = '2147483647';
  host.style.fontFamily = 'ui-sans-serif, system-ui, sans-serif';
  host.style.display = 'flex';
  host.style.flexDirection = 'column';
  host.style.alignItems = 'flex-end';
  host.style.gap = '8px';

  const pill = document.createElement('button');
  pill.type = 'button';
  pill.setAttribute('data-testid', 'dev-identity-pill');
  pill.setAttribute('aria-expanded', 'false');
  pill.style.borderRadius = '999px';
  pill.style.padding = '6px 12px';
  pill.style.background = '#111114';
  pill.style.color = '#f5f5f7';
  pill.style.border = '1px solid #38383f';
  pill.style.fontSize = '12px';
  pill.style.cursor = 'pointer';
  pill.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';

  const panel = document.createElement('div');
  panel.setAttribute('data-testid', 'dev-identity-panel');
  panel.style.display = 'none';
  panel.style.flexDirection = 'column';
  panel.style.gap = '6px';
  panel.style.width = '280px';
  panel.style.maxHeight = '360px';
  panel.style.overflowY = 'auto';
  panel.style.background = '#18181b';
  panel.style.border = '1px solid #38383f';
  panel.style.borderRadius = '10px';
  panel.style.padding = '8px';
  panel.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Buscar identidade...';
  searchInput.style.padding = '6px 8px';
  searchInput.style.borderRadius = '6px';
  searchInput.style.border = '1px solid #38383f';
  searchInput.style.background = '#0f0f11';
  searchInput.style.color = '#f5f5f7';
  searchInput.style.fontSize = '12px';

  const list = document.createElement('div');
  list.setAttribute('data-testid', 'dev-identity-list');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '2px';

  panel.append(searchInput, list);
  host.append(pill, panel);
  document.body.append(host);

  const state: MountState = {
    host,
    pill,
    panel,
    searchInput,
    list,
    identities,
    activeId,
    onSelect,
    collapsed: readCollapsed(),
  };

  pill.addEventListener('click', () => {
    setCollapsed(state, !state.collapsed);
  });

  searchInput.addEventListener('input', () => {
    renderList(state, searchInput.value);
  });

  return state;
}

/**
 * Mounts (or, on a hot reload, updates in place) the switcher. IDEMPOTENT,
 * keyed on `HOST_ID`, so calling this twice never stacks a second copy.
 */
export function mountDevIdentitySwitcher(
  identities: readonly DevIdentityOption[],
  activeId: string,
  onSelect: (id: string) => void,
): void {
  if (mounted && document.body.contains(mounted.host)) {
    mounted.identities = identities;
    mounted.activeId = activeId;
    mounted.onSelect = onSelect;
    renderPill(mounted);
    renderList(mounted, mounted.searchInput.value);
    return;
  }

  const existingHost = document.getElementById(HOST_ID);
  if (existingHost) {
    existingHost.remove();
  }

  const state = buildDom(identities, activeId, onSelect);
  mounted = state;
  renderPill(state);
  renderList(state, '');
  setCollapsed(state, state.collapsed);
}
