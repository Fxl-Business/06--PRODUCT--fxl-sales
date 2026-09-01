/**
 * Every user facing string the forbidden panel can render.
 *
 * Its OWN module, and not a const beside the component, because
 * `react-refresh/only-export-components` is configured with `allowConstantExport`
 * and that option covers a primitive literal only: an exported `as const` OBJECT
 * still trips it. Same escape as `missing-entitlement-copy.ts` beside it.
 *
 * Exported so the oracle imports the exact same literals the component renders: a
 * copy edit then moves the assertion with it instead of silently desynchronising it.
 *
 * It NAMES NO MODULE AND NO ROLE, deliberately. A 403 body is not something this app
 * can render trustworthily: the `code` is a machine token, the `module` field is a
 * Hub-internal identifier, and the identifier law in `CLAUDE.md` keeps raw ids out of
 * user-facing copy. "Peça a quem administra" is the whole of what this app knows.
 *
 * "Organização" everywhere and never "workspace", for the reason
 * `missing-entitlement-copy.ts` gives: "Workspace" already names a SALES INTERNAL
 * view group in `navigation.ts`.
 */
export const FORBIDDEN_COPY = {
  title: 'Permissão insuficiente',
  body: 'Você está conectado, mas esta conta não tem a permissão necessária para esta ação nesta Organização. Peça a quem administra a Organização no FXL Hub para liberar o seu acesso.',
  note: 'Você continua conectado, não é preciso entrar novamente.',
} as const;
