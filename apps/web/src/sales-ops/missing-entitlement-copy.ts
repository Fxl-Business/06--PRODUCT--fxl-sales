/**
 * Every user facing string this panel can render.
 *
 * Its OWN module, and not a const beside the component, because
 * `react-refresh/only-export-components` is configured with `allowConstantExport`
 * and that option covers a primitive literal only: an exported `as const` OBJECT
 * still trips it. This is the same escape `combobox-filter.ts` already took.
 *
 * Exported so the oracle imports the exact same literals the component renders: a
 * copy edit then moves the assertion with it instead of silently desynchronising it.
 *
 * "Organização" everywhere and never "workspace", because "Workspace" already names
 * a SALES INTERNAL view group in `navigation.ts`, and one word for two concepts is
 * how the sidebar came to read as an Organization picker in the first place.
 */
export const MISSING_ENTITLEMENT_COPY = {
  title: 'FXL Sales não está ativo nesta Organização',
  activePrefix: 'A Organização ativa nesta sessão é ',
  activeSuffix: ', e o FXL Sales não está liberado para ela.',
  activeUnknown:
    'Não foi possível identificar a Organização ativa nesta sessão, e o FXL Sales não está liberado para ela.',
  leadWithOthers:
    'Troque para uma Organização que tenha o FXL Sales, ou contrate o FXL Sales para a Organização ativa no FXL Hub.',
  leadWithoutOthers:
    'Não encontramos outra Organização nesta conta para onde trocar. Contrate o FXL Sales para a Organização ativa no FXL Hub.',
  switchHeading: 'Trocar de Organização',
  switchAriaLabel: 'Organização',
  switchPlaceholder: 'Selecionar Organização...',
  switchSearchPlaceholder: 'Buscar Organização...',
  switchEmptyMessage: 'Nenhuma Organização encontrada.',
  switchSinglePrefix: 'Ir para ',
  switching: 'Trocando de Organização...',
  switchFailed:
    'Não foi possível trocar de Organização. Verifique se você ainda faz parte dela e tente novamente.',
  checkoutHeading: 'Contratar o FXL Sales',
  checkoutBody: 'A contratação acontece no FXL Hub e vale para a Organização ativa.',
  checkoutLink: 'Abrir o FXL Hub',
  checkoutLoading: 'Preparando o link do FXL Hub',
  checkoutFailed: 'Não foi possível preparar o link do FXL Hub agora.',
  checkoutRetry: 'Tentar novamente',
} as const;
