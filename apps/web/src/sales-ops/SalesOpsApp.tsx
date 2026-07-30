import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Edit3,
  Filter,
  Folder,
  LayoutGrid,
  ListChecks,
  Loader2,
  Lock,
  LogOut,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Save,
  Settings,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuthProfile, useLogout } from '@/auth/react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  useCancelSalesOpsContract,
  useCreateSalesOpsSale,
  useSalesOpsBootstrap,
  useSaveSalesOpsArea,
  useSaveSalesOpsClient,
  useSaveSalesOpsFuncao,
  useSaveSalesOpsPerson,
  useSaveSalesOpsProduct,
  useSaveSalesOpsSettings,
  useTransitionSalesOpsSale,
  useUpdateSalesOpsSale,
} from './hooks';
import {
  buildSalesOpsPath,
  getDefaultSalesOpsRoute,
  getSalesOpsNavigation,
  getVisibleWorkspaces,
  resolveSalesOpsRoute,
  salesOpsWorkspaces,
  workspaceForView,
  type SalesOpsView,
  type SalesOpsWorkspace,
} from './navigation';
import { isOptimisticId, withoutOptimisticRows } from './optimistic';
import type { AppRole } from '@/auth/claims';
import type {
  CreateSalePayload,
  PaymentMethod,
  SaleDraft,
  SalesOpsArea,
  SalesOpsBootstrap,
  SalesOpsClient,
  SalesOpsFuncao,
  SalesOpsPerson,
  SalesOpsPersonFuncao,
  SalesOpsProduct,
  SalesOpsProductFuncaoCost,
  SalesOpsProductKind,
  SalesOpsSale,
  SalesOpsSettings,
  SalesOpsStatus,
} from './types';
import { computeSaleFinancials } from '@fxl-sales/shared-utils/sale-financials';
import {
  addMonthsToIsoDate,
  buildDashboardModel,
  buildFuncaoCostBasis,
  buildSalePayload,
  defaultPlanShapeForProduct,
  describeFuncaoCostBasis,
  describeProfessionalCostBase,
  entradaCentsFor,
  formatMoneyBrl,
  generateInstallmentPlan,
  inferPaymentPlanShape,
  initials,
  installmentSumCents,
  isServiceProduct,
  MAX_PLAN_INSTALLMENTS,
  maxRemainingInstallments,
  parseCurrencyInputToCents,
  productBaseValueBrl,
  professionalCostBaseCents,
  resolveProfessionalCostCents,
  resolveSaleCommissionDefaults,
  restanteCountFor,
  type PaymentPlanEntradaMode,
  type PaymentPlanShape,
  type ProfessionalCostUnit,
} from './calculations';
import type {
  SaveAreaPayload,
  SaveClientPayload,
  SaveFuncaoPayload,
  SavePersonPayload,
  SaveProductPayload,
  SaveSettingsPayload,
  TransitionSaleStatus,
} from './api';

const emptyBootstrap: SalesOpsBootstrap = {
  sales: [],
  products: [],
  productFuncaoCosts: [],
  clients: [],
  areas: [],
  funcoes: [],
  people: [],
  payables: [],
  saleItems: [],
  receivables: [],
  saleProfessionals: [],
  settings: null,
};

const panelClass = 'rounded-[18px] border border-[#e8e8ec] bg-white';
const mutedPanelClass = 'rounded-[18px] border border-[#e8e8ec] bg-[#fbfbfc]';
const tableHeadClass =
  'px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]';
const tableCellClass = 'px-4 py-3 text-[13.5px] text-[#57575f]';
const iconButtonBaseClass =
  'inline-flex h-8 w-8 items-center justify-center rounded-[9px] border transition';
const iconButtonClass = `${iconButtonBaseClass} border-[#dcdce2] bg-white text-[#57575f] hover:border-[#eaa81a] hover:bg-[#f5f2ea] hover:text-[#9c7210]`;
/**
 * Disjoint from `iconButtonClass` on purpose: `hover:` and `disabled:` have equal
 * specificity, so a `disabled:` variant on the enabled class would light the control
 * up on hover depending on Tailwind's generated source order.
 */
const iconButtonPendingClass = `${iconButtonBaseClass} cursor-not-allowed border-[#ececf1] bg-[#f6f6f8] text-[#b6b6bd]`;
const formInputClass =
  'h-11 rounded-[10px] border-[#dcdce2] bg-[#fafafb] px-3 text-sm text-[#201f24] shadow-none outline-none ring-0 transition focus-visible:border-[#eaa81a] focus-visible:ring-0 focus-visible:ring-offset-0 disabled:bg-[#f4f4f6] disabled:text-[#9b9ba3] disabled:opacity-100';
/**
 * The compact 40px picker, used by the `Filtros` bar and nothing else: that bar's
 * vertical rhythm is built around 40px and no `Input` sits on its row.
 */
const comboboxTriggerClass =
  'h-10 rounded-md border-[#dcdce2] bg-[#fafafb] px-3 text-sm font-medium text-[#201f24] transition focus-visible:border-[#eaa81a] focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60';
/**
 * Every picker inside a form or a dialog. Deliberately the same 44px height, 14px
 * font size and 10px radius as `formInputClass`, so a picker and the `Input` beside
 * it on the same grid row line up. `cn`'s tailwind-merge resolves the h-10/h-11 and
 * rounded-md/rounded-[10px] pairs in favour of the later token.
 */
const formSelectClass = `${comboboxTriggerClass} h-11 rounded-[10px]`;
/*
  The wizard shell, shared by the proposta wizard and the produto/serviço wizard. Both
  dialogs are the same object to the operator - a wide, stepped, four-part form - so
  they are literally the same six strings here rather than two copies that drift. The
  shell is a flex COLUMN with a real height: only the body scrolls, and the header,
  the stepper and the footer never shrink, which is why no `calc(...vh-...)` appears
  in either dialog.
*/
const wizardDialogContentClass =
  'flex h-[92vh] max-h-[92vh] w-[calc(100vw-48px)] max-w-[940px] flex-col gap-0 overflow-hidden rounded-[22px] border-none bg-[#f4f4f6] p-0 shadow-[0_30px_80px_rgba(0,0,0,.3)] sm:rounded-[22px] [&>button]:right-[26px] [&>button]:top-[31px] [&>button]:flex [&>button]:h-9 [&>button]:w-9 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-[10px] [&>button]:border [&>button]:border-[#dcdce2] [&>button]:bg-white [&>button]:opacity-100 [&>button]:shadow-none';
/** `pr-[78px]` reserves the slot the close button occupies at `right-[26px]`. */
const wizardHeaderClass =
  'shrink-0 border-b border-[#e8e8ec] bg-white px-[26px] py-5 pr-[78px] text-left';
const wizardBodyClass = 'min-h-0 flex-1 overflow-y-auto px-[26px] py-6';
const wizardFooterClass =
  'flex shrink-0 items-center justify-between border-t border-[#e8e8ec] bg-white px-[26px] py-4';
const wizardSecondaryButtonClass =
  'rounded-[11px] border border-[#dcdce2] bg-white px-5 py-[11px] text-sm font-semibold text-[#57575f] transition hover:bg-[#f2f2f4]';
const wizardPrimaryButtonClass =
  'rounded-[11px] bg-[#201f24] px-[22px] py-[11px] text-sm font-bold text-white transition hover:bg-[#33333a] disabled:cursor-not-allowed disabled:opacity-60';
/** One step's worth of content, on the white card the proposta wizard puts it on. */
const wizardStepCardClass =
  'flex flex-col gap-[15px] rounded-[14px] border border-[#e8e8ec] bg-white p-4';
/**
 * The one grid the step-1 `Itens` header and every item row share. Before this
 * constant the template was copy-pasted six times and the header carried an extra
 * `px-0.5`, so a column label never sat exactly over the control it named.
 */
const saleItemGridClass = 'grid grid-cols-[minmax(0,1fr)_70px_130px_120px_36px] gap-[9px]';
/**
 * The header strip. `border border-transparent` reproduces the 1px border of the
 * item block below it and `px-3` reproduces that block's padding, so the header's
 * column edges land exactly on the rows' column edges. Each cell then repeats the
 * horizontal padding of the control in its own column - see the cells below.
 */
const saleItemHeaderClass =
  'border border-transparent px-3 pb-[7px] text-[11px] font-bold uppercase tracking-[0.05em] text-[#9b9ba3]';
/**
 * One item, bounded. Two items are two blocks and the description can no longer be
 * misread as a third product row.
 */
const saleItemBlockClass =
  'flex flex-col gap-[7px] rounded-[12px] border border-[#e8e8ec] bg-[#fcfcfd] p-3';
/** The caption above a description input, in the same idiom as the column headers. */
const saleItemFieldLabelClass =
  'text-[11px] font-bold uppercase tracking-[0.04em] text-[#9b9ba3]';

const workspaceVisuals: Record<
  SalesOpsWorkspace,
  {
    icon: typeof LayoutGrid;
    tileBg: string;
    tileColor: string;
  }
> = {
  tatico: { icon: LayoutGrid, tileBg: '#eaa81a', tileColor: '#18181b' },
  operacional: { icon: ListChecks, tileBg: '#3f7cc4', tileColor: '#fff' },
  cadastros: { icon: Settings, tileBg: '#5a9166', tileColor: '#fff' },
  'meus-dados': { icon: UserRound, tileBg: '#8a5cc4', tileColor: '#fff' },
};

/**
 * `kind` here is the MODAL discriminator. `productKind` is the Produto/Serviço
 * classification the dialog should open on for a brand new record; the two live
 * on different fields and never meet.
 */
type ModalState =
  | {
      kind: 'product';
      product?: SalesOpsProduct;
      prefillName?: string;
      productKind?: SalesOpsProductKind;
    }
  | { kind: 'client'; client?: SalesOpsClient }
  | { kind: 'area'; area?: SalesOpsArea }
  | { kind: 'funcao'; funcao?: SalesOpsFuncao }
  | { kind: 'person'; person?: SalesOpsPerson }
  | null;

type SaleWizardRequest = { mode: 'create' } | { mode: 'edit'; sale: SalesOpsSale };

type SalesFilters = { status: SalesOpsStatus | 'all'; areaId: string | 'all' };

/** `all` is a real value here, not a placeholder: it is what "no status filter" means. */
const salesStatusFilterOptions: ComboboxOption[] = [
  { value: 'all', label: 'Todos os status' },
  { value: 'draft', label: 'Rascunho' },
  { value: 'open', label: 'Aberta' },
  { value: 'won', label: 'Ganha' },
  { value: 'lost', label: 'Perdida' },
  { value: 'cancelled', label: 'Cancelada' },
];

const paymentMethodOptions: ComboboxOption[] = [
  { value: 'pix', label: 'Pix' },
  { value: 'card', label: 'Cartão' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'transfer', label: 'Transferência' },
];

/**
 * The four pt-BR method names, hoisted so the sale detail's ledger tables and the
 * produto default-plan editor read from one map instead of two copies.
 */
const paymentMethodLabels: Record<PaymentMethod, string> = {
  pix: 'PIX',
  card: 'Cartão',
  boleto: 'Boleto',
  transfer: 'Transferência',
};

const defaultPaymentMethodOptions: ComboboxOption[] = (
  Object.keys(paymentMethodLabels) as PaymentMethod[]
).map((method) => ({ value: method, label: paymentMethodLabels[method] }));

/**
 * `nenhuma | % | R$ fixo`, the same option set, labels and stored values the
 * proposta payment-plan builder uses, so the cadastro default and the per-proposta
 * control read as one design.
 */
const entradaModeOptions: ComboboxOption[] = [
  { value: 'none', label: 'nenhuma' },
  { value: 'pct', label: '%' },
  { value: 'fix', label: 'R$ fixo' },
];

/**
 * `nenhuma | mensal`. Picking `mensal` is the ONLY way to enable recurrence now: the
 * dashed add-recurrence placeholder is gone, so the control is always visible and
 * never a toggle.
 */
const recurringModeOptions: ComboboxOption[] = [
  { value: 'none', label: 'nenhuma' },
  { value: 'monthly', label: 'mensal' },
];


function titleForView(view: SalesOpsView, workspace: SalesOpsWorkspace) {
  const personal = workspace === 'meus-dados';
  const map: Record<SalesOpsView, { title: string; subtitle: string }> = {
    dashboard: {
      title: 'Visão geral',
      subtitle: 'Receita, recorrência, comissões e ranking do mês',
    },
    vendas: {
      title: personal ? 'Minhas indicações' : 'Propostas',
      subtitle: personal
        ? 'Registro operacional com código, cliente, produto, responsável e status'
        : 'Propostas com código, cliente, áreas, responsáveis, status e ciclo de vida',
    },
    /**
     * `vendedores` and `finders` only ever render under `meus-dados` now that
     * Cadastros manages people through `pessoas`, so both titles are unconditional.
     */
    vendedores: {
      title: 'Meu painel',
      subtitle: 'Performance, comissão, ticket médio e vendas por responsável',
    },
    finders: {
      title: 'Meu painel',
      subtitle: 'Indicações, receita gerada e comissão por parceiro',
    },
    comissoes: {
      title: personal ? 'Minhas comissões' : 'Comissões',
      subtitle: 'Contas a pagar geradas pelas vendas persistidas',
    },
    produtos: {
      title: 'Produtos & Serviços',
      subtitle: 'Catálogo, valores, custos por função e padrões de proposta',
    },
    areas: {
      title: 'Áreas',
      subtitle: 'Unidades de negócio que classificam produtos e itens de venda',
    },
    clientes: {
      title: 'Clientes',
      subtitle: 'Base comercial e receita acumulada por cliente',
    },
    pessoas: {
      title: 'Pessoas',
      subtitle: 'Cadastro único de pessoas e das funções atribuídas a cada uma',
    },
    funcoes: {
      title: 'Funções',
      subtitle: 'Funções predefinidas do app e funções personalizadas da organização',
    },
    geral: {
      title: 'Geral',
      subtitle: 'Empresa, comissão padrão, financeiro e preferências',
    },
  };
  return map[view];
}

function roleSummaryLabel(roles: readonly AppRole[]): string {
  const roleSet = new Set(roles);
  const parts: string[] = [];
  if (roleSet.has('admin')) parts.push('Equipe');
  if (roleSet.has('seller')) parts.push('Vendedor');
  if (roleSet.has('finder')) parts.push('Finder');
  return parts.join(' · ');
}

function statusMeta(status: SalesOpsStatus) {
  const map: Record<SalesOpsStatus, { label: string; className: string }> = {
    draft: { label: 'Rascunho', className: 'bg-[#e9e9ed] text-[#6a6a72]' },
    open: { label: 'Aberta', className: 'bg-[#d3e3f6] text-[#2664ad]' },
    won: { label: 'Ganha', className: 'bg-[#c9e7cf] text-[#1f7d43]' },
    lost: { label: 'Perdida', className: 'bg-[#f6d1c5] text-[#a5341c]' },
    cancelled: { label: 'Cancelada', className: 'bg-[#eeeef1] text-[#6a6a72]' },
  };
  return map[status] ?? { label: status, className: 'bg-[#e9e9ed] text-[#6a6a72]' };
}

function payableTypeMeta(kind: string) {
  if (kind === 'seller_commission') return { label: 'Vendedor', className: 'bg-[#fdf0cf] text-[#7a5a12]' };
  if (kind === 'finder_commission') return { label: 'Finder', className: 'bg-[#d3e3f6] text-[#2664ad]' };
  if (kind === 'professional_cost') return { label: 'Prestador', className: 'bg-[#eeeef1] text-[#57575f]' };
  if (kind === 'tax') return { label: 'Imposto', className: 'bg-[#f6d1c5] text-[#a5341c]' };
  return { label: 'Custo', className: 'bg-[#eeeef1] text-[#57575f]' };
}

function dateOnly(value: string) {
  return value.slice(0, 10);
}

function displayDate(value: string) {
  const iso = dateOnly(value);
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function inputDateToday() {
  return new Date().toISOString().slice(0, 10);
}

function parseCurrencyToCents(value: string | number | undefined): number {
  return parseCurrencyInputToCents(value);
}

function centsToInput(cents: number | undefined): string {
  const value = (cents ?? 0) / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * `centsToInput` for a field where 0 means "nobody set a value", which is what
 * setupBrl/monthlyBrl mean on a catalog row: there is no separate flag, so 0 IS the
 * absence. Seeding a literal `0` would state a price nobody chose - the same lie the
 * list avoids by printing `Variável` rather than `R$ 0,00` - and would make an
 * operator clear the field before typing.
 *
 * Deliberately kind-blind, exactly like `productBaseValueBrl`. `productForm` runs
 * once in a `useState` initializer and the dialog's remount key does not include
 * `form.kind`, so a seed that branched on the kind would go stale the moment the
 * `Produto | Serviço` control was toggled. Only the PLACEHOLDER is kind-aware,
 * because it is read at render time.
 *
 * A blank field parses back to 0, so this changes what the operator sees and never
 * what is submitted.
 */
function centsToOptionalInput(cents: number | undefined): string {
  return cents ? centsToInput(cents) : '';
}

/** `null` is accepted because that is what drizzle hands back for a nullable numeric. */
function parseDecimal(value: string | number | null | undefined, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (!value) return fallback;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pctToInput(value: string | number | null | undefined, fallback = 0): string {
  return String(parseDecimal(value, fallback));
}

function salePrimaryProductName(bootstrap: SalesOpsBootstrap, saleId: string): string {
  return (
    bootstrap.saleItems.find((item) => item.saleId === saleId)?.productNameSnapshot ??
    'Sem produto'
  );
}

/**
 * The two predefined app funções. Every função read in this file goes through
 * `hasFuncao`, never through an inline slug comparison, so there is exactly one
 * adaptation point if the slugs ever move.
 *
 * Deliberately not exported: `react-refresh/only-export-components` allows only
 * component exports from this module, and nothing outside it needs these.
 */
const FUNCAO_SLUG_VENDEDOR = 'vendedor';
const FUNCAO_SLUG_FINDER = 'finder';

function hasFuncao(person: SalesOpsPerson, slug: string): boolean {
  return person.funcoes.some((funcao) => funcao.slug === slug);
}

/*
  `isCollaboratorPerson` lived here and had exactly one consumer left: the wizard's
  Profissional picker. That picker now offers every ACTIVE pessoa, because
  restricting allocation to "carries a non-system função" hid a vendedor who also
  delivers - the rigidity this batch exists to remove. With no consumer the helper
  was dead code, so it is gone rather than kept as a decorative export. The
  deprecated `is_collaborator` column on the API side is untouched.
*/

function salesForPerson(bootstrap: SalesOpsBootstrap, person: SalesOpsPerson, mode: 'seller' | 'finder') {
  return bootstrap.sales.filter((sale) => {
    if (mode === 'seller') {
      return sale.sellerPersonId === person.id || sale.sellerNameSnapshot === person.displayName;
    }
    return sale.finderPersonId === person.id || sale.finderNameSnapshot === person.displayName;
  });
}

function personMetrics(bootstrap: SalesOpsBootstrap, person: SalesOpsPerson, mode: 'seller' | 'finder') {
  const sales = salesForPerson(bootstrap, person, mode).filter((sale) => sale.status === 'won');
  const totalBrl = sales.reduce((sum, sale) => sum + sale.totalBrl, 0);
  const commissionBrl = sales.reduce(
    (sum, sale) =>
      sum + (mode === 'seller' ? sale.sellerCommissionBrl : sale.finderCommissionBrl),
    0,
  );
  return {
    sales,
    totalBrl,
    commissionBrl,
    ticketBrl: sales.length > 0 ? Math.round(totalBrl / sales.length) : 0,
  };
}

function activeSettings(settings: SalesOpsSettings | null): SaveSettingsPayload {
  return {
    legalName: settings?.legalName ?? '',
    document: settings?.document ?? '',
    phone: settings?.phone ?? '',
    financeEmail: settings?.financeEmail ?? '',
    defaultSellerCommissionPct: parseDecimal(settings?.defaultSellerCommissionPct, 10),
    defaultFinderCommissionPct: parseDecimal(settings?.defaultFinderCommissionPct, 3),
    defaultTaxPct: parseDecimal(settings?.defaultTaxPct, 6),
    currency: settings?.currency ?? 'BRL',
    taxRegime: settings?.taxRegime ?? 'Simples Nacional',
    periodClosingDay: settings?.periodClosingDay ?? 1,
    tableDensity: settings?.tableDensity ?? 'comfortable',
    dateFormat: settings?.dateFormat ?? 'dd/mm/aaaa',
    language: settings?.language ?? 'pt-BR',
    commissionOnRecurring: settings?.commissionOnRecurring ?? true,
    sellerCanBeFinder: settings?.sellerCanBeFinder ?? true,
  };
}

function PrimaryButton({
  children,
  onClick,
  type = 'button',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  return (
    <button
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[11px] bg-[#201f24] px-4 py-2 text-[13.5px] font-bold text-white transition hover:bg-[#33333a] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

function AccentButton({
  children,
  onClick,
  type = 'button',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  return (
    <button
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[13px] bg-[#eaa81a] px-4 py-2 text-[13.5px] font-bold text-[#18181b] transition hover:bg-[#f3b634] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  type = 'button',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  return (
    <button
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[11px] border border-[#dcdce2] bg-white px-4 py-2 text-[13.5px] font-semibold text-[#57575f] transition hover:bg-[#f2f2f4] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-[6px]">
      <span className="text-xs font-semibold text-[#8b8b92]">
        {label}
        {required ? <span className="text-[#b23a22]"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

/**
 * `Field`'s twin for a `Combobox`. A `<label>` must not contain two labelable
 * elements, and an open combobox panel contributes a second one (its search
 * `<input>`) next to the trigger `<button>`, so picker rows use a `<div>` and take
 * their accessible name from the trigger's `aria-label` instead.
 */
function FieldBlock({
  label,
  children,
  required,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-[6px]">
      <span className="text-xs font-semibold text-[#8b8b92]">
        {label}
        {required ? <span className="text-[#b23a22]"> *</span> : null}
      </span>
      {children}
    </div>
  );
}

/** Turn a closed enum into combobox options without repeating the shape at 8 call sites. */
function enumOptions(values: readonly string[]): ComboboxOption[] {
  return values.map((value) => ({ value, label: value }));
}

function areaOptions(areas: SalesOpsArea[]): ComboboxOption[] {
  return areas.map((area) => ({ value: area.id, label: area.name }));
}

function productOptions(
  products: SalesOpsProduct[],
  areaNameById: Map<string, string>,
): ComboboxOption[] {
  return products.map((product) => ({
    value: product.id,
    label: product.name,
    description: product.areaId ? areaNameById.get(product.areaId) : undefined,
  }));
}

function personOptions(people: SalesOpsPerson[]): ComboboxOption[] {
  return people.map((person) => ({
    value: person.id,
    label: person.displayName,
    description: person.contactEmail ?? undefined,
  }));
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      className="flex items-center justify-between gap-4 rounded-[11px] border border-[#ececf1] bg-[#fafafb] px-4 py-3 text-left"
      onClick={() => onChange(!checked)}
      type="button"
    >
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold text-[#201f24]">{label}</span>
        {description ? <span className="block text-xs text-[#8b8b92]">{description}</span> : null}
      </span>
      <span
        className={`relative h-[25px] w-11 flex-none rounded-full transition ${checked ? 'bg-[#2f7d4b]' : 'bg-[#d2d2d8]'}`}
      >
        <span
          className={`absolute top-[2.5px] h-5 w-5 rounded-full bg-white transition ${checked ? 'right-[2.5px]' : 'left-[2.5px]'}`}
        />
      </span>
    </button>
  );
}

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return (
    <div className={`${mutedPanelClass} flex min-h-[154px] flex-col items-center justify-center gap-2 p-6 text-center`}>
      <div className="text-sm font-bold text-[#201f24]">{title}</div>
      <div className="max-w-[420px] text-[13px] leading-5 text-[#8b8b92]">{text}</div>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="flex h-full min-h-[360px] items-center justify-center">
      <div className="flex items-center gap-3 rounded-[14px] border border-[#e8e8ec] bg-white px-5 py-4 text-sm font-semibold text-[#57575f]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando dados comerciais
      </div>
    </div>
  );
}

export function SalesOpsApp() {
  const navigate = useNavigate();
  const routeParams = useParams();
  const profile = useAuthProfile();
  const logout = useLogout();
  const bootstrapQuery = useSalesOpsBootstrap();
  const savePerson = useSaveSalesOpsPerson();
  const saveProduct = useSaveSalesOpsProduct();
  const saveClient = useSaveSalesOpsClient();
  const saveArea = useSaveSalesOpsArea();
  const saveFuncao = useSaveSalesOpsFuncao();
  const createSale = useCreateSalesOpsSale();
  const updateSale = useUpdateSalesOpsSale();
  const transitionSale = useTransitionSalesOpsSale();
  const cancelContract = useCancelSalesOpsContract();
  const saveSettings = useSaveSalesOpsSettings();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [saleWizard, setSaleWizard] = useState<SaleWizardRequest | null>(null);
  const [salesFilters, setSalesFilters] = useState<SalesFilters>({ status: 'all', areaId: 'all' });
  /**
   * Which bucket of `cadastros/produtos` is on screen. Component state, not URL
   * state: the URL is the source of truth for the workspace and the page, and this
   * is neither. It lives here rather than in `ProductsView` because the header
   * action label and the modal it opens both read it. Same precedent as
   * `salesFilters` above.
   */
  const [productKind, setProductKind] = useState<SalesOpsProductKind>('product');
  const mountedRef = useRef(true);

  const visibleWorkspaceIds = useMemo(
    () => getVisibleWorkspaces(profile.roles),
    [profile.roles],
  );
  const resolution = resolveSalesOpsRoute(routeParams, profile.roles);
  const { workspace, view } = resolution.route;
  const bootstrap = bootstrapQuery.data ?? emptyBootstrap;
  /**
   * Optimistic rows carry a client-side placeholder id, so only the cadastro list
   * that created them may see them. Every other surface reads this snapshot, which
   * is the same object by reference whenever nothing is optimistic.
   */
  const persistedBootstrap = useMemo(() => withoutOptimisticRows(bootstrap), [bootstrap]);
  /**
   * The funções cadastro is the one screen that must see its OWN optimistic funções and
   * nobody else's optimistic rows: the `Nº pessoas` column counts `people`, and an
   * in-flight optimistic PESSOA belongs to `cadastros/pessoas`, not here. The identity
   * short-circuit means nothing changes by reference while no função is in flight, which
   * is the normal case.
   */
  const funcoesBootstrap = useMemo(
    () =>
      bootstrap.funcoes === persistedBootstrap.funcoes
        ? persistedBootstrap
        : { ...persistedBootstrap, funcoes: bootstrap.funcoes },
    [bootstrap.funcoes, persistedBootstrap],
  );
  const dashboard = useMemo(() => buildDashboardModel(persistedBootstrap), [persistedBootstrap]);
  const filteredSales = useMemo(() => {
    return bootstrap.sales.filter((sale) => {
      if (salesFilters.status !== 'all' && sale.status !== salesFilters.status) return false;
      if (salesFilters.areaId !== 'all') {
        const match = bootstrap.saleItems.some(
          (item) => item.saleId === sale.id && item.areaId === salesFilters.areaId,
        );
        if (!match) return false;
      }
      return true;
    });
  }, [bootstrap.sales, bootstrap.saleItems, salesFilters]);
  const navItems = getSalesOpsNavigation(workspace, profile.roles);
  const title = titleForView(view, workspace);
  /**
   * The redundant `admin` check is belt and braces: `getVisibleWorkspaces` already
   * refuses the `cadastros` workspace to anyone without the role.
   */
  const canManageCadastros = workspace === 'cadastros' && profile.roles.includes('admin');
  const canManagePeople = canManageCadastros && view === 'pessoas';
  const canManageFuncoes = canManageCadastros && view === 'funcoes';
  const personModalMatchesRoute = canManagePeople && modal?.kind === 'person';

  /**
   * Inline creates from a picker's `+ Criar novo ...` row. `mutateAsync` is read inside
   * the function body rather than captured at render, so a caller that never reaches a
   * create row never needs the hook to expose it. A rejection resolves to `null` and the
   * picker keeps its previous value; the operator can still use the cadastro screen.
   */
  async function createClientByName(name: string): Promise<SalesOpsClient | null> {
    try {
      const { client } = await saveClient.mutateAsync({ name: name.trim() });
      return client;
    } catch {
      return null;
    }
  }

  async function createAreaByName(name: string): Promise<SalesOpsArea | null> {
    try {
      const { area } = await saveArea.mutateAsync({ name: name.trim(), status: 'active' });
      return area;
    } catch {
      return null;
    }
  }

  async function createFuncaoByName(name: string): Promise<SalesOpsFuncao | null> {
    try {
      const { funcao } = await saveFuncao.mutateAsync({ name: name.trim(), status: 'active' });
      return funcao;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (modal?.kind !== 'person' || personModalMatchesRoute) return;

    const departedModal = modal;
    queueMicrotask(() => {
      if (mountedRef.current) {
        setModal((current) => (current === departedModal ? null : current));
      }
    });
  }, [modal, personModalMatchesRoute]);

  const payableBrl = bootstrap.payables
    .filter((payable) => payable.status === 'open')
    .reduce((sum, payable) => sum + payable.amountBrl, 0);
  const roleLabel = roleSummaryLabel(profile.roles);
  const userName = profile.name ?? 'FXL';

  function setWorkspace(next: SalesOpsWorkspace) {
    setWorkspaceMenuOpen(false);
    setModal((current) => (current?.kind === 'person' ? null : current));
    navigate(buildSalesOpsPath(getDefaultSalesOpsRoute(profile.roles, next)));
  }

  function go(next: SalesOpsView) {
    setWorkspaceMenuOpen(false);
    setModal((current) => (current?.kind === 'person' ? null : current));
    const targetWorkspace = navItems.some((item) => item.id === next)
      ? workspace
      : workspaceForView(next, profile.roles);
    navigate(buildSalesOpsPath({ workspace: targetWorkspace, view: next }));
  }

  function runHeaderAction() {
    if (view === 'produtos') {
      setModal({ kind: 'product', productKind });
      return;
    }
    if (view === 'areas') {
      setModal({ kind: 'area' });
      return;
    }
    if (view === 'clientes') {
      setModal({ kind: 'client' });
      return;
    }
    if (canManagePeople) {
      setModal({ kind: 'person' });
      return;
    }
    if (canManageFuncoes) {
      setModal({ kind: 'funcao' });
      return;
    }
    setSaleWizard({ mode: 'create' });
  }

  const headerAction =
    view === 'geral'
      ? null
      : view === 'produtos'
        ? productKind === 'service'
          ? 'Novo serviço'
          : 'Novo produto'
        : view === 'areas'
          ? 'Nova área'
          : view === 'clientes'
            ? 'Novo cliente'
            : view === 'pessoas'
              ? canManagePeople
                ? 'Nova pessoa'
                : null
              : view === 'funcoes'
                ? canManageFuncoes
                  ? 'Nova função'
                  : null
                : view === 'vendedores' || view === 'finders'
                  ? null
                  : 'Nova proposta';
  const availableWorkspaces = salesOpsWorkspaces.filter((item) =>
    visibleWorkspaceIds.includes(item.id),
  );
  const activeWorkspaceMeta = salesOpsWorkspaces.find((item) => item.id === workspace);
  const activeWorkspaceVisual = workspaceVisuals[workspace];
  const ActiveWorkspaceIcon = activeWorkspaceVisual.icon;

  if (visibleWorkspaceIds.length === 0) {
    return <Navigate to="/no-role" replace />;
  }

  if (resolution.redirect) {
    return <Navigate to={resolution.path} replace />;
  }

  return (
    <div className="sales-ops flex h-screen w-full gap-0 bg-[#e8e8eb] p-[10px] text-[#201f24]">
      <aside
        className={`flex flex-none flex-col overflow-hidden rounded-[20px] bg-[#18181b] px-4 py-[22px] transition-all duration-200 ${sidebarCollapsed ? 'w-[76px]' : 'w-[244px]'}`}
      >
        <div
          className={`flex items-center ${
            sidebarCollapsed ? 'justify-center pb-[14px]' : 'gap-[11px] px-[6px] pb-4 pl-2'
          }`}
        >
          {!sidebarCollapsed ? (
            <>
              <div className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-[#eaa81a]">
                <Folder className="h-[18px] w-[18px] text-[#18181b]" />
              </div>
              <div className="min-w-0 flex-1 leading-none">
                <div className="sales-ops-num text-[19px] font-bold text-[#f3f3f5]">FXL</div>
                <div className="mt-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#8b8b92]">
                  Vendas
                </div>
              </div>
              <button
                aria-label="Recolher menu"
                className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border border-[#343439] bg-[#242428] text-[#8b8b92] transition hover:bg-[#2c2c31]"
                onClick={() => setSidebarCollapsed(true)}
                type="button"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
            </>
          ) : (
            <button
              aria-label="Expandir menu"
              className="flex h-10 w-10 items-center justify-center rounded-[11px] border border-[#343439] bg-[#242428] text-[#a2a2aa] transition hover:bg-[#2c2c31] hover:text-[#eaa81a]"
              onClick={() => setSidebarCollapsed(false)}
              type="button"
            >
              <ChevronsRight className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>

        <div className="relative mb-4">
          {!sidebarCollapsed ? (
            <button
              aria-expanded={workspaceMenuOpen}
              className="flex w-full items-center gap-[11px] rounded-[14px] border border-[#343439] bg-[#242428] p-2 text-left transition hover:bg-[#2c2c31]"
              onClick={() => setWorkspaceMenuOpen((open) => !open)}
              title="Trocar workspace"
              type="button"
            >
              <span
                className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px]"
                style={{
                  backgroundColor: activeWorkspaceVisual.tileBg,
                  color: activeWorkspaceVisual.tileColor,
                }}
              >
                <ActiveWorkspaceIcon className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1 leading-[1.2]">
                <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-[#8b8b92]">
                  Workspace
                </span>
                <span className="sales-ops-num block truncate text-[15px] font-bold text-[#f3f3f5]">
                  {activeWorkspaceMeta?.label ?? 'Tático'}
                </span>
              </span>
              <ChevronDown className="h-[15px] w-[15px] flex-none text-[#8b8b92]" />
            </button>
          ) : (
            <button
              aria-label={`Workspace: ${activeWorkspaceMeta?.label ?? 'Tático'}`}
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-[11px]"
              onClick={() => setSidebarCollapsed(false)}
              style={{
                backgroundColor: activeWorkspaceVisual.tileBg,
                color: activeWorkspaceVisual.tileColor,
              }}
              type="button"
            >
              <ActiveWorkspaceIcon className="h-[19px] w-[19px]" />
            </button>
          )}
          {workspaceMenuOpen && !sidebarCollapsed ? (
            <>
              <button
                aria-label="Fechar workspaces"
                className="fixed inset-0 z-[55] cursor-default"
                onClick={() => setWorkspaceMenuOpen(false)}
                type="button"
              />
              <div className="absolute left-0 right-0 top-[58px] z-[60] rounded-[14px] border border-[#e5e5ea] bg-white p-[7px] shadow-[0_20px_48px_rgba(0,0,0,.32)]">
                <div className="px-2.5 pb-[5px] pt-[7px] text-[10px] font-bold uppercase tracking-[0.1em] text-[#9b9ba3]">
                  Workspaces
                </div>
                {availableWorkspaces.map((item) => {
                  const itemVisual = workspaceVisuals[item.id];
                  const ItemIcon = itemVisual.icon;
                  const active = workspace === item.id;
                  return (
                    <button
                      className={`flex w-full items-center gap-[9px] rounded-[10px] px-2.5 py-[9px] text-left transition hover:bg-[#f5f5f7] ${
                        active ? 'bg-[#eaa81a]' : 'bg-transparent'
                      }`}
                      key={item.id}
                      onClick={() => setWorkspace(item.id)}
                      type="button"
                    >
                      <span className="flex h-[15px] w-[15px] flex-none items-center justify-center text-[#18181b]">
                        {active ? <Check className="h-[15px] w-[15px]" /> : null}
                      </span>
                      <ItemIcon
                        className="h-4 w-4 flex-none"
                        style={{ color: active ? '#18181b' : '#84848c' }}
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-[13.5px] ${
                          active ? 'font-bold text-[#18181b]' : 'font-semibold text-[#201f24]'
                        }`}
                      >
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>

        <nav
          className={`flex flex-col gap-1 ${
            sidebarCollapsed ? 'mt-1 items-center gap-2' : ''
          }`}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            const openPayablesCount = bootstrap.payables.filter((payable) => payable.status === 'open').length;
            return (
              <button
                aria-label={item.label}
                className={`flex items-center gap-[13px] rounded-xl text-left text-sm font-semibold transition ${
                  sidebarCollapsed
                    ? 'h-10 w-10 justify-center'
                    : 'px-[13px] py-[11px]'
                } ${active ? 'bg-[#f3f3f5] text-[#18181b]' : 'text-[#b3b3bb] hover:bg-white/5 hover:text-white'}`}
                key={item.id}
                onClick={() => go(item.id)}
                title={item.label}
                type="button"
              >
                <Icon className="h-[18px] w-[18px] flex-none" />
                {!sidebarCollapsed ? <span className="min-w-0 flex-1 truncate">{item.label}</span> : null}
                {!sidebarCollapsed &&
                item.id === 'comissoes' &&
                workspace === 'operacional' &&
                openPayablesCount > 0 ? (
                  <span
                    className={`sales-ops-num rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      active ? 'bg-[#e2b53a] text-[#18181b]' : 'bg-[#3a372b] text-[#eaa81a]'
                    }`}
                  >
                    {openPayablesCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          {!sidebarCollapsed ? (
            <div className="rounded-2xl border border-[#343439] bg-[#242428] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#7c7c85]">
                A pagar este mês
              </div>
              <div className="sales-ops-num mt-1 text-[26px] font-bold text-[#f3f3f5]">
                {formatMoneyBrl(payableBrl, { maximumFractionDigits: 0 })}
              </div>
              <div className="mt-1 text-xs text-[#8b8b92]">
                {bootstrap.payables.filter((item) => item.status === 'open').length} itens em aberto
              </div>
            </div>
          ) : null}
          <AccentButton onClick={() => setSaleWizard({ mode: 'create' })}>
            <Plus className="h-4 w-4" />
            {!sidebarCollapsed ? <span>Nova proposta</span> : null}
          </AccentButton>
          <DropdownMenu onOpenChange={setAccountMenuOpen} open={accountMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Abrir menu da conta"
                className={cn(
                  'flex items-center rounded-[14px] border border-[#343439] bg-[#242428] transition hover:border-[#46464d] hover:bg-[#2c2c31] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#eaa81a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#18181b]',
                  sidebarCollapsed
                    ? 'mx-auto size-11 justify-center'
                    : 'w-full gap-[11px] p-2 text-left',
                )}
                onClick={(event) => {
                  if (event.detail === 0) setAccountMenuOpen(true);
                }}
                title="Conta"
                type="button"
              >
                <span className="sales-ops-num flex size-10 flex-none items-center justify-center rounded-[11px] bg-[#eaa81a] text-[14px] font-bold text-[#18181b]">
                  {initials(userName)}
                </span>
                {!sidebarCollapsed ? (
                  <>
                    <span className="min-w-0 flex-1 leading-[1.2]">
                      <span className="block truncate text-[14px] font-bold text-[#f3f3f5]">
                        {userName}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-[#8b8b92]">
                        {roleLabel}
                      </span>
                      {profile.email ? <span className="sr-only">{profile.email}</span> : null}
                    </span>
                    <ChevronUp className="size-4 flex-none text-[#8b8b92]" />
                  </>
                ) : null}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-[220px] rounded-2xl border-[#e5e5ea] bg-white p-2 text-[#201f24] shadow-[0_20px_48px_rgba(0,0,0,.32)]"
              portalled={false}
              side="top"
              sideOffset={10}
            >
              <DropdownMenuLabel className="flex items-center gap-[11px] px-2.5 py-2 font-normal">
                <span className="sales-ops-num flex size-10 flex-none items-center justify-center rounded-[11px] bg-[#eaa81a] text-[14px] font-bold text-[#18181b]">
                  {initials(userName)}
                </span>
                <span className="min-w-0 flex-1 leading-[1.2]">
                  <span className="block truncate text-[13.5px] font-bold text-[#201f24]">
                    {userName}
                  </span>
                  {profile.email ? (
                    <span className="mt-0.5 block truncate text-[11.5px] text-[#8b8b92]">
                      {profile.email}
                    </span>
                  ) : null}
                  <span className="mt-0.5 block truncate text-[11.5px] text-[#8b8b92]">
                    {roleLabel}
                  </span>
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="my-1.5 bg-[#e5e5ea]" />
              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                  <button
                    aria-label="Sair"
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-left text-[13.5px] font-semibold text-[#c93d32] outline-none transition hover:bg-[#fff2f0] focus:bg-[#fff2f0]"
                    onClick={() => {
                      void logout();
                    }}
                    type="button"
                  >
                    <LogOut className="size-4" />
                    Sair
                  </button>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden pl-[10px]">
        <header className="flex flex-none items-center gap-4 rounded-t-2xl border border-[#e5e5ea] bg-[#f3f3f5] px-[22px] py-[15px]">
          <div className="min-w-0">
            <h1 className="sales-ops-num text-[23px] font-bold tracking-normal text-[#201f24]">
              {title.title}
            </h1>
            <div className="mt-0.5 text-[12.5px] text-[#8b8b92]">{title.subtitle}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {bootstrapQuery.isFetching && !bootstrapQuery.isLoading ? (
              <span
                aria-live="polite"
                className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#8b8b92]"
              >
                <Loader2 className="h-[13px] w-[13px] animate-spin" />
                Atualizando
              </span>
            ) : null}
            {headerAction ? (
              <AccentButton onClick={runHeaderAction}>
                <Plus className="h-[15px] w-[15px]" />
                {headerAction}
              </AccentButton>
            ) : null}
            {(view === 'vendas' || view === 'comissoes') ? (
              <SecondaryButton onClick={() => setFiltersOpen((open) => !open)}>
                <Filter className="h-[15px] w-[15px]" />
                Filtros
              </SecondaryButton>
            ) : null}
            <div className="hidden items-center gap-2 rounded-xl border border-[#dcdce2] bg-white px-[14px] py-[9px] text-sm font-semibold text-[#57575f] xl:flex">
              <CalendarDays className="h-[15px] w-[15px] text-[#9c7210]" />
              Julho 2026
              <ChevronDown className="h-[13px] w-[13px] text-[#8b8b92]" />
            </div>
          </div>
        </header>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-2xl border border-t-0 border-[#e5e5ea] bg-[#fafafb]">
          {filtersOpen && view === 'vendas' ? (
            <div className="flex flex-none flex-wrap items-center gap-3 border-b border-[#ececf1] bg-white px-[22px] py-[13px]">
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#9b9ba3]">
                Filtros
              </span>
              <div className="w-[190px]">
                <Combobox
                  aria-label="Filtrar por status"
                  className={comboboxTriggerClass}
                  onChange={(value) =>
                    setSalesFilters((current) => ({
                      ...current,
                      status: value as SalesFilters['status'],
                    }))
                  }
                  options={salesStatusFilterOptions}
                  searchPlaceholder="Buscar status..."
                  value={salesFilters.status}
                />
              </div>
              <div className="w-[190px]">
                <Combobox
                  aria-label="Filtrar por área"
                  className={comboboxTriggerClass}
                  onChange={(value) =>
                    setSalesFilters((current) => ({ ...current, areaId: value }))
                  }
                  options={[
                    { value: 'all', label: 'Todas as áreas' },
                    ...areaOptions(persistedBootstrap.areas),
                  ]}
                  searchPlaceholder="Buscar área..."
                  value={salesFilters.areaId}
                />
              </div>
              <span className="ml-auto text-[13px] text-[#8b8b92]">
                <span className="sales-ops-num font-bold text-[#201f24]">
                  {filteredSales.length}
                </span>{' '}
                registros
              </span>
            </div>
          ) : null}
          {filtersOpen && view === 'comissoes' ? (
            <div className="flex flex-none flex-wrap items-center gap-3 border-b border-[#ececf1] bg-white px-[22px] py-[13px]">
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#9b9ba3]">
                Filtros
              </span>
              {/*
                The status and responsável pickers that used to sit here were inert:
                `onChange={() => undefined}` with a single option each. Rendering them as
                searchable Comboboxes would ship a control that provably cannot filter, so
                they are removed until the comissões filters are actually wired.
              */}
              <span className="ml-auto text-[13px] text-[#8b8b92]">
                <span className="sales-ops-num font-bold text-[#201f24]">
                  {bootstrap.payables.length}
                </span>{' '}
                registros
              </span>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-5">
            {bootstrapQuery.isLoading ? <LoadingPanel /> : null}
            {bootstrapQuery.isError ? (
              <EmptyPanel
                text="A API de vendas não respondeu corretamente. Verifique o servidor local e tente novamente."
                title="Não foi possível carregar"
              />
            ) : null}
            {!bootstrapQuery.isLoading && !bootstrapQuery.isError ? (
              <>
                {view === 'dashboard' ? (
                  <DashboardView bootstrap={persistedBootstrap} dashboard={dashboard} go={go} />
                ) : null}
                {view === 'vendas' ? (
                  <SalesView
                    bootstrap={persistedBootstrap}
                    canManage={workspace === 'operacional'}
                    onCancelContract={(sale) => cancelContract.mutate(sale.id)}
                    onEdit={(sale) => setSaleWizard({ mode: 'edit', sale })}
                    onTransition={(sale, status) =>
                      transitionSale.mutate({ saleId: sale.id, status })
                    }
                    sales={filteredSales}
                  />
                ) : null}
                {view === 'vendedores' ? (
                  <MeuPainelView bootstrap={persistedBootstrap} mode="seller" />
                ) : null}
                {view === 'finders' ? (
                  <MeuPainelView bootstrap={persistedBootstrap} mode="finder" />
                ) : null}
                {view === 'comissoes' ? <CommissionsView bootstrap={persistedBootstrap} /> : null}
                {view === 'produtos' ? (
                  <ProductsView
                    areas={persistedBootstrap.areas}
                    funcaoCosts={persistedBootstrap.productFuncaoCosts}
                    funcoes={persistedBootstrap.funcoes}
                    kind={productKind}
                    products={persistedBootstrap.products}
                    onEdit={(product) => setModal({ kind: 'product', product })}
                    onKindChange={setProductKind}
                  />
                ) : null}
                {view === 'clientes' ? (
                  <ClientsView
                    bootstrap={bootstrap}
                    onEdit={(client) => setModal({ kind: 'client', client })}
                  />
                ) : null}
                {view === 'areas' ? (
                  <AreasView
                    bootstrap={bootstrap}
                    onEdit={(area) => setModal({ kind: 'area', area })}
                  />
                ) : null}
                {view === 'pessoas' ? (
                  <PessoasView
                    bootstrap={bootstrap}
                    onEdit={(person) => setModal({ kind: 'person', person })}
                  />
                ) : null}
                {view === 'funcoes' ? (
                  /*
                    funcoesBootstrap: raw `funcoes` so an optimistic função created here
                    is visible immediately, persisted `people` so an in-flight optimistic
                    pessoa never inflates the "Nº pessoas" column - an optimistic row
                    belongs only to the cadastro that created it.
                  */
                  <FuncoesView
                    bootstrap={funcoesBootstrap}
                    onEdit={(funcao) => setModal({ kind: 'funcao', funcao })}
                  />
                ) : null}
                {view === 'geral' ? (
                  <SettingsView
                    key={bootstrap.settings?.updatedAt ?? bootstrap.settings?.createdAt ?? 'new'}
                    isSaving={saveSettings.isPending}
                    onSave={(payload) => saveSettings.mutate(payload)}
                    settings={bootstrap.settings}
                  />
                ) : null}
              </>
            ) : null}
          </div>
        </section>
      </main>

      <ProductDialog
        areas={persistedBootstrap.areas}
        /*
          Cost rows come back FLAT, one array for the whole org, so the parent scopes
          them to the record being edited. A naive `product.funcaoCosts` read would
          silently render zero costs.
        */
        funcaoCosts={persistedBootstrap.productFuncaoCosts.filter(
          (row) => row.productId === (modal?.kind === 'product' ? modal.product?.id : undefined),
        )}
        funcoes={persistedBootstrap.funcoes}
        modal={modal?.kind === 'product' ? modal : null}
        onClose={() => setModal(null)}
        onCreateArea={createAreaByName}
        onSave={(payload) => {
          saveProduct.mutate(payload, { onSuccess: () => setModal(null) });
        }}
        saving={saveProduct.isPending}
      />
      <ClientDialog
        modal={modal?.kind === 'client' ? modal : null}
        onClose={() => setModal(null)}
        onSave={(payload) => {
          saveClient.mutate(payload, { onSuccess: () => setModal(null) });
        }}
        saving={saveClient.isPending}
      />
      <AreaDialog
        modal={modal?.kind === 'area' ? modal : null}
        onClose={() => setModal(null)}
        onSave={(payload) => {
          saveArea.mutate(payload, { onSuccess: () => setModal(null) });
        }}
        saving={saveArea.isPending}
      />
      <FuncaoDialog
        modal={modal?.kind === 'funcao' ? modal : null}
        onClose={() => setModal(null)}
        onSave={(payload) => {
          saveFuncao.mutate(payload, { onSuccess: () => setModal(null) });
        }}
        saving={saveFuncao.isPending}
      />
      <PersonDialog
        funcoes={persistedBootstrap.funcoes}
        modal={personModalMatchesRoute && modal?.kind === 'person' ? modal : null}
        onClose={() => setModal(null)}
        onCreateFuncao={createFuncaoByName}
        onSave={(payload) => {
          savePerson.mutate(payload, { onSuccess: () => setModal(null) });
        }}
        saving={savePerson.isPending}
      />
      {bootstrapQuery.isSuccess ? (
        <SaleWizardDialog
          bootstrap={persistedBootstrap}
          editSale={saleWizard?.mode === 'edit' ? saleWizard.sale : null}
          onClose={() => setSaleWizard(null)}
          onCreateArea={createAreaByName}
          onCreateClient={createClientByName}
          onCreateFuncao={createFuncaoByName}
          onCreateProduct={(name) => setModal({ kind: 'product', prefillName: name })}
          onSave={(payload) => {
            if (saleWizard?.mode === 'edit') {
              updateSale.mutate(
                { saleId: saleWizard.sale.id, payload },
                { onSuccess: () => setSaleWizard(null) },
              );
            } else {
              createSale.mutate(payload, { onSuccess: () => setSaleWizard(null) });
            }
          }}
          open={saleWizard !== null}
          saving={createSale.isPending || updateSale.isPending}
        />
      ) : null}
    </div>
  );
}

function DashboardView({
  bootstrap,
  dashboard,
  go,
}: {
  bootstrap: SalesOpsBootstrap;
  dashboard: ReturnType<typeof buildDashboardModel>;
  go: (view: SalesOpsView) => void;
}) {
  const wonSalesLabel =
    dashboard.kpis.wonSalesCount === 1 ? '1 proposta ganha' : `${dashboard.kpis.wonSalesCount} propostas ganhas`;
  return (
    <div className="flex flex-col gap-[14px]">
      <div className="grid gap-[14px] xl:grid-cols-4 md:grid-cols-2">
        <MetricCard
          accent="green"
          label="Receita ganha no mês"
          sub={wonSalesLabel}
          value={formatMoneyBrl(dashboard.kpis.wonRevenueBrl, { maximumFractionDigits: 0 })}
        />
        <MetricCard
          accent="green"
          label="MRR ativo"
          sub="Contratos recorrentes persistidos"
          value={formatMoneyBrl(dashboard.kpis.activeMrrBrl, { maximumFractionDigits: 0 })}
        />
        <MetricCard
          accent="red"
          label="Comissões a pagar"
          sub={`${bootstrap.payables.filter((payable) => payable.status === 'open').length} itens em aberto`}
          value={formatMoneyBrl(dashboard.kpis.payableBrl, { maximumFractionDigits: 0 })}
        />
        <MetricCard
          accent="blue"
          label="Propostas ganhas"
          sub="Propostas com status ganha"
          value={String(dashboard.kpis.wonSalesCount)}
        />
      </div>

      <div className={`${panelClass} p-5`}>
        <div className="mb-[18px] flex items-center justify-between">
          <h3 className="text-[15px] font-bold">Receita por produto</h3>
          <span className="text-xs text-[#9b9ba3]">Dados persistidos</span>
        </div>
        {dashboard.revenueByProduct.length > 0 ? (
          <div className="flex flex-col gap-[14px]">
            {dashboard.revenueByProduct.map((product, index) => (
              <div className="flex items-center gap-4" key={product.name}>
                <span className="w-[160px] flex-none truncate text-[13px] font-semibold">
                  {product.name}
                </span>
                <div className="h-3 flex-1 overflow-hidden rounded-md bg-[#eeeef1]">
                  <div
                    className={`h-full rounded-md ${index % 3 === 0 ? 'bg-[#eaa81a]' : index % 3 === 1 ? 'bg-[#5a9166]' : 'bg-[#3f7cc4]'}`}
                    style={{ width: `${Math.max(8, product.widthPct)}%` }}
                  />
                </div>
                <span className="sales-ops-num w-28 flex-none text-right text-[13.5px] font-bold">
                  {formatMoneyBrl(product.amountBrl, { maximumFractionDigits: 0 })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyPanel
            text="Assim que uma venda real for criada, esta área exibirá o ranking por produto."
            title="Sem receita por produto"
          />
        )}
      </div>

      <div className="grid gap-[14px] lg:grid-cols-2">
        <RankingPanel items={dashboard.topSellers} title="Top vendedores" />
        <RankingPanel items={dashboard.topFinders} title="Top finders" />
      </div>

      <div className={`${panelClass} p-5`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-bold">Últimas propostas</h3>
          <button
            className="text-[13px] font-semibold text-[#9c7210]"
            onClick={() => go('vendas')}
            type="button"
          >
            Ver todas
          </button>
        </div>
        {dashboard.latestSales.length > 0 ? (
          <SalesMiniTable bootstrap={bootstrap} sales={dashboard.latestSales} />
        ) : (
          <EmptyPanel
            text="Use o botão Nova proposta para registrar o primeiro negócio real."
            title="Nenhuma venda registrada"
          />
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: 'green' | 'red' | 'blue';
}) {
  const color = accent === 'green' ? 'text-[#2f9155]' : accent === 'red' ? 'text-[#c0402a]' : 'text-[#3f7cc4]';
  return (
    <div className={`${panelClass} p-[18px]`}>
      <div className="text-[13px] font-semibold leading-tight text-[#8b8b92]">{label}</div>
      <div className={`sales-ops-num mt-[13px] text-[30px] font-bold tracking-normal ${color}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-[#9b9ba3]">{sub}</div>
    </div>
  );
}

function RankingPanel({
  items,
  title,
}: {
  items: Array<{ name: string; totalBrl: number; commissionBrl: number; count: number }>;
  title: string;
}) {
  return (
    <div className={`${panelClass} p-[18px]`}>
      <h3 className="mb-[13px] text-sm font-bold">{title}</h3>
      {items.length > 0 ? (
        <div className="flex flex-col gap-[11px]">
          {items.slice(0, 5).map((item, index) => (
            <div className="flex items-center gap-[11px]" key={item.name}>
              <div className="sales-ops-num flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-[#f7e2a8] text-[13px] font-bold text-[#7a5a12]">
                {index + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold">{item.name}</div>
                <div className="text-xs text-[#9b9ba3]">
                  {item.count} vendas · {formatMoneyBrl(item.totalBrl, { maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="sales-ops-num text-[13.5px] font-bold text-[#9c7210]">
                {formatMoneyBrl(item.commissionBrl, { maximumFractionDigits: 0 })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyPanel
          text="O ranking será calculado a partir das propostas ganhas."
          title="Sem ranking no período"
        />
      )}
    </div>
  );
}

function SalesMiniTable({ bootstrap, sales }: { bootstrap: SalesOpsBootstrap; sales: SalesOpsBootstrap['sales'] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={tableHeadClass}>Cliente</TableHead>
          <TableHead className={tableHeadClass}>Produto</TableHead>
          <TableHead className={tableHeadClass}>Vendedor</TableHead>
          <TableHead className={tableHeadClass}>Finder</TableHead>
          <TableHead className={`${tableHeadClass} text-right`}>Valor</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sales.map((sale) => (
          <TableRow key={sale.id}>
            <TableCell className="px-4 py-3 text-[13.5px] font-semibold">
              {sale.clientNameSnapshot}
            </TableCell>
            <TableCell className={tableCellClass}>{salePrimaryProductName(bootstrap, sale.id)}</TableCell>
            <TableCell className={tableCellClass}>{sale.sellerNameSnapshot}</TableCell>
            <TableCell className={tableCellClass}>{sale.finderNameSnapshot ?? 'Sem finder'}</TableCell>
            <TableCell className="sales-ops-num px-4 py-3 text-right text-[13.5px] font-bold">
              {formatMoneyBrl(sale.totalBrl, { maximumFractionDigits: 0 })}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function saleAreaNames(bootstrap: SalesOpsBootstrap, saleId: string): string {
  const names = [
    ...new Set(
      bootstrap.saleItems
        .filter((item) => item.saleId === saleId)
        .map((item) => item.areaNameSnapshot)
        .filter(Boolean),
    ),
  ];
  return names.length > 0 ? names.join(', ') : '-';
}

type PendingSaleAction =
  | { kind: 'lost'; sale: SalesOpsSale }
  | { kind: 'cancelled'; sale: SalesOpsSale }
  | { kind: 'reopen-won'; sale: SalesOpsSale }
  | { kind: 'cancel-contract'; sale: SalesOpsSale };

const confirmCopy: Record<
  PendingSaleAction['kind'],
  { title: string; description: (code: string) => string; action: string }
> = {
  lost: {
    title: 'Marcar proposta como perdida?',
    description: (code) => `A proposta ${code} será marcada como perdida.`,
    action: 'Marcar como perdida',
  },
  cancelled: {
    title: 'Cancelar proposta?',
    description: (code) => `A proposta ${code} será cancelada e as contas a pagar em aberto serão anuladas.`,
    action: 'Cancelar proposta',
  },
  'reopen-won': {
    title: 'Reabrir proposta ganha?',
    description: (code) =>
      `As contas a pagar em aberto geradas pela proposta ${code} serão anuladas. Pagamentos já baixados não são afetados.`,
    action: 'Reabrir',
  },
  'cancel-contract': {
    title: 'Cancelar contrato?',
    description: (code) =>
      `As parcelas futuras em aberto da proposta ${code} e as comissões vinculadas serão anuladas. Parcelas pagas não são afetadas.`,
    action: 'Cancelar contrato',
  },
};

export function SalesView({
  bootstrap,
  sales,
  canManage,
  onEdit,
  onTransition,
  onCancelContract,
}: {
  bootstrap: SalesOpsBootstrap;
  sales: SalesOpsSale[];
  canManage: boolean;
  onEdit: (sale: SalesOpsSale) => void;
  onTransition: (sale: SalesOpsSale, status: TransitionSaleStatus) => void;
  onCancelContract: (sale: SalesOpsSale) => void;
}) {
  const [pendingAction, setPendingAction] = useState<PendingSaleAction | null>(null);
  const [detailSaleId, setDetailSaleId] = useState<string | null>(null);
  const detailSale =
    sales.find((sale) => sale.id === detailSaleId) ??
    bootstrap.sales.find((sale) => sale.id === detailSaleId) ??
    null;

  function confirmPendingAction() {
    if (!pendingAction) return;
    const { kind, sale } = pendingAction;
    if (kind === 'cancel-contract') onCancelContract(sale);
    else if (kind === 'reopen-won') onTransition(sale, 'open');
    else onTransition(sale, kind);
    setPendingAction(null);
  }

  if (bootstrap.sales.length === 0) {
    return (
      <EmptyPanel
        text="As propostas são carregadas da API de operações comerciais. Use Nova proposta para registrar a primeira."
        title="Nenhuma proposta registrada"
      />
    );
  }

  if (sales.length === 0) {
    return (
      <EmptyPanel
        text="Ajuste os filtros de status e área para ver outras propostas."
        title="Nenhuma proposta encontrada"
      />
    );
  }

  return (
    <div className={`${panelClass} overflow-hidden`}>
      <Table>
        <TableHeader>
          <TableRow className="bg-[#fafafb] hover:bg-[#fafafb]">
            <TableHead className={tableHeadClass}>Código</TableHead>
            <TableHead className={tableHeadClass}>Cliente</TableHead>
            <TableHead className={tableHeadClass}>Vendedor</TableHead>
            <TableHead className={tableHeadClass}>Áreas</TableHead>
            <TableHead className={`${tableHeadClass} text-right`}>Total</TableHead>
            <TableHead className={tableHeadClass}>Status</TableHead>
            <TableHead className={`${tableHeadClass} text-right`}>Data</TableHead>
            {canManage ? <TableHead className={tableHeadClass}>Ações</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sales.map((sale) => {
            const meta = statusMeta(sale.status);
            return (
              <TableRow
                className="cursor-pointer"
                key={sale.id}
                onClick={() => setDetailSaleId(sale.id)}
              >
                <TableCell className="px-4 py-3">
                  <span className="sales-ops-num rounded-md bg-[#eef3f9] px-2 py-1 text-xs font-bold tracking-[0.04em] text-[#3f6ea3]">
                    {sale.code}
                  </span>
                </TableCell>
                <TableCell className="px-4 py-3 text-sm font-semibold text-[#201f24]">
                  {sale.clientNameSnapshot}
                </TableCell>
                <TableCell className={tableCellClass}>{sale.sellerNameSnapshot}</TableCell>
                <TableCell className={tableCellClass}>{saleAreaNames(bootstrap, sale.id)}</TableCell>
                <TableCell className="sales-ops-num px-4 py-3 text-right text-sm font-bold">
                  {formatMoneyBrl(sale.totalBrl, { maximumFractionDigits: 0 })}
                </TableCell>
                <TableCell className="px-4 py-3">
                  <Badge className={meta.className}>{meta.label}</Badge>
                </TableCell>
                <TableCell className="sales-ops-num px-4 py-3 text-right text-[13px] text-[#8b8b92]">
                  {displayDate(sale.baseDate)}
                </TableCell>
                {canManage ? (
                  <TableCell className="px-4 py-3">
                    <div onClick={(event) => event.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            aria-label={`Ações da proposta ${sale.code}`}
                            className={iconButtonClass}
                            type="button"
                          >
                            <MoreHorizontal className="h-[15px] w-[15px]" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-[220px] rounded-xl border-[#e5e5ea] bg-white p-1.5"
                        >
                          {sale.status === 'draft' || sale.status === 'open' ? (
                            <>
                              <DropdownMenuItem onSelect={() => onEdit(sale)}>Editar</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => onTransition(sale, 'won')}>
                                Marcar como ganha
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setPendingAction({ kind: 'lost', sale })}>
                                Marcar como perdida
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => setPendingAction({ kind: 'cancelled', sale })}
                              >
                                Cancelar
                              </DropdownMenuItem>
                            </>
                          ) : null}
                          {sale.status === 'won' ? (
                            <>
                              <DropdownMenuItem
                                onSelect={() => setPendingAction({ kind: 'reopen-won', sale })}
                              >
                                Reabrir
                              </DropdownMenuItem>
                              {sale.recurringBrl > 0 ? (
                                <DropdownMenuItem
                                  onSelect={() => setPendingAction({ kind: 'cancel-contract', sale })}
                                >
                                  Cancelar contrato
                                </DropdownMenuItem>
                              ) : null}
                            </>
                          ) : null}
                          {sale.status === 'lost' || sale.status === 'cancelled' ? (
                            <DropdownMenuItem onSelect={() => onTransition(sale, 'open')}>
                              Reabrir
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <AlertDialog
        onOpenChange={(open) => (!open ? setPendingAction(null) : undefined)}
        open={pendingAction !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingAction ? confirmCopy[pendingAction.kind].title : ''}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction ? confirmCopy[pendingAction.kind].description(pendingAction.sale.code) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPendingAction}>
              {pendingAction ? confirmCopy[pendingAction.kind].action : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SaleDetailDialog
        bootstrap={bootstrap}
        onClose={() => setDetailSaleId(null)}
        sale={detailSale}
      />
    </div>
  );
}

function SaleDetailDialog({
  bootstrap,
  sale,
  onClose,
}: {
  bootstrap: SalesOpsBootstrap;
  sale: SalesOpsSale | null;
  onClose: () => void;
}) {
  if (!sale) return null;

  const meta = statusMeta(sale.status);
  const items = bootstrap.saleItems.filter((item) => item.saleId === sale.id);
  const receivables = [...bootstrap.receivables]
    .filter((row) => row.saleId === sale.id)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const payables = bootstrap.payables.filter((payable) => payable.saleId === sale.id);
  const methodLabels = paymentMethodLabels;
  const receivableStatusMeta: Record<'open' | 'paid' | 'void', { label: string; className: string }> = {
    open: { label: 'Aberta', className: 'bg-[#fdf0cf] text-[#7a5a12]' },
    paid: { label: 'Paga', className: 'bg-[#c9e7cf] text-[#1f7d43]' },
    void: { label: 'Anulada', className: 'bg-[#eeeef1] text-[#6a6a72]' },
  };
  const payableStatusMeta: Record<'open' | 'paid' | 'void', { label: string; className: string }> = {
    open: { label: 'Aberto', className: 'bg-[#fdf0cf] text-[#7a5a12]' },
    paid: { label: 'Pago', className: 'bg-[#c9e7cf] text-[#1f7d43]' },
    void: { label: 'Anulado', className: 'bg-[#eeeef1] text-[#6a6a72]' },
  };
  const showFinderCommission = sale.finderCommissionBrl !== 0 || Boolean(sale.finderNameSnapshot);

  return (
    <Dialog onOpenChange={(open) => (!open ? onClose() : undefined)} open>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-48px)] max-w-[760px] gap-0 overflow-y-auto rounded-[20px] border-none bg-white p-0">
        <DialogHeader className="border-b border-[#e8e8ec] px-6 py-5 text-left">
          <DialogTitle className="sales-ops-num flex items-center gap-3 text-[19px] font-bold text-[#201f24]">
            Proposta {sale.code}
            <Badge className={meta.className}>{meta.label}</Badge>
          </DialogTitle>
          <DialogDescription className="text-[13px] text-[#8b8b92]">
            {sale.clientNameSnapshot} · Vendedor {sale.sellerNameSnapshot}
            {sale.finderNameSnapshot ? ` · Finder ${sale.finderNameSnapshot}` : ''} ·{' '}
            {displayDate(sale.baseDate)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 px-6 py-5">
          <div className="overflow-hidden rounded-[14px] border border-[#e8e8ec]">
            <div className="border-b border-[#eeeef1] bg-[#fafafb] px-4 py-[10px] text-[13px] font-bold">
              Itens
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-[#fafafb] hover:bg-[#fafafb]">
                  <TableHead className={tableHeadClass}>Item</TableHead>
                  <TableHead className={tableHeadClass}>Área</TableHead>
                  <TableHead className={`${tableHeadClass} text-right`}>Qtd</TableHead>
                  <TableHead className={`${tableHeadClass} text-right`}>Unitário</TableHead>
                  <TableHead className={`${tableHeadClass} text-right`}>Subtotal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => (
                  <TableRow key={item.id ?? `${item.saleId}-${index}`}>
                    <TableCell className="px-4 py-3 text-[13.5px] font-semibold">
                      {item.productNameSnapshot}
                    </TableCell>
                    <TableCell className={tableCellClass}>{item.areaNameSnapshot || '-'}</TableCell>
                    <TableCell className="sales-ops-num px-4 py-3 text-right text-[13.5px]">
                      {item.quantity}
                    </TableCell>
                    <TableCell className="sales-ops-num px-4 py-3 text-right text-[13.5px]">
                      {formatMoneyBrl(item.unitBrl, { maximumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className="sales-ops-num px-4 py-3 text-right text-[13.5px] font-bold">
                      {formatMoneyBrl(item.subtotalBrl, { maximumFractionDigits: 0 })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="overflow-hidden rounded-[14px] border border-[#e8e8ec]">
            <div className="border-b border-[#eeeef1] bg-[#fafafb] px-4 py-[10px] text-[13px] font-bold">
              Plano de pagamento
            </div>
            {receivables.length > 0 ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#fafafb] hover:bg-[#fafafb]">
                      <TableHead className={tableHeadClass}>Vencimento</TableHead>
                      <TableHead className={tableHeadClass}>Método</TableHead>
                      <TableHead className={`${tableHeadClass} text-right`}>Valor</TableHead>
                      <TableHead className={tableHeadClass}>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receivables.map((row) => {
                      const rowMeta = receivableStatusMeta[row.status];
                      return (
                        <TableRow key={row.id}>
                          <TableCell className={tableCellClass}>{displayDate(row.dueDate)}</TableCell>
                          <TableCell className={tableCellClass}>{methodLabels[row.method]}</TableCell>
                          <TableCell className="sales-ops-num px-4 py-3 text-right text-[13.5px] font-bold">
                            {formatMoneyBrl(row.amountBrl, { maximumFractionDigits: 0 })}
                          </TableCell>
                          <TableCell className="px-4 py-3">
                            <Badge className={rowMeta.className}>{rowMeta.label}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {sale.recurringBrl > 0 ? (
                  <div className="border-t border-[#eeeef1] px-4 py-[10px] text-[12.5px] text-[#8b8b92]">
                    Recorrência de {formatMoneyBrl(sale.recurringBrl)} por mês
                  </div>
                ) : null}
              </>
            ) : (
              <div className="p-4">
                <EmptyPanel
                  text="Esta proposta não possui parcelas registradas."
                  title="Sem plano de parcelas"
                />
              </div>
            )}
          </div>

          {payables.length > 0 ? (
            <div className="overflow-hidden rounded-[14px] border border-[#e8e8ec]">
              <div className="border-b border-[#eeeef1] bg-[#fafafb] px-4 py-[10px] text-[13px] font-bold">
                Contas a pagar
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#fafafb] hover:bg-[#fafafb]">
                    <TableHead className={tableHeadClass}>Beneficiário</TableHead>
                    <TableHead className={tableHeadClass}>Tipo</TableHead>
                    <TableHead className={tableHeadClass}>Vencimento</TableHead>
                    <TableHead className={`${tableHeadClass} text-right`}>Valor</TableHead>
                    <TableHead className={tableHeadClass}>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payables.map((payable, index) => {
                    const kindMeta = payableTypeMeta(payable.kind);
                    const rowMeta = payableStatusMeta[payable.status] ?? payableStatusMeta.open;
                    return (
                      <TableRow key={payable.id ?? `${payable.saleId}-${index}`}>
                        <TableCell className="px-4 py-3 text-[13.5px] font-semibold">
                          {payable.beneficiaryName}
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <Badge className={kindMeta.className}>{kindMeta.label}</Badge>
                        </TableCell>
                        <TableCell className={tableCellClass}>{displayDate(payable.dueDate)}</TableCell>
                        <TableCell className="sales-ops-num px-4 py-3 text-right text-[13.5px] font-bold">
                          {formatMoneyBrl(payable.amountBrl, { maximumFractionDigits: 0 })}
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <Badge className={rowMeta.className}>{rowMeta.label}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : null}

          <div className="rounded-[14px] border border-[#e8e8ec] p-4">
            <div className="mb-2 text-[13px] font-bold">Margem</div>
            <div className="flex flex-col gap-[7px] text-[13px] text-[#57575f]">
              <div className="flex justify-between gap-4">
                <span>Total</span>
                <span className="sales-ops-num font-semibold text-[#201f24]">
                  {formatMoneyBrl(sale.totalBrl, { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Comissão vendedor</span>
                <span className="sales-ops-num font-semibold text-[#201f24]">
                  {formatMoneyBrl(sale.sellerCommissionBrl, { maximumFractionDigits: 0 })}
                </span>
              </div>
              {showFinderCommission ? (
                <div className="flex justify-between gap-4">
                  <span>Comissão finder</span>
                  <span className="sales-ops-num font-semibold text-[#201f24]">
                    {formatMoneyBrl(sale.finderCommissionBrl, { maximumFractionDigits: 0 })}
                  </span>
                </div>
              ) : null}
              <div className="flex justify-between gap-4">
                <span>Imposto</span>
                <span className="sales-ops-num font-semibold text-[#201f24]">
                  {formatMoneyBrl(sale.taxBrl, { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Custos profissionais</span>
                <span className="sales-ops-num font-semibold text-[#201f24]">
                  {formatMoneyBrl(sale.professionalCostsBrl, { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Outros custos</span>
                <span className="sales-ops-num font-semibold text-[#201f24]">
                  {formatMoneyBrl(sale.otherCostsBrl, { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="mt-1 flex justify-between gap-4 border-t border-[#eeeef1] pt-2 text-[14px] font-bold text-[#201f24]">
                <span>Margem líquida</span>
                <span className="sales-ops-num">
                  {formatMoneyBrl(sale.netMarginBrl, { maximumFractionDigits: 0 })} ({sale.netMarginPct}%)
                </span>
              </div>
            </div>
          </div>

          {sale.notes ? <p className="text-[13px] text-[#8b8b92]">{sale.notes}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The `meus-dados` performance panel behind the `vendedores` and `finders` views.
 * It takes no `onEdit` at all, so "Meus dados reuses the people panels in read-only
 * mode" holds in the type signature and not only in the wiring; people cadastro
 * editing lives exclusively in `PessoasView` under `cadastros/pessoas`.
 */
function MeuPainelView({
  bootstrap,
  mode,
}: {
  bootstrap: SalesOpsBootstrap;
  mode: 'seller' | 'finder';
}) {
  const people = bootstrap.people.filter((person) =>
    hasFuncao(person, mode === 'seller' ? FUNCAO_SLUG_VENDEDOR : FUNCAO_SLUG_FINDER),
  );
  if (people.length === 0) {
    return (
      <EmptyPanel
        text={`Cadastre ${mode === 'seller' ? 'vendedores' : 'finders'} reais para acompanhar performance e comissões.`}
        title={`Nenhum ${mode === 'seller' ? 'vendedor' : 'finder'} cadastrado`}
      />
    );
  }

  return (
    <div className="grid gap-[14px] xl:grid-cols-3 md:grid-cols-2">
      {people.map((person) => {
        const metrics = personMetrics(bootstrap, person, mode);
        return (
          <article className={`${panelClass} p-5 text-left`} key={person.id}>
            <div className="mb-4 flex items-center gap-3">
              <div className="sales-ops-num flex h-[46px] w-[46px] flex-none items-center justify-center rounded-[13px] bg-gradient-to-br from-[#eaa81a] to-[#9c7210] text-[17px] font-bold text-white">
                {initials(person.displayName)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-base font-bold">{person.displayName}</div>
                <div className="text-[12.5px] text-[#8b8b92]">
                  {metrics.sales.length} propostas ganhas no período
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-[#eeeef1] pt-[14px]">
              <div>
                <div className="text-[11.5px] font-semibold text-[#9b9ba3]">Comissão</div>
                <div className="sales-ops-num mt-0.5 text-lg font-bold text-[#9c7210]">
                  {formatMoneyBrl(metrics.commissionBrl, { maximumFractionDigits: 0 })}
                </div>
              </div>
              <div>
                <div className="text-[11.5px] font-semibold text-[#9b9ba3]">Ticket médio</div>
                <div className="sales-ops-num mt-0.5 text-lg font-bold">
                  {formatMoneyBrl(metrics.ticketBrl, { maximumFractionDigits: 0 })}
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function CommissionsView({ bootstrap }: { bootstrap: SalesOpsBootstrap }) {
  const totalOpen = bootstrap.payables
    .filter((payable) => payable.status === 'open')
    .reduce((sum, payable) => sum + payable.amountBrl, 0);
  const totalPaid = bootstrap.payables
    .filter((payable) => payable.status === 'paid')
    .reduce((sum, payable) => sum + payable.amountBrl, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-[14px] md:grid-cols-2">
        <MetricCard
          accent="red"
          label="Total a pagar"
          sub="Itens em aberto"
          value={formatMoneyBrl(totalOpen, { maximumFractionDigits: 0 })}
        />
        <MetricCard
          accent="green"
          label="Total pago no mês"
          sub="Baixas registradas"
          value={formatMoneyBrl(totalPaid, { maximumFractionDigits: 0 })}
        />
      </div>
      {bootstrap.payables.length > 0 ? (
        <div className={`${panelClass} overflow-hidden`}>
          <Table>
            <TableHeader>
              <TableRow className="bg-[#fafafb] hover:bg-[#fafafb]">
                <TableHead className={tableHeadClass}>Beneficiário</TableHead>
                <TableHead className={tableHeadClass}>Tipo</TableHead>
                <TableHead className={`${tableHeadClass} text-right`}>Valor</TableHead>
                <TableHead className={`${tableHeadClass} text-right`}>Vencimento</TableHead>
                <TableHead className={tableHeadClass}>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bootstrap.payables.map((payable, index) => {
                const meta = payableTypeMeta(payable.kind);
                return (
                  <TableRow key={payable.id ?? `${payable.saleId}-${index}`}>
                    <TableCell className="px-4 py-3 text-[13.5px] font-semibold">
                      {payable.beneficiaryName}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge className={meta.className}>{meta.label}</Badge>
                    </TableCell>
                    <TableCell className="sales-ops-num px-4 py-3 text-right text-[13.5px] font-bold">
                      {formatMoneyBrl(payable.amountBrl, { maximumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className="sales-ops-num px-4 py-3 text-right text-[13px] text-[#57575f]">
                      {displayDate(payable.dueDate)}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge
                        className={
                          payable.status === 'paid'
                            ? 'bg-[#c9e7cf] text-[#1f7d43]'
                            : payable.status === 'void'
                              ? 'bg-[#eeeef1] text-[#6a6a72]'
                              : 'bg-[#fdf0cf] text-[#7a5a12]'
                        }
                      >
                        {payable.status === 'paid'
                          ? 'Pago'
                          : payable.status === 'void'
                            ? 'Anulado'
                            : 'Aberto'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyPanel
          text="As contas a pagar são geradas automaticamente quando uma venda é salva."
          title="Nenhuma comissão gerada"
        />
      )}
    </div>
  );
}

function formatProductCommission(type: 'pct' | 'fix', value: string): string {
  const amount = Number(value);
  if (type === 'pct') return `${Number.isFinite(amount) ? amount : 0}%`;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(Number.isFinite(amount) ? amount : 0)
    .replace(/\u00a0/g, ' ');
}

/**
 * Deliberately NOT `formatProductCommission`: a commission value is stored in
 * REAIS (`numeric(10,2)`) while a função cost is stored in integer CENTS, so
 * reusing that helper would render a R$ 300,00 cost as R$ 30.000,00.
 */
function formatFuncaoCost(row: SalesOpsProductFuncaoCost): string {
  return row.mode === 'pct' ? `${pctToInput(row.valuePct, 0)}%` : formatMoneyBrl(row.valueBrl ?? 0);
}

/**
 * A função as the `Custos padrão por função` picker names it. An archived one is
 * marked, because it stays visible on the cost row that already carries it and the
 * operator has to be able to tell that it is no longer assignable.
 */
function funcaoCostOptionLabel(funcao: SalesOpsFuncao): string {
  return funcao.status === 'archived' ? `${funcao.name} (arquivada)` : funcao.name;
}

function productKindOf(product: SalesOpsProduct): SalesOpsProductKind {
  return isServiceProduct(product) ? 'service' : 'product';
}

function funcoesLabel(count: number): string {
  return count === 1 ? '1 função' : `${count} funções`;
}

/**
 * `50% + 3x`, `R$ 5.000,00 + 2x`, `1x`, each optionally ` + mensal`. There is no
 * dash state: `'none'` plus `1` is the stored app default and means "à vista em 1x".
 */
function defaultPlanSummary(product: SalesOpsProduct): string {
  const parts: string[] = [];
  if (product.defaultEntradaMode === 'pct') {
    parts.push(`${pctToInput(product.defaultEntradaPct, 0)}%`);
  } else if (product.defaultEntradaMode === 'fix') {
    parts.push(formatMoneyBrl(product.defaultEntradaBrl ?? 0));
  }
  parts.push(`${Math.max(1, Math.floor(product.defaultRemainingInstallments ?? 1))}x`);
  return `${parts.join(' + ')}${product.hasMonthly ? ' + mensal' : ''}`;
}

export function ProductsView({
  areas,
  products,
  funcoes,
  funcaoCosts,
  kind,
  onKindChange,
  onEdit,
}: {
  areas: SalesOpsArea[];
  products: SalesOpsProduct[];
  funcoes: SalesOpsFuncao[];
  /** Every org cost row, flat. Scoped per row by `productId`, never read off a product. */
  funcaoCosts: SalesOpsProductFuncaoCost[];
  kind: SalesOpsProductKind;
  onKindChange: (kind: SalesOpsProductKind) => void;
  onEdit: (product: SalesOpsProduct) => void;
}) {
  const isService = kind === 'service';
  const produtoCount = products.filter((product) => productKindOf(product) === 'product').length;
  const servicoCount = products.length - produtoCount;
  const visible = products.filter((product) => productKindOf(product) === kind);
  const funcaoNameById = new Map(funcoes.map((funcao) => [funcao.id, funcao.name]));

  return (
    <div className={`${panelClass} overflow-hidden`}>
      {/*
        The filter lives INSIDE the card so filter and rows read as one object, and
        it renders ABOVE the empty state so an operator is never trapped in an empty
        bucket with no way back.
      */}
      <div className="border-b border-[#e8e8ec] px-4 py-3">
        <div className="inline-flex gap-[5px] rounded-[11px] bg-[#f2f2f4] p-1">
          <SegmentedButton
            active={!isService}
            ariaLabel="Filtrar por produtos"
            count={produtoCount}
            onClick={() => onKindChange('product')}
          >
            Produtos
          </SegmentedButton>
          <SegmentedButton
            active={isService}
            ariaLabel="Filtrar por serviços"
            count={servicoCount}
            onClick={() => onKindChange('service')}
          >
            Serviços
          </SegmentedButton>
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="p-4">
          <EmptyPanel
            text={
              isService
                ? 'Cadastre serviços de valor variável para reaproveitar custos por função e padrões de proposta.'
                : 'Cadastre produtos com valor próprio para habilitar a criação de propostas e códigos automáticos.'
            }
            title={isService ? 'Nenhum serviço cadastrado' : 'Nenhum produto cadastrado'}
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-[#fafafb] hover:bg-[#fafafb]">
              <TableHead className={tableHeadClass}>Nome</TableHead>
              <TableHead className={tableHeadClass}>Área</TableHead>
              <TableHead className={`${tableHeadClass} text-center`}>Cód.</TableHead>
              {isService ? (
                <>
                  <TableHead className={`${tableHeadClass} text-right`}>Valor</TableHead>
                  <TableHead className={tableHeadClass}>Plano padrão</TableHead>
                  <TableHead className={`${tableHeadClass} text-center`}>Custos padrão</TableHead>
                </>
              ) : (
                <>
                  <TableHead className={`${tableHeadClass} text-right`}>Setup</TableHead>
                  <TableHead className={`${tableHeadClass} text-right`}>Mensalidade</TableHead>
                </>
              )}
              <TableHead className={`${tableHeadClass} text-center`}>Somente vendedor</TableHead>
              <TableHead className={`${tableHeadClass} text-center`}>Vendedor + Finder</TableHead>
              {isService ? null : (
                <TableHead className={`${tableHeadClass} text-center`}>Recorrente</TableHead>
              )}
              <TableHead className={`${tableHeadClass} text-center`}>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((product) => {
              const costs = funcaoCosts.filter((row) => row.productId === product.id);
              return (
                <TableRow key={product.id}>
                  <TableCell className="px-4 py-3 text-sm font-semibold">{product.name}</TableCell>
                  <TableCell className={tableCellClass}>
                    {areas.find((area) => area.id === product.areaId)?.name ?? '-'}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-center">
                    <span className="sales-ops-num rounded-md bg-[#fdf0cf] px-2 py-1 text-xs font-bold tracking-[0.04em] text-[#9c7210]">
                      ...{product.codeSuffix}
                    </span>
                  </TableCell>
                  {isService ? (
                    <>
                      {/*
                          A serviço's own value is a BASE value, a per-proposta
                          default. `0` is how "no base value" is stored - there is
                          no separate flag - so it prints `Variável` rather than
                          `R$ 0,00`, which would be a lie about a price nobody set.
                        */}
                      <TableCell
                        className={
                          productBaseValueBrl(product) > 0
                            ? 'sales-ops-num px-4 py-3 text-right text-[13.5px]'
                            : 'px-4 py-3 text-right text-[13.5px] text-[#9b9ba3]'
                        }
                      >
                        {productBaseValueBrl(product) > 0
                          ? formatMoneyBrl(productBaseValueBrl(product), {
                              maximumFractionDigits: 0,
                            })
                          : 'Variável'}
                      </TableCell>
                      <TableCell className="sales-ops-num px-4 py-3 text-[13.5px]">
                        {defaultPlanSummary(product)}
                      </TableCell>
                      <TableCell
                        className="px-4 py-3 text-center text-[13.5px]"
                        title={
                          costs.length
                            ? costs
                                .map(
                                  (row) =>
                                    `${funcaoNameById.get(row.funcaoId) ?? 'Função'} · ${formatFuncaoCost(row)}`,
                                )
                                .join(', ')
                            : undefined
                        }
                      >
                        {costs.length ? funcoesLabel(costs.length) : '-'}
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="sales-ops-num px-4 py-3 text-right text-[13.5px]">
                        {formatMoneyBrl(product.setupBrl, { maximumFractionDigits: 0 })}
                      </TableCell>
                      <TableCell className="sales-ops-num px-4 py-3 text-right text-[13.5px]">
                        {product.hasMonthly
                          ? formatMoneyBrl(product.monthlyBrl, { maximumFractionDigits: 0 })
                          : '-'}
                      </TableCell>
                    </>
                  )}
                  <TableCell className="sales-ops-num px-4 py-3 text-center text-[13.5px] font-semibold">
                    {formatProductCommission(
                      product.sellerCommissionType,
                      product.sellerCommissionValue,
                    )}
                  </TableCell>
                  <TableCell className="sales-ops-num px-4 py-3 text-center text-[13.5px] font-semibold">
                    {formatProductCommission(
                      product.sellerWithFinderCommissionType,
                      product.sellerWithFinderCommissionValue,
                    )}{' '}
                    +{' '}
                    {formatProductCommission(
                      product.finderCommissionType,
                      product.finderCommissionValue,
                    )}
                  </TableCell>
                  {isService ? null : (
                    <TableCell className="px-4 py-3 text-center">
                      <Badge
                        className={
                          product.recurringCommission
                            ? 'bg-[#c9e7cf] text-[#1f7d43]'
                            : 'bg-[#eeeef1] text-[#6a6a72]'
                        }
                      >
                        {product.recurringCommission ? 'Sim' : 'Não'}
                      </Badge>
                    </TableCell>
                  )}
                  <TableCell className="px-4 py-3 text-center">
                    <button
                      className={iconButtonClass}
                      onClick={() => onEdit(product)}
                      type="button"
                    >
                      <Edit3 className="h-[15px] w-[15px]" />
                    </button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function ClientsView({
  bootstrap,
  onEdit,
}: {
  bootstrap: SalesOpsBootstrap;
  onEdit: (client: SalesOpsClient) => void;
}) {
  if (bootstrap.clients.length === 0) {
    return (
      <EmptyPanel
        text="Clientes criados no cadastro ou na venda aparecem aqui com receita acumulada."
        title="Nenhum cliente cadastrado"
      />
    );
  }

  return (
    <div className={`${panelClass} overflow-hidden`}>
      <Table>
        <TableHeader>
          <TableRow className="bg-[#fafafb] hover:bg-[#fafafb]">
            <TableHead className={tableHeadClass}>Nome</TableHead>
            <TableHead className={tableHeadClass}>Contato</TableHead>
            <TableHead className={`${tableHeadClass} text-center`}>Nº vendas</TableHead>
            <TableHead className={`${tableHeadClass} text-right`}>Receita total</TableHead>
            <TableHead className={`${tableHeadClass} text-center`}>Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bootstrap.clients.map((client) => {
            const sales = bootstrap.sales.filter(
              (sale) => sale.clientId === client.id || sale.clientNameSnapshot === client.name,
            );
            const total = sales.reduce((sum, sale) => sum + sale.totalBrl, 0);
            const pending = isOptimisticId(client.id);
            return (
              <TableRow key={client.id}>
                <TableCell className="px-4 py-3 text-sm font-semibold">{client.name}</TableCell>
                <TableCell className={tableCellClass}>{client.contact ?? '-'}</TableCell>
                <TableCell className="sales-ops-num px-4 py-3 text-center text-[13.5px]">
                  {sales.length}
                </TableCell>
                <TableCell className="sales-ops-num px-4 py-3 text-right text-[13.5px] font-bold">
                  {formatMoneyBrl(total, { maximumFractionDigits: 0 })}
                </TableCell>
                <TableCell className="px-4 py-3 text-center">
                  <button
                    aria-label={pending ? `Salvando ${client.name}` : `Editar ${client.name}`}
                    className={pending ? iconButtonPendingClass : iconButtonClass}
                    disabled={pending}
                    onClick={() => onEdit(client)}
                    title={pending ? 'Salvando...' : 'Editar'}
                    type="button"
                  >
                    <Edit3 className="h-[15px] w-[15px]" />
                  </button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function AreasView({
  bootstrap,
  onEdit,
}: {
  bootstrap: SalesOpsBootstrap;
  onEdit: (area: SalesOpsArea) => void;
}) {
  if (bootstrap.areas.length === 0) {
    return (
      <EmptyPanel
        text="Cadastre áreas para classificar produtos e itens de venda por unidade de negócio."
        title="Nenhuma área cadastrada"
      />
    );
  }

  return (
    <div className={`${panelClass} overflow-hidden`}>
      <Table>
        <TableHeader>
          <TableRow className="bg-[#fafafb] hover:bg-[#fafafb]">
            <TableHead className={tableHeadClass}>Nome</TableHead>
            <TableHead className={`${tableHeadClass} text-center`}>Status</TableHead>
            <TableHead className={`${tableHeadClass} text-center`}>Nº produtos</TableHead>
            <TableHead className={`${tableHeadClass} text-center`}>Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bootstrap.areas.map((area) => {
            const productCount = bootstrap.products.filter(
              (product) => product.areaId === area.id,
            ).length;
            const pending = isOptimisticId(area.id);
            return (
              <TableRow key={area.id}>
                <TableCell className="px-4 py-3 text-sm font-semibold">{area.name}</TableCell>
                <TableCell className="px-4 py-3 text-center">
                  <Badge
                    className={
                      area.status === 'active'
                        ? 'bg-[#c9e7cf] text-[#1f7d43]'
                        : 'bg-[#eeeef1] text-[#6a6a72]'
                    }
                  >
                    {area.status === 'active' ? 'Ativa' : 'Arquivada'}
                  </Badge>
                </TableCell>
                <TableCell className="sales-ops-num px-4 py-3 text-center text-[13.5px]">
                  {productCount}
                </TableCell>
                <TableCell className="px-4 py-3 text-center">
                  <button
                    aria-label={pending ? `Salvando ${area.name}` : `Editar ${area.name}`}
                    className={pending ? iconButtonPendingClass : iconButtonClass}
                    disabled={pending}
                    onClick={() => onEdit(area)}
                    title={pending ? 'Salvando...' : 'Editar'}
                    type="button"
                  >
                    <Edit3 className="h-[15px] w-[15px]" />
                  </button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

const systemBadgeClass = 'bg-[#fdf0cf] text-[#7a5a12]';
const neutralBadgeClass = 'bg-[#eeeef1] text-[#6a6a72]';

/**
 * The people cadastro: one row per pessoa with the funções she carries. Deliberately
 * a separate component from `MeuPainelView`, because a cadastro table and a personal
 * performance card grid answer different questions; sharing one component would need
 * a mode matrix over both layout and permissions.
 */
export function PessoasView({
  bootstrap,
  onEdit,
}: {
  bootstrap: SalesOpsBootstrap;
  onEdit: (person: SalesOpsPerson) => void;
}) {
  if (bootstrap.people.length === 0) {
    return (
      <EmptyPanel
        text="Cadastre pessoas e atribua funções para usá-las como vendedor, finder ou prestador nas propostas."
        title="Nenhuma pessoa cadastrada"
      />
    );
  }

  return (
    <div className={`${panelClass} overflow-hidden`}>
      <Table>
        <TableHeader>
          <TableRow className="bg-[#fafafb] hover:bg-[#fafafb]">
            <TableHead className={tableHeadClass}>Nome</TableHead>
            <TableHead className={tableHeadClass}>E-mail</TableHead>
            <TableHead className={`${tableHeadClass} text-center`}>Funções</TableHead>
            <TableHead className={`${tableHeadClass} text-center`}>Status</TableHead>
            <TableHead className={`${tableHeadClass} text-center`}>Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bootstrap.people.map((person) => {
            const pending = isOptimisticId(person.id);
            return (
              <TableRow key={person.id}>
                <TableCell className="px-4 py-3 text-sm font-semibold">
                  {person.displayName}
                </TableCell>
                <TableCell className={tableCellClass}>
                  {person.contactEmail ?? <span className="text-[#b6b6bd]">-</span>}
                </TableCell>
                <TableCell className="px-4 py-3">
                  {person.funcoes.length === 0 ? (
                    <div className="text-center text-[13.5px] text-[#b6b6bd]">-</div>
                  ) : (
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {person.funcoes.map((funcao) => (
                        <Badge
                          className={funcao.isSystem ? systemBadgeClass : neutralBadgeClass}
                          key={funcao.id}
                        >
                          {funcao.name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="px-4 py-3 text-center">
                  <Badge
                    className={
                      person.status === 'active'
                        ? 'bg-[#c9e7cf] text-[#1f7d43]'
                        : neutralBadgeClass
                    }
                  >
                    {person.status === 'active' ? 'Ativo' : 'Inativo'}
                  </Badge>
                </TableCell>
                <TableCell className="px-4 py-3 text-center">
                  <button
                    aria-label={
                      pending ? `Salvando ${person.displayName}` : `Editar ${person.displayName}`
                    }
                    className={pending ? iconButtonPendingClass : iconButtonClass}
                    disabled={pending}
                    onClick={() => onEdit(person)}
                    title={pending ? 'Salvando...' : 'Editar'}
                    type="button"
                  >
                    <Edit3 className="h-[15px] w-[15px]" />
                  </button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The funções cadastro. `vendedor` and `finder` are predefined app roles: the API
 * answers `409 funcao_is_system` to any rename or archive, so this table offers no
 * edit affordance for them at all rather than offering one that must fail.
 * There is no delete affordance anywhere: removal is `status: 'archived'`, matching
 * áreas and the fact that the sales-ops router has no DELETE verb.
 * An optimistic row is visible but not editable: its placeholder id would fail the
 * uuid cast on the PATCH path, so the affordance stays disabled until the reconcile
 * swaps in the persisted uuid.
 */
export function FuncoesView({
  bootstrap,
  onEdit,
}: {
  bootstrap: SalesOpsBootstrap;
  onEdit: (funcao: SalesOpsFuncao) => void;
}) {
  if (bootstrap.funcoes.length === 0) {
    return (
      <EmptyPanel
        text="Vendedor e finder são funções predefinidas do app; crie funções personalizadas para prestadores como designer, desenvolvedor ou P.O."
        title="Nenhuma função cadastrada"
      />
    );
  }

  return (
    <div className={`${panelClass} overflow-hidden`}>
      <Table>
        <TableHeader>
          <TableRow className="bg-[#fafafb] hover:bg-[#fafafb]">
            <TableHead className={tableHeadClass}>Nome</TableHead>
            <TableHead className={`${tableHeadClass} text-center`}>Tipo</TableHead>
            <TableHead className={`${tableHeadClass} text-center`}>Status</TableHead>
            <TableHead className={`${tableHeadClass} text-center`}>Nº pessoas</TableHead>
            <TableHead className={`${tableHeadClass} text-center`}>Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bootstrap.funcoes.map((funcao) => {
            // The join key on a person's nested entry is `id`, not `funcaoId`.
            const personCount = bootstrap.people.filter((person) =>
              person.funcoes.some((assigned) => assigned.id === funcao.id),
            ).length;
            const pending = isOptimisticId(funcao.id);
            return (
              <TableRow key={funcao.id}>
                <TableCell className="px-4 py-3 text-sm font-semibold">{funcao.name}</TableCell>
                <TableCell className="px-4 py-3 text-center">
                  <Badge className={funcao.isSystem ? systemBadgeClass : neutralBadgeClass}>
                    {funcao.isSystem ? 'Predefinida' : 'Personalizada'}
                  </Badge>
                </TableCell>
                <TableCell className="px-4 py-3 text-center">
                  <Badge
                    className={
                      funcao.status === 'active'
                        ? 'bg-[#c9e7cf] text-[#1f7d43]'
                        : neutralBadgeClass
                    }
                  >
                    {funcao.status === 'active' ? 'Ativa' : 'Arquivada'}
                  </Badge>
                </TableCell>
                <TableCell className="sales-ops-num px-4 py-3 text-center text-[13.5px]">
                  {personCount}
                </TableCell>
                <TableCell className="px-4 py-3 text-center">
                  {funcao.isSystem ? (
                    <button
                      aria-label="Função predefinida do app"
                      className={`${iconButtonClass} disabled:cursor-not-allowed disabled:opacity-50`}
                      disabled
                      title="Função predefinida do app"
                      type="button"
                    >
                      <Lock className="h-[15px] w-[15px]" />
                    </button>
                  ) : (
                    <button
                      aria-label={pending ? `Salvando ${funcao.name}` : `Editar ${funcao.name}`}
                      className={pending ? iconButtonPendingClass : iconButtonClass}
                      disabled={pending}
                      onClick={() => onEdit(funcao)}
                      title={pending ? 'Salvando...' : 'Editar'}
                      type="button"
                    >
                      <Edit3 className="h-[15px] w-[15px]" />
                    </button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function SettingsView({
  settings,
  onSave,
  isSaving,
}: {
  settings: SalesOpsSettings | null;
  onSave: (payload: SaveSettingsPayload) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState(() => activeSettings(settings));

  function set<K extends keyof SaveSettingsPayload>(key: K, value: SaveSettingsPayload[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      ...form,
      defaultSellerCommissionPct: Number(form.defaultSellerCommissionPct ?? 10),
      defaultFinderCommissionPct: Number(form.defaultFinderCommissionPct ?? 3),
      defaultTaxPct: Number(form.defaultTaxPct ?? 6),
      periodClosingDay: Number(form.periodClosingDay ?? 1),
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <div className="grid gap-[14px] xl:grid-cols-2">
        <div className={`${panelClass} p-[22px]`}>
          <h3 className="mb-4 text-[15px] font-bold">Dados da empresa</h3>
          <div className="grid gap-[13px]">
            <Field label="Razão social">
              <Input
                className="bg-[#fafafb]"
                onChange={(event) => set('legalName', event.target.value)}
                value={form.legalName ?? ''}
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="CNPJ">
                <Input
                  className="bg-[#fafafb]"
                  onChange={(event) => set('document', event.target.value)}
                  value={form.document ?? ''}
                />
              </Field>
              <Field label="Telefone">
                <Input
                  className="bg-[#fafafb]"
                  onChange={(event) => set('phone', event.target.value)}
                  value={form.phone ?? ''}
                />
              </Field>
            </div>
            <Field label="E-mail financeiro">
              <Input
                className="bg-[#fafafb]"
                onChange={(event) => set('financeEmail', event.target.value)}
                value={form.financeEmail ?? ''}
              />
            </Field>
          </div>
        </div>

        <div className={`${panelClass} p-[22px]`}>
          <h3 className="mb-4 text-[15px] font-bold">Comissões padrão</h3>
          <div className="grid gap-[13px]">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Comissão vendedor %">
                <Input
                  className="sales-ops-num bg-[#fafafb]"
                  min={0}
                  onChange={(event) => set('defaultSellerCommissionPct', Number(event.target.value))}
                  type="number"
                  value={form.defaultSellerCommissionPct ?? 10}
                />
              </Field>
              <Field label="Comissão finder %">
                <Input
                  className="sales-ops-num bg-[#fafafb]"
                  min={0}
                  onChange={(event) => set('defaultFinderCommissionPct', Number(event.target.value))}
                  type="number"
                  value={form.defaultFinderCommissionPct ?? 3}
                />
              </Field>
            </div>
            <Toggle
              checked={Boolean(form.commissionOnRecurring)}
              description="Aplicar percentual também sobre mensalidades"
              label="Comissão incide sobre recorrente"
              onChange={(value) => set('commissionOnRecurring', value)}
            />
            <Toggle
              checked={Boolean(form.sellerCanBeFinder)}
              description="Permite comissão dupla na mesma venda"
              label="Vendedor pode ser finder"
              onChange={(value) => set('sellerCanBeFinder', value)}
            />
          </div>
        </div>

        <div className={`${panelClass} p-[22px]`}>
          <h3 className="mb-4 text-[15px] font-bold">Financeiro</h3>
          <div className="grid gap-[13px]">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Imposto padrão %">
                <Input
                  className="sales-ops-num bg-[#fafafb]"
                  min={0}
                  onChange={(event) => set('defaultTaxPct', Number(event.target.value))}
                  type="number"
                  value={form.defaultTaxPct ?? 6}
                />
              </Field>
              <FieldBlock label="Moeda">
                <Combobox
                  aria-label="Moeda"
                  className={formSelectClass}
                  onChange={(value) => set('currency', value)}
                  options={[
                    { value: 'BRL', label: 'Real (BRL)' },
                    { value: 'USD', label: 'Dólar (USD)' },
                  ]}
                  searchPlaceholder="Buscar moeda..."
                  value={form.currency ?? 'BRL'}
                />
              </FieldBlock>
            </div>
            <FieldBlock label="Regime tributário">
              <Combobox
                aria-label="Regime tributário"
                className={formSelectClass}
                onChange={(value) => set('taxRegime', value)}
                options={enumOptions(['Simples Nacional', 'Lucro Presumido', 'Lucro Real'])}
                searchPlaceholder="Buscar regime..."
                value={form.taxRegime ?? 'Simples Nacional'}
              />
            </FieldBlock>
            <Field label="Dia de fechamento do período">
              <Input
                className="sales-ops-num bg-[#fafafb]"
                max={31}
                min={1}
                onChange={(event) => set('periodClosingDay', Number(event.target.value))}
                type="number"
                value={form.periodClosingDay ?? 1}
              />
            </Field>
          </div>
        </div>

        <div className={`${panelClass} p-[22px]`}>
          <h3 className="mb-4 text-[15px] font-bold">Preferências de exibição</h3>
          <div className="grid gap-[15px]">
            <Field label="Densidade das tabelas">
              <div className="flex gap-2">
                {(['comfortable', 'compact'] as const).map((density) => (
                  <button
                    className={`flex-1 rounded-[10px] border px-3 py-2 text-[13.5px] font-bold ${
                      form.tableDensity === density
                        ? 'border-[#eaa81a] bg-[#eef0f3] text-[#9c7210]'
                        : 'border-[#dcdce2] bg-[#fafafb] text-[#57575f]'
                    }`}
                    key={density}
                    onClick={() => set('tableDensity', density)}
                    type="button"
                  >
                    {density === 'comfortable' ? 'Confortável' : 'Compacta'}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Formato de data">
                <Input
                  className="bg-[#fafafb]"
                  onChange={(event) => set('dateFormat', event.target.value)}
                  value={form.dateFormat ?? 'dd/mm/aaaa'}
                />
              </Field>
              <FieldBlock label="Idioma">
                <Combobox
                  aria-label="Idioma"
                  className={formSelectClass}
                  onChange={(value) => set('language', value)}
                  options={[
                    { value: 'pt-BR', label: 'Português (BR)' },
                    { value: 'en', label: 'English' },
                  ]}
                  searchPlaceholder="Buscar idioma..."
                  value={form.language ?? 'pt-BR'}
                />
              </FieldBlock>
            </div>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-3">
        <PrimaryButton disabled={isSaving} type="submit">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar alterações
        </PrimaryButton>
      </div>
    </form>
  );
}

/** One editable row of the `Custos padrão por função` editor. */
type FuncaoCostForm = { funcaoId: string; mode: 'pct' | 'fix'; value: string };

type ProductForm = {
  name: string;
  areaId: string;
  codeSuffix: string;
  kind: SalesOpsProductKind;
  setupBrl: string;
  hasMonthly: boolean;
  monthlyBrl: string;
  recurringCommission: boolean;
  sellerCommissionType: 'pct' | 'fix';
  sellerCommissionValue: string;
  sellerWithFinderCommissionType: 'pct' | 'fix';
  sellerWithFinderCommissionValue: string;
  finderCommissionType: 'pct' | 'fix';
  finderCommissionValue: string;
  defaultPaymentMethod: PaymentMethod;
  defaultEntradaMode: 'none' | 'pct' | 'fix';
  /**
   * One field for both entrada units - a percent when the mode is `'pct'`, reais
   * when it is `'fix'` - because the UI has one input whose unit follows the mode
   * and the DB CHECK forbids both columns being set at once. `submit()` fans it
   * out into exactly one column.
   */
  defaultEntradaValue: string;
  defaultRemainingInstallments: string;
  /** Blank is the ONLY expression of "prazo indeterminado". */
  defaultRecurringCycles: string;
  modules: Array<{ name: string; type: string; valueBrl: string }>;
  funcaoCosts: FuncaoCostForm[];
};

function productForm(
  product?: SalesOpsProduct,
  prefillName?: string,
  kindHint?: SalesOpsProductKind,
  funcaoCosts?: SalesOpsProductFuncaoCost[],
): ProductForm {
  return {
    name: product?.name ?? prefillName ?? '',
    areaId: product?.areaId ?? '',
    codeSuffix: product?.codeSuffix ?? '0',
    kind: product?.kind ?? kindHint ?? 'product',
    setupBrl: centsToOptionalInput(product?.setupBrl),
    hasMonthly: product?.hasMonthly ?? false,
    monthlyBrl: centsToOptionalInput(product?.monthlyBrl),
    recurringCommission: product?.recurringCommission ?? false,
    sellerCommissionType: product?.sellerCommissionType ?? 'pct',
    sellerCommissionValue: pctToInput(product?.sellerCommissionValue, 10),
    sellerWithFinderCommissionType:
      product?.sellerWithFinderCommissionType ?? product?.sellerCommissionType ?? 'pct',
    sellerWithFinderCommissionValue: pctToInput(
      product?.sellerWithFinderCommissionValue ?? product?.sellerCommissionValue,
      product ? 10 : 7,
    ),
    finderCommissionType: product?.finderCommissionType ?? 'pct',
    finderCommissionValue: pctToInput(product?.finderCommissionValue, 3),
    defaultPaymentMethod: product?.defaultPaymentMethod ?? 'pix',
    defaultEntradaMode: product?.defaultEntradaMode ?? 'none',
    defaultEntradaValue:
      product?.defaultEntradaMode === 'pct'
        ? pctToInput(product.defaultEntradaPct, 0)
        : product?.defaultEntradaMode === 'fix'
          ? centsToInput(product.defaultEntradaBrl ?? 0)
          : '',
    defaultRemainingInstallments: String(product?.defaultRemainingInstallments ?? 1),
    defaultRecurringCycles:
      product?.defaultRecurringCycles == null ? '' : String(product.defaultRecurringCycles),
    modules: product?.modules.map((module) => ({
      name: module.name,
      type: module.type,
      valueBrl: centsToInput(module.valueBrl),
    })) ?? [],
    funcaoCosts: (funcaoCosts ?? []).map((row) => ({
      funcaoId: row.funcaoId,
      mode: row.mode,
      value: row.mode === 'pct' ? pctToInput(row.valuePct, 0) : centsToInput(row.valueBrl ?? 0),
    })),
  };
}

/**
 * The one segmented-pill recipe in this file: the produto/serviço list filter, the
 * dialog's kind selector and the commission scenario pills all render through it,
 * so the three cannot drift into looking like three design systems.
 */
function SegmentedButton({
  active,
  children,
  count,
  ariaLabel,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  count?: number;
  ariaLabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-pressed={active}
      className={`flex-1 rounded-lg px-3 py-[9px] text-[13px] font-bold transition ${
        active ? 'bg-[#201f24] text-white' : 'bg-transparent text-[#84848c] hover:text-[#201f24]'
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
      {count === undefined ? null : (
        <span
          className={`sales-ops-num ml-1.5 rounded-md px-1.5 text-[11px] font-bold ${
            active ? 'bg-[#3a393f] text-white' : 'bg-[#e9e9ed] text-[#6a6a72]'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function UnitToggle({
  value,
  active,
  ariaLabel,
  onClick,
}: {
  value: '%' | 'R$';
  active: boolean;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={`w-[42px] rounded-md px-0 py-2 text-[13px] font-bold transition ${
        active ? 'bg-[#201f24] text-white' : 'bg-transparent text-[#84848c] hover:text-[#201f24]'
      }`}
      onClick={onClick}
      type="button"
    >
      {value}
    </button>
  );
}

function UnitInput({
  value,
  onChange,
  unit,
  ariaLabel,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  unit: '%' | 'R$';
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative flex-1">
      <Input
        aria-label={ariaLabel}
        className={`sales-ops-num ${formInputClass} pr-11`}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        type="number"
        value={value}
      />
      <span className="pointer-events-none absolute right-[13px] top-1/2 -translate-y-1/2 text-[13px] font-bold text-[#9b9ba3]">
        {unit}
      </span>
    </div>
  );
}

/**
 * The numbered step bar both wizards wear. Pure presentation with no state of its
 * own: it neither decides what a step contains nor when one may be entered, so the
 * proposta wizard and the produto/serviço wizard can gate their steps on completely
 * different predicates while staying pixel identical in how they show one.
 */
function WizardStepper<S extends number>({
  steps,
  current,
  onSelect,
  isEnabled,
}: {
  steps: Array<{ step: S; label: string }>;
  current: S;
  onSelect: (step: S) => void;
  isEnabled: (step: S) => boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[#e8e8ec] bg-white px-[26px] py-4">
      {steps.map((item, index) => {
        const done = item.step < current;
        const active = item.step === current;
        return (
          <div className="flex flex-none items-center gap-1" key={item.step}>
            <button
              className="flex items-center gap-[9px] focus-visible:outline-none"
              disabled={!isEnabled(item.step)}
              onClick={() => onSelect(item.step)}
              type="button"
            >
              <span
                className={`sales-ops-num flex h-[26px] w-[26px] items-center justify-center rounded-full text-[12.5px] font-bold ${
                  done
                    ? 'bg-[#2f7d4b] text-white'
                    : active
                      ? 'bg-[#eaa81a] text-white'
                      : 'bg-[#ececf1] text-[#9b9ba3]'
                }`}
              >
                {done ? <Check className="h-[13px] w-[13px]" /> : item.step}
              </span>
              <span
                className={`whitespace-nowrap text-[13px] font-semibold ${
                  active || done ? 'text-[#201f24]' : 'text-[#9b9ba3]'
                }`}
              >
                {item.label}
              </span>
            </button>
            {index < steps.length - 1 ? (
              <span className="mx-1 h-0.5 w-[22px] flex-none bg-[#e7e2d6]" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/*
  Four steps, matching the proposta wizard one for one. The order carries the
  operator's one hard constraint: `Pagamento` is strictly after `Valores`, so the plan
  builder can never be reached before Setup and Mensalidade are settled. That is a real
  data dependency and not only a preference - `Número de ciclos` exists only while
  `Possui mensalidade` is on, and that switch lives on `Valores`.

  `Módulos` sits on `Valores` rather than with the custos because a módulo is priced
  sellable value, not a cost: every number the org CHARGES is on one step and every
  number it PAYS OUT on another, the same seam the proposta wizard draws between its
  itens and its custos.
*/
const productWizardSteps: Array<{ step: 1 | 2 | 3 | 4; label: string }> = [
  { step: 1, label: 'Identificação' },
  { step: 2, label: 'Valores' },
  { step: 3, label: 'Pagamento' },
  { step: 4, label: 'Comissões e custos' },
];

export function ProductDialog(props: {
  modal: Extract<ModalState, { kind: 'product' }> | null;
  areas: SalesOpsArea[];
  funcoes: SalesOpsFuncao[];
  /** Only the cost rows of the product being edited; the parent filters by `productId`. */
  funcaoCosts: SalesOpsProductFuncaoCost[];
  onClose: () => void;
  onCreateArea?: (name: string) => Promise<SalesOpsArea | null>;
  onSave: (payload: SaveProductPayload) => void;
  saving: boolean;
}) {
  if (!props.modal) return null;
  return (
    <ProductDialogBody
      // The typed name and the requested kind are both part of the form's identity:
      // opening `Novo serviço` straight after `Novo produto` has to reseed the form,
      // and so does opening the dialog from two different produto create rows.
      key={
        props.modal.product?.id ??
        `new-${props.modal.productKind ?? 'product'}-${props.modal.prefillName ?? ''}`
      }
      areas={props.areas}
      funcaoCosts={props.funcaoCosts}
      funcoes={props.funcoes}
      modal={props.modal}
      onClose={props.onClose}
      onCreateArea={props.onCreateArea}
      onSave={props.onSave}
      saving={props.saving}
    />
  );
}

function ProductDialogBody({
  modal,
  areas,
  funcoes,
  funcaoCosts,
  onClose,
  onCreateArea,
  onSave,
  saving,
}: {
  modal: Extract<ModalState, { kind: 'product' }>;
  areas: SalesOpsArea[];
  funcoes: SalesOpsFuncao[];
  funcaoCosts: SalesOpsProductFuncaoCost[];
  onClose: () => void;
  onCreateArea?: (name: string) => Promise<SalesOpsArea | null>;
  onSave: (payload: SaveProductPayload) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<ProductForm>(() =>
    productForm(modal?.product, modal?.prefillName, modal?.productKind, funcaoCosts),
  );
  const [commissionMode, setCommissionMode] = useState<'seller_only' | 'with_finder'>('seller_only');
  /**
   * An área created from the picker's own create row, kept locally so it is selectable
   * and visible on the trigger immediately, before the bootstrap refetch lands.
   */
  const [createdAreas, setCreatedAreas] = useState<SalesOpsArea[]>([]);
  /*
    `ProductDialog` keys this component on the record being edited, so the same remount
    that reseeds `form` also resets the wizard: an existing produto always opens on step
    1, fully prefilled, with no extra effect to keep the two in sync.
  */
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [showIdentityErrors, setShowIdentityErrors] = useState(false);
  const activeModal = modal;

  function set<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const activeAreas = areas.filter((area) => area.status === 'active');
  const currentArea =
    modal.product?.areaId != null
      ? areas.find((area) => area.id === modal.product?.areaId)
      : undefined;
  const knownAreas =
    currentArea && currentArea.status !== 'active' ? [currentArea, ...activeAreas] : activeAreas;
  const selectableAreas = [
    ...knownAreas,
    ...createdAreas.filter((created) => !knownAreas.some((area) => area.id === created.id)),
  ];

  async function createArea(name: string) {
    if (!onCreateArea) return;
    const created = await onCreateArea(name);
    if (!created) return;
    setCreatedAreas((current) =>
      current.some((area) => area.id === created.id) ? current : [...current, created],
    );
    set('areaId', created.id);
  }

  const isService = form.kind === 'service';
  /*
    The only gate this wizard adds. Both fields are genuinely required - the API rejects
    a produto without either - and both live on step 1, so `canAdvanceStepOne` is also
    the full save predicate: once step 1 passes, the record is savable from anywhere.
    Steps 2-4 add no gate of their own, because every value on them already has a
    legitimate zero state that the current dialog accepts.
  */
  const nameValid = Boolean(form.name.trim());
  const areaValid = Boolean(form.areaId);
  const canAdvanceStepOne = nameValid && areaValid;
  const parcelasCeiling = maxRemainingInstallments(form.defaultEntradaMode);
  /**
   * The pool a NEW cost row may draw from: active, non-system funções only. Paying a
   * vendedor is the `Comissionamento padrão` block's job, and `isSystem` exists to
   * make exactly that distinction.
   */
  const eligibleFuncoes = funcoes.filter(
    (funcao) => funcao.status === 'active' && !funcao.isSystem,
  );
  const funcaoById = new Map(funcoes.map((funcao) => [funcao.id, funcao]));
  const usedFuncaoIds = new Set(form.funcaoCosts.map((row) => row.funcaoId).filter(Boolean));
  const noFuncoesAvailable = eligibleFuncoes.length === 0;
  /*
    Counted against the ELIGIBLE pool only. A row carrying an archived (or otherwise
    non-assignable) função consumes none of that pool, so counting it would disable
    `Adicionar` while an assignable função is still free.
  */
  const usedEligibleCount = eligibleFuncoes.filter((funcao) => usedFuncaoIds.has(funcao.id)).length;
  const allFuncoesUsed = !noFuncoesAvailable && usedEligibleCount >= eligibleFuncoes.length;
  const legacyProviderNames = (activeModal.product?.providers ?? [])
    .map((provider) => provider.personName.trim())
    .filter(Boolean);

  /**
   * What one cost row's picker may show. Built from the UNFILTERED `funcoes` for the
   * row's own stored value, because a função is never deleted, only archived: a cost
   * row pointing at an archived função is the expected end state of archiving one
   * that carries money, not a corrupt row. Resolving it only against
   * `eligibleFuncoes` left the trigger on its placeholder, so the row read as "R$
   * 300,00 for no função" and picking anything silently retargeted the cost.
   *
   * This is CLAUDE.md's "a row's OWN stored função always stays selectable on that
   * row" under Produtos & Serviços, which is the bullet that governs this picker - not
   * the bullet above it, which is about the pool a NEW row draws from. The direct
   * precedent is `selectableAreas` above, which prepends an archived-but-current área
   * into the picker it belongs to. The Pessoa dialog reaches the same principle by
   * splitting the job in two instead (unfiltered chips, active-only add picker), which
   * is why an archived função does vanish from that picker but must not vanish here.
   */
  function costRowFuncaoOptions(row: FuncaoCostForm): ComboboxOption[] {
    const offered = eligibleFuncoes.filter(
      (funcao) => funcao.id === row.funcaoId || !usedFuncaoIds.has(funcao.id),
    );
    const current = row.funcaoId ? funcaoById.get(row.funcaoId) : undefined;
    const withCurrent =
      current && !offered.some((funcao) => funcao.id === current.id)
        ? [current, ...offered]
        : offered;
    return withCurrent.map((funcao) => ({
      value: funcao.id,
      label: funcaoCostOptionLabel(funcao),
    }));
  }

  /**
   * The trigger's text when the stored `funcaoId` resolves to nothing at all, e.g.
   * against a partial bootstrap. Naming it `Função não encontrada` rather than letting
   * the placeholder win keeps the row from reading as money owed to nobody, and says
   * "não encontrada" rather than "removida" because a função is never deleted.
   * Never the raw id.
   */
  function costRowFuncaoValueLabel(row: FuncaoCostForm): string | undefined {
    if (!row.funcaoId) return undefined;
    const current = funcaoById.get(row.funcaoId);
    return current ? funcaoCostOptionLabel(current) : 'Função não encontrada';
  }

  function setKind(kind: SalesOpsProductKind) {
    setForm((current) => ({ ...current, kind }));
  }

  function setEntradaMode(mode: 'none' | 'pct' | 'fix') {
    setForm((current) => {
      const ceiling = maxRemainingInstallments(mode);
      const parcelas = Math.floor(parseDecimal(current.defaultRemainingInstallments, 1));
      return {
        ...current,
        defaultEntradaMode: mode,
        // Adding an entrada row consumes one of the 120 slots, so a 120x template has
        // to come down to 119 the moment the entrada appears. Clamped here rather than
        // only at submit so the visible number never lies about what will be saved.
        defaultRemainingInstallments:
          parcelas > ceiling ? String(ceiling) : current.defaultRemainingInstallments,
        defaultEntradaValue: mode === 'none' ? '' : current.defaultEntradaValue,
      };
    });
  }

  function setCostRow(index: number, patch: Partial<FuncaoCostForm>) {
    setForm((current) => ({
      ...current,
      funcaoCosts: current.funcaoCosts.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    }));
  }

  function advanceProductWizard() {
    if (wizardStep === 1) {
      setShowIdentityErrors(true);
      if (!canAdvanceStepOne) return;
    }
    setWizardStep((current) => (current < 4 ? ((current + 1) as 2 | 3 | 4) : current));
  }

  function goBackProductWizard() {
    setWizardStep((current) => (current > 1 ? ((current - 1) as 1 | 2 | 3) : current));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    /*
      Symmetric guards, and the `name` half is new: the `required` attribute that used
      to be the only thing standing between an empty Nome and a nameless produto is
      unmounted on steps 2-4 now, so the guard has to live here. Both fields are on step
      1, so a blocked submit sends the operator back to the step that can fix it and
      names which field is missing rather than failing silently.
    */
    if (!canAdvanceStepOne) {
      setShowIdentityErrors(true);
      setWizardStep(1);
      return;
    }
    const parcelas = Math.min(
      parcelasCeiling,
      Math.max(1, Math.floor(parseDecimal(form.defaultRemainingInstallments, 1)) || 1),
    );
    const cyclesInput = form.defaultRecurringCycles.trim();
    const cycles =
      !form.hasMonthly || cyclesInput === ''
        ? null
        : Math.min(
            MAX_PLAN_INSTALLMENTS,
            Math.max(1, Math.floor(parseDecimal(cyclesInput, 1)) || 1),
          );
    const payload: SaveProductPayload = {
      id: activeModal.product?.id,
      name: form.name.trim(),
      areaId: form.areaId,
      codeSuffix: form.codeSuffix.replace(/\D/g, '').slice(0, 2) || '0',
      // `kind` only. `openPrice` is a server-written projection of it now, and sending
      // both would be a `kind_open_price_conflict`.
      kind: form.kind,
      setupBrl: parseCurrencyToCents(form.setupBrl),
      hasMonthly: form.hasMonthly,
      monthlyBrl: form.hasMonthly ? parseCurrencyToCents(form.monthlyBrl) : 0,
      recurringCommission: form.hasMonthly && form.recurringCommission,
      sellerCommissionType: form.sellerCommissionType,
      sellerCommissionValue: parseDecimal(form.sellerCommissionValue, 10),
      sellerWithFinderCommissionType: form.sellerWithFinderCommissionType,
      sellerWithFinderCommissionValue: parseDecimal(form.sellerWithFinderCommissionValue, 7),
      finderCommissionType: form.finderCommissionType,
      finderCommissionValue: parseDecimal(form.finderCommissionValue, 3),
      defaultPaymentMethod: form.defaultPaymentMethod,
      defaultEntradaMode: form.defaultEntradaMode,
      defaultEntradaPct:
        form.defaultEntradaMode === 'pct' ? parseDecimal(form.defaultEntradaValue, 0) : null,
      defaultEntradaBrl:
        form.defaultEntradaMode === 'fix' ? parseCurrencyToCents(form.defaultEntradaValue) : null,
      defaultRemainingInstallments: parcelas,
      defaultRecurringCycles: cycles,
      productFuncaoCosts: form.funcaoCosts
        .filter((row) => row.funcaoId)
        .map((row) =>
          row.mode === 'pct'
            ? { funcaoId: row.funcaoId, mode: 'pct' as const, valuePct: parseDecimal(row.value, 0) }
            : {
                funcaoId: row.funcaoId,
                mode: 'fix' as const,
                valueBrl: parseCurrencyToCents(row.value),
              },
        ),
      modules: form.modules
        .filter((module) => module.name.trim())
        .map((module) => ({
          name: module.name.trim(),
          type: module.type.trim() || 'Upsell',
          valueBrl: parseCurrencyToCents(module.valueBrl),
        })),
      // `providers` is deliberately OMITTED rather than sent as []: PATCH leaves an
      // omitted key unchanged, so the deprecated column survives the first edit after
      // this screen shipped and stays readable for the manual re-entry notice below.
      status: 'active',
    };
    onSave(payload);
  }

  /** `Entrada de 50% + 3x do restante · PIX · mensal por 12 ciclos`. */
  function planSummary(): string {
    const parcelas = Math.min(
      parcelasCeiling,
      Math.max(1, Math.floor(parseDecimal(form.defaultRemainingInstallments, 1)) || 1),
    );
    const entrada =
      form.defaultEntradaMode === 'pct'
        ? `Entrada de ${parseDecimal(form.defaultEntradaValue, 0)}%`
        : form.defaultEntradaMode === 'fix'
          ? `Entrada de ${formatMoneyBrl(parseCurrencyToCents(form.defaultEntradaValue))}`
          : null;
    const restante = entrada ? `${parcelas}x do restante` : `${parcelas}x`;
    let summary = `${[entrada, restante].filter(Boolean).join(' + ')} · ${
      paymentMethodLabels[form.defaultPaymentMethod]
    }`;
    if (form.hasMonthly) {
      const cyclesInput = form.defaultRecurringCycles.trim();
      if (cyclesInput === '') {
        summary += ' · mensal por prazo indeterminado';
      } else {
        const cycles = Math.max(1, Math.floor(parseDecimal(cyclesInput, 1)) || 1);
        summary += ` · mensal por ${cycles} ${cycles === 1 ? 'ciclo' : 'ciclos'}`;
      }
    }
    return summary;
  }

  return (
    <Dialog onOpenChange={(open) => (!open ? onClose() : undefined)} open>
      <DialogContent
        className={`${wizardDialogContentClass} [&>button:last-child]:hidden`}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader className={`relative ${wizardHeaderClass}`}>
          <DialogTitle className="sales-ops-num text-[19px] font-bold text-[#201f24]">
            {activeModal.product
              ? isService
                ? 'Editar serviço'
                : 'Editar produto'
              : isService
                ? 'Novo serviço'
                : 'Novo produto'}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-[#8b8b92]">
            {isService
              ? 'Valor variável, custos por função e padrões de proposta'
              : 'Catálogo, valores e comissões padrão'}
          </DialogDescription>
          {/*
            This dialog keeps its own X rather than restyling Radix's, because unifying
            the two would be a DOM change to the proposta wizard with no visible payoff.
            It sits exactly where the wizard puts Radix's, so the two headers still read
            as one piece of chrome.
          */}
          <button
            aria-label="Fechar"
            className="absolute right-[26px] top-[31px] flex h-9 w-9 flex-none items-center justify-center rounded-[10px] border border-[#dcdce2] bg-white text-[#201f24] transition hover:bg-[#f2f2f4]"
            onClick={onClose}
            type="button"
          >
            <span className="relative block h-4 w-4">
              <span className="absolute left-1/2 top-1/2 h-0.5 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded bg-current" />
              <span className="absolute left-1/2 top-1/2 h-0.5 w-4 -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded bg-current" />
            </span>
          </button>
        </DialogHeader>

        {/*
          ONE form around the whole step tree. An unmounted step's values are then
          ordinary React state rather than lost DOM, so a submit from any step emits the
          complete payload and no step needs to be visited for its fields to be sent.
        */}
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <WizardStepper
            current={wizardStep}
            /*
              Nome and Área are the only two fields the API requires and both live on
              step 1, so `canAdvanceStepOne` is the whole gate: there is nothing further
              down that could be incomplete.
            */
            isEnabled={(step) => step === 1 || canAdvanceStepOne}
            onSelect={setWizardStep}
            steps={productWizardSteps}
          />

          <div className={wizardBodyClass}>
            <div className={wizardStepCardClass}>
              {wizardStep === 1 ? (
                <>
                  <div className="flex flex-col gap-[11px]">
                    <div className="flex gap-[5px] rounded-[11px] bg-[#f2f2f4] p-1">
                      <SegmentedButton
                        active={!isService}
                        ariaLabel="Classificar como produto"
                        onClick={() => setKind('product')}
                      >
                        Produto
                      </SegmentedButton>
                      <SegmentedButton
                        active={isService}
                        ariaLabel="Classificar como serviço"
                        onClick={() => setKind('service')}
                      >
                        Serviço
                      </SegmentedButton>
                    </div>
                    <div className="rounded-[11px] border border-[#f0dfae] bg-[#fdf0cf] px-[14px] py-[11px] text-[13px] text-[#57575f]">
                      Tudo aqui é padrão: dentro da proposta você pode alterar qualquer valor sem mexer no
                      cadastro.
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Nome" required>
                      <Input
                        aria-invalid={showIdentityErrors && !nameValid}
                        className={cn(
                          formInputClass,
                          showIdentityErrors && !nameValid && 'border-destructive',
                        )}
                        onChange={(event) => set('name', event.target.value)}
                        placeholder="Nome"
                        required
                        value={form.name}
                      />
                      {showIdentityErrors && !nameValid ? (
                        <span className="flex flex-col gap-1 text-[11.5px] font-semibold text-destructive">
                          Informe o nome do produto.
                        </span>
                      ) : null}
                    </Field>
                    <FieldBlock label="Área" required>
                      <Combobox
                        aria-invalid={showIdentityErrors && !areaValid}
                        aria-label="Área do produto"
                        className={cn(
                          formSelectClass,
                          showIdentityErrors && !areaValid && 'border-destructive',
                        )}
                        emptyMessage="Nenhuma área encontrada"
                        entityGender="f"
                        entityLabel="área"
                        onChange={(value) => set('areaId', value)}
                        onCreate={onCreateArea ? (name) => void createArea(name) : undefined}
                        options={areaOptions(selectableAreas)}
                        placeholder="Selecione a área"
                        searchPlaceholder="Buscar área..."
                        value={form.areaId}
                      />
                      {showIdentityErrors && !areaValid ? (
                        <span className="flex flex-col gap-1 text-[11.5px] font-semibold text-destructive">
                          Selecione a área.
                        </span>
                      ) : null}
                    </FieldBlock>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-xl border border-[#dfe8f2] bg-[#f3f6fa] px-[14px] py-[13px]">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-semibold text-[#201f24]">
                        Final do código da venda
                      </div>
                      <div className="mt-0.5 text-xs text-[#8b8b92]">
                        Todo código gerado para vendas deste produto termina neste número
                      </div>
                    </div>
                    <div className="sales-ops-num flex flex-none items-center rounded-[10px] border border-[#dcdce2] bg-white py-2 pl-[13px] pr-1.5 text-[15px] font-bold tracking-[0.06em] text-[#b0b0b8]">
                      0000-
                      <input
                        className="sales-ops-num w-10 border-none bg-transparent px-0.5 text-center text-[15px] font-bold text-[#3f6ea3] outline-none"
                        inputMode="numeric"
                        maxLength={2}
                        onChange={(event) =>
                          set('codeSuffix', event.target.value.replace(/\D/g, '').slice(0, 2))
                        }
                        placeholder="0"
                        type="text"
                        value={form.codeSuffix}
                      />
                    </div>
                  </div>
                </>
              ) : null}

              {wizardStep === 2 ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label={isService ? 'Valor base (R$)' : 'Setup (R$)'}>
                      <Input
                        className={`sales-ops-num ${formInputClass}`}
                        onChange={(event) => set('setupBrl', event.target.value)}
                        // A blank field is the zero state. For a Serviço that is the whole
                        // catalog as it stands today, so it keeps saying `Definido na venda`
                        // rather than showing a price nobody set; for a Produto the ghosted
                        // `0` reads exactly as the literal `0` it replaces.
                        placeholder={isService ? 'Definido na venda' : '0'}
                        type="number"
                        value={form.setupBrl}
                      />
                    </Field>
                  </div>

                  <div className="rounded-xl border border-[#ececf1] bg-[#fafafb]">
                    <div className="flex items-center justify-between gap-4 px-[14px] py-3">
                      <div>
                        <div className="text-[13.5px] font-semibold text-[#201f24]">Possui mensalidade</div>
                        <div className="text-xs text-[#8b8b92]">Cobrança recorrente além do setup</div>
                      </div>
                      <button
                        aria-label="Possui mensalidade"
                        aria-pressed={form.hasMonthly}
                        className={`relative h-[25px] w-11 flex-none rounded-full transition ${form.hasMonthly ? 'bg-[#2f7d4b]' : 'bg-[#d2d2d8]'}`}
                        onClick={() => set('hasMonthly', !form.hasMonthly)}
                        type="button"
                      >
                        <span
                          className={`absolute top-[2.5px] h-5 w-5 rounded-full bg-white transition ${form.hasMonthly ? 'right-[2.5px]' : 'left-[2.5px]'}`}
                        />
                      </button>
                    </div>
                    {form.hasMonthly ? (
                      <div className="flex flex-col gap-[11px] px-[14px] pb-[14px]">
                        <Field label="Valor da mensalidade (R$)">
                          <Input
                            className={`sales-ops-num bg-white ${formInputClass}`}
                            onChange={(event) => set('monthlyBrl', event.target.value)}
                            placeholder={isService ? 'Definido na venda' : '0'}
                            type="number"
                            value={form.monthlyBrl}
                          />
                        </Field>
                        <div className="flex items-center justify-between gap-4 rounded-[11px] border border-[#ececf1] bg-white px-[13px] py-[11px]">
                          <div>
                            <div className="text-[13px] font-semibold text-[#201f24]">
                              Incide sobre recorrente
                            </div>
                            <div className="text-[11.5px] text-[#8b8b92]">
                              Aplicar comissão também na mensalidade
                            </div>
                          </div>
                          <button
                            aria-label="Incide sobre recorrente"
                            aria-pressed={form.recurringCommission}
                            className={`relative h-[25px] w-11 flex-none rounded-full transition ${form.recurringCommission ? 'bg-[#2f7d4b]' : 'bg-[#d2d2d8]'}`}
                            onClick={() => set('recurringCommission', !form.recurringCommission)}
                            type="button"
                          >
                            <span
                              className={`absolute top-[2.5px] h-5 w-5 rounded-full bg-white transition ${form.recurringCommission ? 'right-[2.5px]' : 'left-[2.5px]'}`}
                            />
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {isService ? null : (
                    <ListEditor
                      addLabel="Adicionar"
                      empty="Nenhum módulo adicionado"
                      onAdd={() =>
                        set('modules', [...form.modules, { name: '', type: 'Upsell', valueBrl: '0.00' }])
                      }
                      subtitle="Upsell, downsell e complementos"
                      title="Módulos"
                    >
                      {form.modules.map((module, index) => (
                        <div className="rounded-xl border border-[#ececf1] bg-[#fafafb] p-[11px]" key={index}>
                          <div className="mb-2 flex items-center gap-2">
                            <Input
                              className={`bg-white ${formInputClass}`}
                              onChange={(event) => {
                                const next = [...form.modules];
                                next[index] = { ...module, name: event.target.value };
                                set('modules', next);
                              }}
                              placeholder="Nome do módulo"
                              value={module.name}
                            />
                            <button
                              aria-label="Remover módulo"
                              className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] border border-[#e6d3d0] bg-white text-[#b23a22] transition hover:bg-[#fbf0ee]"
                              onClick={() => set('modules', form.modules.filter((_, itemIndex) => itemIndex !== index))}
                              type="button"
                            >
                              <Trash2 className="h-[15px] w-[15px]" />
                            </button>
                          </div>
                          <div className="flex gap-2">
                            <div className="flex-[0_0_132px]">
                              <Combobox
                                aria-label={`Tipo do módulo ${index + 1}`}
                                className={cn(formSelectClass, 'bg-white')}
                                onChange={(value) => {
                                  const next = [...form.modules];
                                  next[index] = { ...module, type: value };
                                  set('modules', next);
                                }}
                                options={enumOptions([
                                  'Módulo',
                                  'Upsell',
                                  'Downsell',
                                  'Cross-sell',
                                  'Add-on',
                                ])}
                                searchPlaceholder="Buscar tipo..."
                                value={module.type}
                              />
                            </div>
                            <div className="relative flex-1">
                              <span className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 text-[12.5px] font-bold text-[#9b9ba3]">
                                R$
                              </span>
                              <Input
                                className={`sales-ops-num bg-white pl-8 ${formInputClass}`}
                                onChange={(event) => {
                                  const next = [...form.modules];
                                  next[index] = { ...module, valueBrl: event.target.value };
                                  set('modules', next);
                                }}
                                placeholder="0"
                                type="number"
                                value={module.valueBrl}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </ListEditor>
                  )}
                </>
              ) : null}

              {wizardStep === 3 ? (
                <>
                  <DialogSection
                    flush
                    subtitle="Aplicado ao gerar as parcelas da proposta - sem datas fixas"
                    title="Plano de pagamento padrão"
                  >
                    <div className="flex flex-col gap-[11px] rounded-xl border border-[#ececf1] bg-[#fafafb] p-[11px]">
                      <div className="flex flex-wrap items-end gap-[9px]">
                        <FieldBlock label="Tipo de entrada">
                          <div className="w-[132px]">
                            <Combobox
                              aria-label="Tipo de entrada"
                              className={cn(formSelectClass, 'bg-white')}
                              onChange={(value) => setEntradaMode(value as 'none' | 'pct' | 'fix')}
                              options={entradaModeOptions}
                              searchPlaceholder="Buscar tipo de entrada..."
                              value={form.defaultEntradaMode}
                            />
                          </div>
                        </FieldBlock>
                        {form.defaultEntradaMode === 'none' ? null : (
                          <Field label="Valor da entrada">
                            <div className="flex w-[148px]">
                              <UnitInput
                                ariaLabel="Valor da entrada"
                                onChange={(value) => set('defaultEntradaValue', value)}
                                unit={form.defaultEntradaMode === 'fix' ? 'R$' : '%'}
                                value={form.defaultEntradaValue}
                              />
                            </div>
                          </Field>
                        )}
                        <Field label="Restante">
                          <div className="flex items-center gap-2">
                            <Input
                              aria-label="Parcelas restantes"
                              className={`sales-ops-num w-[72px] text-center ${formInputClass}`}
                              max={parcelasCeiling}
                              min={1}
                              onChange={(event) =>
                                set('defaultRemainingInstallments', event.target.value)
                              }
                              type="number"
                              value={form.defaultRemainingInstallments}
                            />
                            <span className="text-[13px] font-bold text-[#9b9ba3]">x</span>
                          </div>
                        </Field>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <FieldBlock label="Forma de pagamento padrão">
                          <Combobox
                            aria-label="Forma de pagamento padrão"
                            className={cn(formSelectClass, 'bg-white')}
                            onChange={(value) => set('defaultPaymentMethod', value as PaymentMethod)}
                            options={defaultPaymentMethodOptions}
                            searchPlaceholder="Buscar forma de pagamento..."
                            value={form.defaultPaymentMethod}
                          />
                        </FieldBlock>
                        {form.hasMonthly ? (
                          <Field label="Número de ciclos">
                            <Input
                              aria-label="Número de ciclos"
                              className={`sales-ops-num bg-white ${formInputClass}`}
                              max={MAX_PLAN_INSTALLMENTS}
                              min={1}
                              onChange={(event) => set('defaultRecurringCycles', event.target.value)}
                              placeholder="Indeterminado"
                              type="number"
                              value={form.defaultRecurringCycles}
                            />
                          </Field>
                        ) : null}
                      </div>
                      {form.hasMonthly ? (
                        <div className="text-[11.5px] text-[#8b8b92]">
                          Deixe em branco para prazo indeterminado
                        </div>
                      ) : null}
                      <div className="flex items-center gap-2.5 rounded-[11px] border border-[#cfe4cf] bg-[#e2efe2] px-[14px] py-[11px] text-[13px] font-semibold text-[#2f7d4b]">
                        <RotateCcw className="h-4 w-4 flex-none" />
                        {planSummary()}
                      </div>
                    </div>
                  </DialogSection>
                </>
              ) : null}

              {wizardStep === 4 ? (
                <>
                  <DialogSection
                    flush
                    subtitle="Sugestão aplicada ao criar a proposta"
                    title="Comissionamento padrão"
                  >
                    <div className="mb-[14px] flex gap-[5px] rounded-[11px] bg-[#f2f2f4] p-1">
                      <SegmentedButton
                        active={commissionMode === 'seller_only'}
                        onClick={() => setCommissionMode('seller_only')}
                      >
                        Somente vendedor
                      </SegmentedButton>
                      <SegmentedButton
                        active={commissionMode === 'with_finder'}
                        onClick={() => setCommissionMode('with_finder')}
                      >
                        Vendedor + Finder
                      </SegmentedButton>
                    </div>

                    <div className="mb-3">
                      <div className="mb-1.5 text-xs font-semibold text-[#8b8b92]">Comissão do vendedor</div>
                      <div className="flex gap-[9px]">
                        <div className="flex flex-none gap-[3px] rounded-[9px] bg-[#f2f2f4] p-[3px]">
                          <UnitToggle
                            active={
                              commissionMode === 'seller_only'
                                ? form.sellerCommissionType === 'pct'
                                : form.sellerWithFinderCommissionType === 'pct'
                            }
                            ariaLabel={`Comissão do vendedor - ${commissionMode === 'seller_only' ? 'somente vendedor' : 'com finder'} em porcentagem`}
                            onClick={() =>
                              commissionMode === 'seller_only'
                                ? set('sellerCommissionType', 'pct')
                                : set('sellerWithFinderCommissionType', 'pct')
                            }
                            value="%"
                          />
                          <UnitToggle
                            active={
                              commissionMode === 'seller_only'
                                ? form.sellerCommissionType === 'fix'
                                : form.sellerWithFinderCommissionType === 'fix'
                            }
                            ariaLabel={`Comissão do vendedor - ${commissionMode === 'seller_only' ? 'somente vendedor' : 'com finder'} em reais`}
                            onClick={() =>
                              commissionMode === 'seller_only'
                                ? set('sellerCommissionType', 'fix')
                                : set('sellerWithFinderCommissionType', 'fix')
                            }
                            value="R$"
                          />
                        </div>
                        <UnitInput
                          ariaLabel={`Comissão do vendedor - ${commissionMode === 'seller_only' ? 'somente vendedor' : 'com finder'}`}
                          onChange={(value) =>
                            commissionMode === 'seller_only'
                              ? set('sellerCommissionValue', value)
                              : set('sellerWithFinderCommissionValue', value)
                          }
                          unit={
                            (commissionMode === 'seller_only'
                              ? form.sellerCommissionType
                              : form.sellerWithFinderCommissionType) === 'fix'
                              ? 'R$'
                              : '%'
                          }
                          value={
                            commissionMode === 'seller_only'
                              ? form.sellerCommissionValue
                              : form.sellerWithFinderCommissionValue
                          }
                        />
                      </div>
                    </div>

                    {commissionMode === 'with_finder' ? (
                      <div>
                        <div className="mb-1.5 text-xs font-semibold text-[#8b8b92]">Comissão do finder</div>
                        <div className="flex gap-[9px]">
                          <div className="flex flex-none gap-[3px] rounded-[9px] bg-[#f2f2f4] p-[3px]">
                            <UnitToggle
                              active={form.finderCommissionType === 'pct'}
                              ariaLabel="Comissão do finder em porcentagem"
                              onClick={() => set('finderCommissionType', 'pct')}
                              value="%"
                            />
                            <UnitToggle
                              active={form.finderCommissionType === 'fix'}
                              ariaLabel="Comissão do finder em reais"
                              onClick={() => set('finderCommissionType', 'fix')}
                              value="R$"
                            />
                          </div>
                          <UnitInput
                            ariaLabel="Comissão do finder"
                            onChange={(value) => set('finderCommissionValue', value)}
                            unit={form.finderCommissionType === 'fix' ? 'R$' : '%'}
                            value={form.finderCommissionValue}
                          />
                        </div>
                      </div>
                    ) : null}
                  </DialogSection>

                  <ListEditor
                    addDisabled={noFuncoesAvailable || allFuncoesUsed}
                    addLabel="Adicionar"
                    addTitle={
                      noFuncoesAvailable
                        ? 'Nenhuma função cadastrada ainda. Cadastre as funções em Cadastros > Funções para definir custos padrão.'
                        : allFuncoesUsed
                          ? 'Todas as funções já têm custo padrão'
                          : undefined
                    }
                    empty={
                      noFuncoesAvailable
                        ? 'Nenhuma função cadastrada ainda. Cadastre as funções em Cadastros > Funções para definir custos padrão.'
                        : 'Nenhum custo padrão definido'
                    }
                    footer={
                      legacyProviderNames.length ? (
                        <div className="mt-2.5 text-[12px] text-[#8b8b92]">
                          Prestadores antigos deste cadastro não foram convertidos automaticamente:{' '}
                          {legacyProviderNames.join(', ')}. Recadastre o custo por função acima.
                        </div>
                      ) : null
                    }
                    onAdd={() =>
                      set('funcaoCosts', [...form.funcaoCosts, { funcaoId: '', mode: 'pct', value: '0' }])
                    }
                    subtitle="Quanto cada função custa neste item por padrão"
                    title="Custos padrão por função"
                  >
                    {form.funcaoCosts.map((row, index) => (
                      <div className="rounded-xl border border-[#ececf1] bg-[#fafafb] p-[11px]" key={index}>
                        <div className="mb-2 flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <Combobox
                              aria-label={`Função do custo padrão ${index + 1}`}
                              className={cn(formSelectClass, 'bg-white')}
                              emptyMessage="Nenhuma função disponível"
                              entityGender="f"
                              entityLabel="função"
                              onChange={(value) => setCostRow(index, { funcaoId: value })}
                              /*
                                A função already used by another row is filtered out, so the
                                client can never send two rows for one função and trip the
                                API's duplicate_funcao_cost. The row's own stored função is
                                always admitted, archived or not.
                              */
                              options={costRowFuncaoOptions(row)}
                              placeholder="Selecione a função"
                              searchPlaceholder="Buscar função..."
                              value={row.funcaoId}
                              /*
                                Belt and braces for a stored funcaoId that is in `funcoes`
                                under no status at all, e.g. against a stale bootstrap: the
                                trigger still names it rather than falling back to the
                                placeholder and reading as a cost for no função.
                              */
                              valueLabel={costRowFuncaoValueLabel(row)}
                            />
                          </div>
                          <button
                            aria-label={`Remover custo padrão ${index + 1}`}
                            className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] border border-[#e6d3d0] bg-white text-[#b23a22] transition hover:bg-[#fbf0ee]"
                            onClick={() =>
                              set(
                                'funcaoCosts',
                                form.funcaoCosts.filter((_, rowIndex) => rowIndex !== index),
                              )
                            }
                            type="button"
                          >
                            <Trash2 className="h-[15px] w-[15px]" />
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <div className="flex flex-none gap-[3px] rounded-[9px] bg-[#f2f2f4] p-[3px]">
                            <UnitToggle
                              active={row.mode === 'pct'}
                              /*
                                Indexed rather than name-interpolated: the label has to be
                                stable from the moment the row is added, before a função is
                                even chosen.
                              */
                              ariaLabel={`Custo da função ${index + 1} em porcentagem`}
                              onClick={() => setCostRow(index, { mode: 'pct' })}
                              value="%"
                            />
                            <UnitToggle
                              active={row.mode === 'fix'}
                              ariaLabel={`Custo da função ${index + 1} em reais`}
                              onClick={() => setCostRow(index, { mode: 'fix' })}
                              value="R$"
                            />
                          </div>
                          <UnitInput
                            ariaLabel={`Custo da função ${index + 1}`}
                            onChange={(value) => setCostRow(index, { value })}
                            unit={row.mode === 'fix' ? 'R$' : '%'}
                            value={row.value}
                          />
                        </div>
                      </div>
                    ))}
                  </ListEditor>
                </>
              ) : null}
            </div>
          </div>

          <div className={wizardFooterClass}>
            <div className="flex items-center gap-2.5">
              <button
                className={`${wizardSecondaryButtonClass} ${wizardStep === 1 ? 'invisible' : ''}`}
                onClick={goBackProductWizard}
                type="button"
              >
                Voltar
              </button>
              {wizardStep === 1 ? (
                <button className={wizardSecondaryButtonClass} onClick={onClose} type="button">
                  Cancelar
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-[#9b9ba3]">Passo {wizardStep} de 4</span>
              {/*
                The produto equivalent of the proposta wizard's `Salvar rascunho`, in the
                same slot for the same reason: an EXISTING record is savable the moment
                step 1 is valid, so making the operator walk to step 4 to change one
                number would be busywork. A new produto gets no such button, so the create
                path shows the commission and cost defaults at least once.
              */}
              {activeModal.product && wizardStep < 4 ? (
                <button
                  className={`${wizardSecondaryButtonClass} disabled:cursor-not-allowed disabled:opacity-45`}
                  disabled={!canAdvanceStepOne || saving}
                  title="Salvar sem passar pelos próximos passos"
                  type="submit"
                >
                  Salvar alterações
                </button>
              ) : null}
              <button
                className={wizardPrimaryButtonClass}
                disabled={saving || (wizardStep === 1 && !canAdvanceStepOne)}
                onClick={wizardStep < 4 ? advanceProductWizard : undefined}
                type={wizardStep < 4 ? 'button' : 'submit'}
              >
                {wizardStep < 4
                  ? 'Avançar'
                  : saving
                    ? 'Salvando'
                    : activeModal.product
                      ? 'Salvar alterações'
                      : 'Adicionar'}
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The one section-header recipe inside a dialog. `ListEditor` renders through it,
 * so a repeating-row section and a plain section are typographically identical.
 */
function DialogSection({
  title,
  subtitle,
  action,
  children,
  flush,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  /**
   * Drops the separating rule, for a section that is the FIRST thing on a wizard step
   * and therefore has nothing above it to be separated from. Everywhere else the rule
   * stays, which is also what keeps `closest('div.border-t')` resolving a repeating
   * section's own `Adicionar` button.
   */
  flush?: boolean;
}) {
  return (
    <div className={flush ? undefined : 'border-t border-[#ececf1] pt-4'}>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]">
            {title}
          </div>
          {subtitle ? <div className="mt-0.5 text-[11.5px] text-[#b0b0b8]">{subtitle}</div> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function ListEditor({
  title,
  subtitle,
  empty,
  addLabel,
  addDisabled,
  addTitle,
  onAdd,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  empty: string;
  addLabel: string;
  addDisabled?: boolean;
  addTitle?: string;
  onAdd: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <DialogSection
      action={
        <button
          className="flex flex-none items-center gap-1 rounded-[9px] border border-[#dcdce2] bg-white px-[11px] py-[7px] text-[12.5px] font-bold text-[#57575f] transition hover:border-[#eaa81a] hover:bg-[#f2f2f4] hover:text-[#9c7210] disabled:cursor-not-allowed disabled:border-[#ececf1] disabled:bg-[#f6f6f8] disabled:text-[#b6b6bd]"
          disabled={addDisabled}
          onClick={onAdd}
          title={addTitle}
          type="button"
        >
          <Plus className="h-[13px] w-[13px]" />
          {addLabel}
        </button>
      }
      subtitle={subtitle}
      title={title}
    >
      <div className="flex flex-col gap-2">
        {hasChildren ? (
          children
        ) : (
          <div className="rounded-[11px] border border-dashed border-[#dcdce2] p-[15px] text-center text-[12.5px] text-[#a0a0a8]">
            {empty}
          </div>
        )}
      </div>
      {footer}
    </DialogSection>
  );
}

export function ClientDialog(props: {
  modal: Extract<ModalState, { kind: 'client' }> | null;
  onClose: () => void;
  onSave: (payload: SaveClientPayload) => void;
  saving: boolean;
}) {
  if (!props.modal) return null;
  return (
    <ClientDialogBody
      key={props.modal.client?.id ?? 'new-client'}
      modal={props.modal}
      onClose={props.onClose}
      onSave={props.onSave}
      saving={props.saving}
    />
  );
}

function ClientDialogBody({
  modal,
  onClose,
  onSave,
  saving,
}: {
  modal: Extract<ModalState, { kind: 'client' }>;
  onClose: () => void;
  onSave: (payload: SaveClientPayload) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(modal.client?.name ?? '');
  const [contact, setContact] = useState(modal.client?.contact ?? '');
  const [legalName, setLegalName] = useState(modal.client?.legalName ?? '');
  const [documentNumber, setDocumentNumber] = useState(modal.client?.document ?? '');
  const [address, setAddress] = useState(modal.client?.address ?? '');
  const [legalRepName, setLegalRepName] = useState(modal.client?.legalRepName ?? '');
  const [legalRepDocument, setLegalRepDocument] = useState(modal.client?.legalRepDocument ?? '');
  const activeModal = modal;

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      id: activeModal.client?.id,
      name: name.trim(),
      contact: contact.trim() || null,
      legalName: legalName.trim() || null,
      document: documentNumber.trim() || null,
      address: address.trim() || null,
      legalRepName: legalRepName.trim() || null,
      legalRepDocument: legalRepDocument.trim() || null,
    });
  }

  return (
    <Dialog onOpenChange={(open) => (!open ? onClose() : undefined)} open>
      <DialogContent className="max-h-[85vh] max-w-[520px] overflow-y-auto rounded-[20px] border-none bg-white p-0">
        <DialogHeader className="border-b border-[#e8e8ec] px-6 py-5 text-left">
          <DialogTitle className="sales-ops-num text-[19px]">Cliente</DialogTitle>
          <DialogDescription>Nome comercial, contato e dados para contrato.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4 px-6 py-5" onSubmit={submit}>
          <Field label="Nome" required>
            <Input className="bg-[#fafafb]" onChange={(event) => setName(event.target.value)} value={name} />
          </Field>
          <Field label="Contato">
            <Input
              className="bg-[#fafafb]"
              onChange={(event) => setContact(event.target.value)}
              placeholder="e-mail ou telefone"
              value={contact}
            />
          </Field>
          <div className="flex flex-col gap-1 border-t border-[#e8e8ec] pt-4">
            <span className="text-[13px] font-semibold text-[#3a3a40]">Dados para contrato</span>
            <span className="text-xs text-[#a0a0a8]">Campos opcionais usados na geração de contratos.</span>
          </div>
          <Field label="Razão social">
            <Input
              aria-label="Razão social"
              className="bg-[#fafafb]"
              onChange={(event) => setLegalName(event.target.value)}
              placeholder="Razão social do cliente"
              value={legalName}
            />
          </Field>
          <Field label="CNPJ/CPF">
            <Input
              aria-label="CNPJ/CPF"
              className="bg-[#fafafb]"
              onChange={(event) => setDocumentNumber(event.target.value)}
              placeholder="00.000.000/0000-00"
              value={documentNumber}
            />
          </Field>
          <Field label="Endereço">
            <Input
              aria-label="Endereço"
              className="bg-[#fafafb]"
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Rua, número, bairro, cidade - UF, CEP"
              value={address}
            />
          </Field>
          <Field label="Representante legal">
            <Input
              aria-label="Representante legal"
              className="bg-[#fafafb]"
              onChange={(event) => setLegalRepName(event.target.value)}
              placeholder="Nome completo"
              value={legalRepName}
            />
          </Field>
          <Field label="CPF do representante">
            <Input
              aria-label="CPF do representante"
              className="bg-[#fafafb]"
              onChange={(event) => setLegalRepDocument(event.target.value)}
              placeholder="000.000.000-00"
              value={legalRepDocument}
            />
          </Field>
          <div className="flex justify-end gap-3 border-t border-[#e8e8ec] pt-4">
            <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
            <PrimaryButton disabled={saving || !name.trim()} type="submit">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </PrimaryButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AreaDialog(props: {
  modal: Extract<ModalState, { kind: 'area' }> | null;
  onClose: () => void;
  onSave: (payload: SaveAreaPayload) => void;
  saving: boolean;
}) {
  if (!props.modal) return null;
  return (
    <AreaDialogBody
      key={props.modal.area?.id ?? 'new-area'}
      modal={props.modal}
      onClose={props.onClose}
      onSave={props.onSave}
      saving={props.saving}
    />
  );
}

function AreaDialogBody({
  modal,
  onClose,
  onSave,
  saving,
}: {
  modal: Extract<ModalState, { kind: 'area' }>;
  onClose: () => void;
  onSave: (payload: SaveAreaPayload) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(modal.area?.name ?? '');
  const [status, setStatus] = useState<'active' | 'archived'>(modal.area?.status ?? 'active');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    onSave({ id: modal.area?.id, name: name.trim(), status });
  }

  return (
    <Dialog onOpenChange={(open) => (!open ? onClose() : undefined)} open>
      <DialogContent className="max-w-[520px] rounded-[20px] border-none bg-white p-0">
        <DialogHeader className="border-b border-[#e8e8ec] px-6 py-5 text-left">
          <DialogTitle className="sales-ops-num text-[19px]">Área</DialogTitle>
          <DialogDescription>Unidade de negócio usada em produtos e vendas.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4 px-6 py-5" onSubmit={submit}>
          <Field label="Nome" required>
            <Input
              className="bg-[#fafafb]"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </Field>
          <FieldBlock label="Status">
            <Combobox
              aria-label="Status da área"
              className={formSelectClass}
              onChange={(value) => setStatus(value as 'active' | 'archived')}
              options={[
                { value: 'active', label: 'Ativa' },
                { value: 'archived', label: 'Arquivada' },
              ]}
              searchPlaceholder="Buscar status..."
              value={status}
            />
          </FieldBlock>
          <div className="flex justify-end gap-3 border-t border-[#e8e8ec] pt-4">
            <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
            <PrimaryButton disabled={saving || !name.trim()} type="submit">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </PrimaryButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FuncaoDialog(props: {
  modal: Extract<ModalState, { kind: 'funcao' }> | null;
  onClose: () => void;
  onSave: (payload: SaveFuncaoPayload) => void;
  saving: boolean;
}) {
  if (!props.modal) return null;
  return (
    <FuncaoDialogBody
      key={props.modal.funcao?.id ?? 'new-funcao'}
      modal={props.modal}
      onClose={props.onClose}
      onSave={props.onSave}
      saving={props.saving}
    />
  );
}

function FuncaoDialogBody({
  modal,
  onClose,
  onSave,
  saving,
}: {
  modal: Extract<ModalState, { kind: 'funcao' }>;
  onClose: () => void;
  onSave: (payload: SaveFuncaoPayload) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(modal.funcao?.name ?? '');
  const [status, setStatus] = useState<'active' | 'archived'>(modal.funcao?.status ?? 'active');
  /**
   * Defence in depth. `FuncoesView` never wires `onEdit` for a predefined função, so
   * this branch is unreachable in normal use; it exists so a future mis-wire cannot
   * produce the rename or archive the API answers `409 funcao_is_system` to.
   */
  const isSystem = modal.funcao?.isSystem === true;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (isSystem || !name.trim()) return;
    onSave({ id: modal.funcao?.id, name: name.trim(), status });
  }

  return (
    <Dialog onOpenChange={(open) => (!open ? onClose() : undefined)} open>
      <DialogContent className="max-w-[520px] rounded-[20px] border-none bg-white p-0">
        <DialogHeader className="border-b border-[#e8e8ec] px-6 py-5 text-left">
          <DialogTitle className="sales-ops-num text-[19px]">Função</DialogTitle>
          <DialogDescription>
            Função atribuível a uma pessoa e usada nos custos de uma proposta.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4 px-6 py-5" onSubmit={submit}>
          <Field label="Nome" required>
            <Input
              className="bg-[#fafafb]"
              disabled={isSystem}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </Field>
          <FieldBlock label="Status">
            <Combobox
              aria-label="Status da função"
              className={formSelectClass}
              disabled={isSystem}
              onChange={(value) => setStatus(value as 'active' | 'archived')}
              options={[
                { value: 'active', label: 'Ativa' },
                { value: 'archived', label: 'Arquivada' },
              ]}
              searchPlaceholder="Buscar status..."
              value={status}
            />
          </FieldBlock>
          {isSystem ? (
            <p className="text-[12.5px] text-[#8b8b92]">
              Função predefinida do app: o nome e o status não podem ser alterados.
            </p>
          ) : null}
          <div className="flex justify-end gap-3 border-t border-[#e8e8ec] pt-4">
            <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
            <PrimaryButton disabled={saving || isSystem || !name.trim()} type="submit">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </PrimaryButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PersonDialog(props: {
  funcoes: SalesOpsFuncao[];
  modal: Extract<ModalState, { kind: 'person' }> | null;
  onClose: () => void;
  onCreateFuncao?: (name: string) => Promise<SalesOpsFuncao | null>;
  onSave: (payload: SavePersonPayload) => void;
  saving: boolean;
}) {
  if (!props.modal) return null;
  return (
    <PersonDialogBody
      funcoes={props.funcoes}
      key={props.modal.person?.id ?? 'new-person'}
      modal={props.modal}
      onClose={props.onClose}
      onCreateFuncao={props.onCreateFuncao}
      onSave={props.onSave}
      saving={props.saving}
    />
  );
}

function PersonDialogBody({
  funcoes,
  modal,
  onClose,
  onCreateFuncao,
  onSave,
  saving,
}: {
  funcoes: SalesOpsFuncao[];
  modal: Extract<ModalState, { kind: 'person' }>;
  onClose: () => void;
  onCreateFuncao?: (name: string) => Promise<SalesOpsFuncao | null>;
  onSave: (payload: SavePersonPayload) => void;
  saving: boolean;
}) {
  const [displayName, setDisplayName] = useState(modal.person?.displayName ?? '');
  const [contactEmail, setContactEmail] = useState(modal.person?.contactEmail ?? '');
  const [status, setStatus] = useState<'active' | 'inactive'>(modal.person?.status ?? 'active');
  const [assignedIds, setAssignedIds] = useState<string[]>(
    () => modal.person?.funcoes.map((funcao) => funcao.id) ?? [],
  );
  const [pendingFuncaoId, setPendingFuncaoId] = useState('');
  /**
   * Funções created from the picker's own create row. The `funcoes` prop only
   * refreshes once the invalidated bootstrap refetch lands, so without this the row
   * the operator just created would have no name to render for a beat.
   */
  const [createdFuncoes, setCreatedFuncoes] = useState<SalesOpsFuncao[]>([]);
  const activeModal = modal;

  /**
   * Resolved against the org catalogue, the funções just created here and the
   * pessoa's own entries, so an archived função she already carries keeps its row
   * (and stays removable) even though it is gone from the picker below. Same
   * handling as `selectableAreas` in ProductDialogBody.
   */
  const assignedFuncoes = assignedIds.flatMap<SalesOpsPersonFuncao>((id) => {
    const known =
      funcoes.find((funcao) => funcao.id === id) ??
      createdFuncoes.find((funcao) => funcao.id === id) ??
      modal.person?.funcoes.find((funcao) => funcao.id === id);
    return known ? [known] : [];
  });
  const selectableFuncoes: ComboboxOption[] = [...funcoes, ...createdFuncoes]
    .filter((funcao) => funcao.status === 'active' && !assignedIds.includes(funcao.id))
    .map((funcao) => ({ value: funcao.id, label: funcao.name }));

  function assignFuncao(id: string) {
    if (!id) return;
    setAssignedIds((current) => (current.includes(id) ? current : [...current, id]));
    setPendingFuncaoId('');
  }

  /**
   * The Combobox `onCreate` is `(query: string) => void`, so the async create is
   * wrapped rather than returned. A rejected create resolves to null and simply
   * leaves the assignment list unchanged, matching every other inline create in
   * this file: no dialog in this app surfaces API errors today.
   */
  async function handleCreateFuncao(query: string) {
    if (!onCreateFuncao) return;
    const created = await onCreateFuncao(query.trim());
    if (!created) return;
    setCreatedFuncoes((current) =>
      current.some((funcao) => funcao.id === created.id) ? current : [...current, created],
    );
    assignFuncao(created.id);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!displayName.trim() || assignedIds.length === 0) return;
    onSave({
      id: activeModal.person?.id,
      displayName: displayName.trim(),
      contactEmail: contactEmail.trim() || undefined,
      status,
      funcaoIds: assignedIds,
    });
  }

  return (
    <Dialog onOpenChange={(open) => (!open ? onClose() : undefined)} open>
      <DialogContent className="max-w-[520px] rounded-[20px] border-none bg-white p-0">
        <DialogHeader className="border-b border-[#e8e8ec] px-6 py-5 text-left">
          <DialogTitle className="sales-ops-num text-[19px]">Pessoa</DialogTitle>
          <DialogDescription>
            Cadastro único de pessoas: atribua as funções que ela exerce.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4 px-6 py-5" onSubmit={submit}>
          <Field label="Nome" required>
            <Input
              className="bg-[#fafafb]"
              onChange={(event) => setDisplayName(event.target.value)}
              value={displayName}
            />
          </Field>
          <Field label="E-mail">
            <Input
              className="bg-[#fafafb]"
              onChange={(event) => setContactEmail(event.target.value)}
              type="email"
              value={contactEmail}
            />
          </Field>
          <FieldBlock label="Status">
            <Combobox
              aria-label="Status da pessoa"
              className={formSelectClass}
              onChange={(value) => setStatus(value as 'active' | 'inactive')}
              options={[
                { value: 'active', label: 'Ativo' },
                { value: 'inactive', label: 'Inativo' },
              ]}
              searchPlaceholder="Buscar status..."
              value={status}
            />
          </FieldBlock>
          <FieldBlock label="Funções" required>
            {assignedIds.length > 0 ? (
              <div className="flex flex-col gap-2">
                {assignedFuncoes.map((funcao) => (
                  <div
                    className="flex items-center gap-2 rounded-[10px] border border-[#dcdce2] bg-[#fafafb] px-3 py-2"
                    key={funcao.id}
                  >
                    <span className="flex-1 text-[13.5px] font-semibold text-[#201f24]">
                      {funcao.name}
                    </span>
                    {funcao.isSystem ? (
                      <Badge className={systemBadgeClass}>Predefinida</Badge>
                    ) : null}
                    <button
                      aria-label={`Remover função ${funcao.name}`}
                      className={iconButtonClass}
                      onClick={() =>
                        setAssignedIds((current) => current.filter((id) => id !== funcao.id))
                      }
                      title="Remover"
                      type="button"
                    >
                      <X className="h-[15px] w-[15px]" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-[#8b8b92]">Atribua ao menos uma função.</p>
            )}
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Combobox
                  aria-label="Função da pessoa"
                  className={formSelectClass}
                  entityGender="f"
                  entityLabel="função"
                  onChange={setPendingFuncaoId}
                  onCreate={onCreateFuncao ? (query) => void handleCreateFuncao(query) : undefined}
                  options={selectableFuncoes}
                  placeholder="Selecione uma função"
                  searchPlaceholder="Buscar função..."
                  value={pendingFuncaoId}
                />
              </div>
              <SecondaryButton onClick={() => assignFuncao(pendingFuncaoId)}>
                Adicionar função
              </SecondaryButton>
            </div>
          </FieldBlock>
          <div className="flex justify-end gap-3 border-t border-[#e8e8ec] pt-4">
            <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
            <PrimaryButton
              disabled={saving || !displayName.trim() || assignedIds.length === 0}
              type="submit"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </PrimaryButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type SaleItemForm = {
  kind: 'product' | 'free';
  productId: string; // '' on free rows
  areaId: string; // '' on product rows (derived from the product); picked on free rows
  customLabel: string; // open-price custom label on product rows; the description on free rows
  quantity: string; // always '1' on free rows
  unitBrl: string;
  /**
   * UI only, never sent. `true` once the operator opened the optional description
   * on THIS row. It rides on the row rather than in an index-keyed set because rows
   * are deleted with `filter((_, i) => i !== index)`, so index-keyed state would
   * slide onto the wrong row after a delete.
   */
  descriptionOpen: boolean;
};

type InstallmentRowForm = { dueDate: string; amountBrl: string; method: PaymentMethod };

type ProfessionalForm = {
  personId: string;
  personName: string;
  /** `''` on a legacy row whose stored função is only a free-text snapshot. */
  funcaoId: string;
  /** The label the picker shows; a resolved função name, or the legacy snapshot. */
  funcaoName: string;
  /**
   * INPUT MODE only, never persisted: `sales_ops_sale_professionals.cost_brl` is a
   * single integer-cents column, so a `%` row resolves to cents before it reaches the
   * payload and an edited proposta always reopens in `fix`.
   */
  costUnit: ProfessionalCostUnit;
  /** Percent points as typed. Read only while `costUnit === 'pct'`. */
  costPct: string;
  /** Reais as typed. Read only while `costUnit === 'fix'`. */
  costBrl: string;
  /**
   * Set the moment the operator types in this row's `CUSTO ALOCADO`, and seeded
   * `true` for every prefilled row, because a persisted cost is by definition a
   * decision that was already saved. While it is false the cost re-derives from
   * the produto's default for the row's função; once true it is never recomputed.
   * A `%` row is costManual by construction, because choosing a percentage is
   * itself a decision.
   */
  costManual: boolean;
};

/**
 * The four step-3 numbers a produto supplies as a DEFAULT rather than a
 * constraint. Pinning is per field and never global, so hand-typing the seller
 * percentage must not freeze the finder percentage.
 */
type OverrideField =
  | 'sellerCommissionPct'
  | 'finderCommissionPct'
  | 'taxPct'
  | 'otherCostsBrl';

const OVERRIDE_FIELDS_NONE: Record<OverrideField, boolean> = {
  sellerCommissionPct: false,
  finderCommissionPct: false,
  taxPct: false,
  otherCostsBrl: false,
};

function commissionDefaultsSourceKey(
  product: SalesOpsProduct | undefined,
  hasFinder: boolean,
  settings: SalesOpsSettings | null,
) {
  return JSON.stringify([
    product?.id,
    product?.sellerCommissionType,
    product?.sellerCommissionValue,
    product?.sellerWithFinderCommissionType,
    product?.sellerWithFinderCommissionValue,
    product?.finderCommissionType,
    product?.finderCommissionValue,
    hasFinder,
    settings?.defaultSellerCommissionPct,
    settings?.defaultFinderCommissionPct,
  ]);
}

type WizardPrefill = {
  clientId: string;
  clientName: string;
  sellerPersonId: string;
  finderVisible: boolean;
  sellerIsFinder: boolean;
  finderPersonId: string;
  baseDate: string;
  notes: string;
  sellerCommissionPct: string;
  finderCommissionPct: string;
  taxPct: string;
  otherCostsBrl: string;
  items: SaleItemForm[];
  professionals: ProfessionalForm[];
  installmentRows: InstallmentRowForm[];
  /** The formula the stored rows were read back as, seeding the step-2 header. */
  planShape: PaymentPlanShape;
  /** True when no formula reproduces the stored rows, i.e. they were hand-tuned. */
  planDirty: boolean;
  recurringEnabled: boolean;
  recurringMonthlyBrl: string;
  /** `''` means prazo indeterminado; there is no separate boolean. */
  recurringCycles: string;
  recurringStartDate: string;
  recurringMethod: PaymentMethod;
};

/** Shared by `totalCents` and by the prefill, so the two can never disagree. */
function itemsTotalCents(items: SaleItemForm[]): number {
  return items.reduce(
    (sum, item) => sum + Math.max(1, Number(item.quantity) || 1) * parseCurrencyToCents(item.unitBrl),
    0,
  );
}

/**
 * The step-2 header controls as the operator typed them. The raw strings are the
 * state, so a half-typed `50.` survives; `wizardPlanShape` is the only place they
 * become numbers.
 */
type PlanShapeInputs = {
  entradaMode: PaymentPlanEntradaMode;
  entradaValueInput: string;
  restanteCountInput: string;
  anchorDate: string;
};

function wizardPlanShape(inputs: PlanShapeInputs): PaymentPlanShape {
  return {
    entradaMode: inputs.entradaMode,
    entradaValue:
      inputs.entradaMode === 'pct'
        ? Math.max(0, parseDecimal(inputs.entradaValueInput, 0))
        : inputs.entradaMode === 'fix'
          ? parseCurrencyToCents(inputs.entradaValueInput)
          : 0,
    restanteCount: Math.max(
      1,
      Math.min(
        maxRemainingInstallments(inputs.entradaMode),
        Math.floor(parseDecimal(inputs.restanteCountInput, 1)) || 1,
      ),
    ),
    anchorDate: inputs.anchorDate,
  };
}

/** The inverse of `wizardPlanShape`: seeds the header controls from a formula. */
function planShapeInputs(shape: PaymentPlanShape): PlanShapeInputs {
  return {
    entradaMode: shape.entradaMode,
    entradaValueInput:
      shape.entradaMode === 'pct'
        ? pctToInput(shape.entradaValue)
        : shape.entradaMode === 'fix'
          ? centsToInput(shape.entradaValue)
          : '0',
    restanteCountInput: String(shape.restanteCount),
    anchorDate: shape.anchorDate,
  };
}

/**
 * Identity of a generated plan: the total it was generated for plus the formula.
 * The regeneration guard fires whenever this changes, which is what makes the table
 * follow the header and the itens total without any explicit apply button.
 */
function planShapeKey(totalCents: number, shape: PaymentPlanShape): string {
  return JSON.stringify([totalCents, shape]);
}

function planShapeFromKey(key: string): PaymentPlanShape | null {
  try {
    const parsed: unknown = JSON.parse(key);
    if (!Array.isArray(parsed)) return null;
    const shape = parsed[1] as PaymentPlanShape | undefined;
    return shape && typeof shape.anchorDate === 'string' ? shape : null;
  } catch {
    return null;
  }
}

/**
 * Keyed on the product ID plus its stored template, never on a list position, so a
 * bootstrap refetch that reorders `products` cannot reseed a plan the operator is
 * editing.
 */
function planShapeSourceKey(product: SalesOpsProduct | undefined): string {
  return JSON.stringify([
    product?.id,
    product?.defaultEntradaMode,
    product?.defaultEntradaPct,
    product?.defaultEntradaBrl,
    product?.defaultRemainingInstallments,
  ]);
}

function deriveWizardPrefill(sale: SalesOpsSale, bootstrap: SalesOpsBootstrap): WizardPrefill {
  const receivables = bootstrap.receivables
    .filter((row) => row.saleId === sale.id && row.status !== 'void')
    .sort(
      (a, b) =>
        a.dueDate.slice(0, 10).localeCompare(b.dueDate.slice(0, 10)) ||
        (a.label ?? '').localeCompare(b.label ?? ''),
    );
  const recurringRows = receivables.filter((row) => (row.label ?? '').startsWith('M'));
  const installmentReceivables = receivables.filter((row) => !(row.label ?? '').startsWith('M'));
  const items: SaleItemForm[] = bootstrap.saleItems
    .filter((item) => item.saleId === sale.id)
    .map((item) => {
      if (!item.productId) {
        return {
          kind: 'free' as const,
          productId: '',
          areaId: item.areaId ?? '',
          customLabel: item.productNameSnapshot,
          quantity: '1',
          unitBrl: centsToInput(item.unitBrl),
          // Deliberately `false` even for a row that HAS a description: the
          // visibility predicate ORs on the text, so the edit path opens without
          // the flag and `deriveWizardPrefill` stays free of UI reasoning.
          descriptionOpen: false,
        };
      }
      const product = bootstrap.products.find((candidate) => candidate.id === item.productId);
      return {
        kind: 'product' as const,
        productId: item.productId,
        areaId: '',
        customLabel:
          product?.openPrice && item.productNameSnapshot !== product.name
            ? item.productNameSnapshot
            : '',
        quantity: String(item.quantity),
        unitBrl: centsToInput(item.unitBrl),
        descriptionOpen: false,
      };
    });
  const hasRecurring = sale.recurringBrl > 0;
  const bounded = hasRecurring && recurringRows.length > 0;
  const storedInstallments = installmentReceivables.map((row) => ({
    dueDate: row.dueDate.slice(0, 10),
    amountBrl: row.amountBrl,
    method: row.method,
  }));
  const inferred = inferPaymentPlanShape(
    itemsTotalCents(items),
    storedInstallments,
    sale.baseDate.slice(0, 10),
  );
  return {
    clientId: sale.clientId ?? '',
    clientName: sale.clientNameSnapshot,
    sellerPersonId: sale.sellerPersonId ?? '',
    finderVisible: Boolean(sale.finderPersonId || sale.finderNameSnapshot),
    sellerIsFinder: Boolean(sale.finderPersonId && sale.finderPersonId === sale.sellerPersonId),
    finderPersonId: sale.finderPersonId ?? '',
    baseDate: sale.baseDate.slice(0, 10),
    notes: sale.notes ?? '',
    sellerCommissionPct: pctToInput(sale.sellerCommissionPct),
    finderCommissionPct: pctToInput(sale.finderCommissionPct),
    taxPct: pctToInput(sale.taxPct),
    otherCostsBrl: centsToInput(sale.otherCostsBrl),
    items,
    professionals: bootstrap.saleProfessionals
      .filter((row) => row.saleId === sale.id)
      .map((row) => ({
        personId: row.personId ?? '',
        personName: row.personNameSnapshot,
        funcaoId: row.funcaoId ?? '',
        // A legacy row has no funcaoId and no snapshot column value worth trusting
        // over `role`, so the deprecated mirror is the fallback label.
        funcaoName: row.funcaoNameSnapshot || row.role,
        // A stored cost is cents, so it always reopens in `R$`: the unit is an input
        // mode and there is no column that could have remembered a percentage.
        costUnit: 'fix' as const,
        costPct: '0',
        costBrl: centsToInput(row.costBrl),
        // Unconditional: a persisted cost is a saved decision, so nothing on the
        // edit path may recompute it behind the operator.
        costManual: true,
      })),
    // Verbatim, so reopening and saving an untouched proposta round-trips the plan
    // byte for byte. The inference above only describes these rows, it never edits them.
    installmentRows: storedInstallments.map((row) => ({
      dueDate: row.dueDate,
      amountBrl: centsToInput(row.amountBrl),
      method: row.method,
    })),
    planShape: inferred.shape,
    planDirty: !inferred.matchesFormula,
    recurringEnabled: hasRecurring,
    recurringMonthlyBrl: centsToInput(sale.recurringBrl),
    recurringStartDate: bounded
      ? recurringRows[0]!.dueDate.slice(0, 10)
      : addMonthsToIsoDate(sale.baseDate.slice(0, 10), 1),
    /*
      A recurring sale with zero `M`-labelled receivables IS `cycles: null`, and blank
      is the only way step 2 expresses prazo indeterminado now that the checkbox is
      gone. `'12'` would silently invent a bounded plan the proposta does not have.
    */
    recurringCycles: bounded ? String(recurringRows.length) : '',
    recurringMethod: bounded ? recurringRows[0]!.method : 'pix',
  };
}

export function SaleWizardDialog(props: {
  open: boolean;
  bootstrap: SalesOpsBootstrap;
  editSale: SalesOpsSale | null;
  onClose: () => void;
  onCreateClient?: (name: string) => Promise<SalesOpsClient | null>;
  onCreateArea?: (name: string) => Promise<SalesOpsArea | null>;
  onCreateFuncao?: (name: string) => Promise<SalesOpsFuncao | null>;
  onCreateProduct?: (name: string) => void;
  onSave: (payload: CreateSalePayload) => void;
  saving: boolean;
}) {
  if (!props.open) return null;
  if (props.editSale && props.editSale.status !== 'draft' && props.editSale.status !== 'open') return null;
  return (
    <SaleWizardDialogBody
      // Wizard session identity only. Folding bootstrap rows into this key made any
      // snapshot refetch that changed the first cliente, the first produto or the
      // people count destroy in-progress typing. The body already unmounts when the
      // dialog closes, so re-opening still re-seeds the defaults from fresh data.
      key={props.editSale?.id ?? 'create'}
      bootstrap={props.bootstrap}
      editSale={props.editSale}
      onClose={props.onClose}
      onCreateArea={props.onCreateArea}
      onCreateClient={props.onCreateClient}
      onCreateFuncao={props.onCreateFuncao}
      onCreateProduct={props.onCreateProduct}
      onSave={props.onSave}
      saving={props.saving}
    />
  );
}

function SaleWizardDialogBody({
  bootstrap,
  editSale,
  onClose,
  onCreateClient,
  onCreateArea,
  onCreateFuncao,
  onCreateProduct,
  onSave,
  saving,
}: {
  bootstrap: SalesOpsBootstrap;
  editSale: SalesOpsSale | null;
  onClose: () => void;
  onCreateClient?: (name: string) => Promise<SalesOpsClient | null>;
  onCreateArea?: (name: string) => Promise<SalesOpsArea | null>;
  onCreateFuncao?: (name: string) => Promise<SalesOpsFuncao | null>;
  onCreateProduct?: (name: string) => void;
  onSave: (payload: CreateSalePayload) => void;
  saving: boolean;
}) {
  const settings = activeSettings(bootstrap.settings);
  const sellers = useMemo(
    () =>
      bootstrap.people.filter(
        (person) => hasFuncao(person, FUNCAO_SLUG_VENDEDOR) && person.status === 'active',
      ),
    [bootstrap.people],
  );
  const finders = useMemo(
    () =>
      bootstrap.people.filter(
        (person) => hasFuncao(person, FUNCAO_SLUG_FINDER) && person.status === 'active',
      ),
    [bootstrap.people],
  );
  /*
    Every ACTIVE pessoa, not only the ones `isCollaboratorPerson` recognises.
    Restricting allocation to collaborators hid a vendedor who also delivers,
    which is exactly the rigidity this batch removes, and slice 05 already reduced
    `isCollaborator` to a derived convenience flag. Inactive is still excluded: a
    new proposta should not suggest an inactive pessoa as a profissional.
  */
  const allocatablePeople = useMemo(
    () =>
      bootstrap.people
        .filter((person) => person.status === 'active')
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR')),
    [bootstrap.people],
  );
  /**
   * Funções created from a profissional row's own create row. `bootstrap` only
   * refreshes once the invalidated refetch lands, so without this the função the
   * operator just created would not be selectable for a beat. Same buffer idiom as
   * `createdAreas` below and as `createdFuncoes` in PersonDialogBody. It is declared
   * here rather than beside `createdAreas` because `allocatableFuncoes` reads it in a
   * dependency array, which a `const` further down would hit in its temporal dead zone.
   */
  const [createdFuncoes, setCreatedFuncoes] = useState<SalesOpsFuncao[]>([]);
  /**
   * System funções last, then alphabetical, matching the cadastro picker's order.
   * Merges in funções created from this wizard's own create row, deduped by id so
   * the refetch that eventually delivers them cannot double a row.
   *
   * The `isOptimisticId` filter is the local proof of the invariant in
   * `optimistic.ts`: a `funcaoId` chosen here lands in a request body, and a
   * placeholder id fails the Postgres uuid cast. `withoutOptimisticRows` already
   * strips one upstream, but `SaleWizardDialog` is exported and takes `bootstrap`
   * as a prop, so it must hold its own end of the contract.
   */
  const allocatableFuncoes = useMemo(() => {
    const merged = [
      ...bootstrap.funcoes,
      ...createdFuncoes.filter(
        (created) => !bootstrap.funcoes.some((funcao) => funcao.id === created.id),
      ),
    ];
    return merged
      .filter((funcao) => funcao.status === 'active' && !isOptimisticId(funcao.id))
      .sort(
        (a, b) => Number(a.isSystem) - Number(b.isSystem) || a.name.localeCompare(b.name, 'pt-BR'),
      );
  }, [bootstrap.funcoes, createdFuncoes]);
  const firstProduct = bootstrap.products[0];
  const firstClient = bootstrap.clients[0];
  const firstSeller = sellers[0];
  const prefill = editSale ? deriveWizardPrefill(editSale, bootstrap) : null;
  const prefilledPrimaryProduct = prefill
    ? bootstrap.products.find((product) => product.id === prefill.items[0]?.productId)
    : undefined;
  const prefilledHasFinder = Boolean(
    prefill ? prefill.finderVisible && (prefill.sellerIsFinder || prefill.finderPersonId) : false,
  );
  const initialCommissionDefaults = resolveSaleCommissionDefaults(
    firstProduct,
    false,
    bootstrap.settings,
  );
  const [clientId, setClientId] = useState(prefill?.clientId ?? firstClient?.id ?? '');
  const [clientName, setClientName] = useState(prefill?.clientName ?? firstClient?.name ?? '');
  const [sellerPersonId, setSellerPersonId] = useState(prefill?.sellerPersonId ?? firstSeller?.id ?? '');
  const [finderPersonId, setFinderPersonId] = useState(prefill?.finderPersonId ?? '');
  const [baseDate, setBaseDate] = useState(prefill?.baseDate ?? inputDateToday());
  const [notes, setNotes] = useState(prefill?.notes ?? '');
  const [taxPct, setTaxPct] = useState(prefill?.taxPct ?? String(settings.defaultTaxPct ?? 6));
  const [sellerCommissionPct, setSellerCommissionPct] = useState(
    prefill?.sellerCommissionPct ?? String(initialCommissionDefaults.sellerCommissionPct),
  );
  const [finderCommissionPct, setFinderCommissionPct] = useState(
    prefill?.finderCommissionPct ?? String(initialCommissionDefaults.finderCommissionPct),
  );
  const [commissionDefaultsSource, setCommissionDefaultsSource] = useState(() =>
    prefill
      ? commissionDefaultsSourceKey(prefilledPrimaryProduct, prefilledHasFinder, bootstrap.settings)
      : commissionDefaultsSourceKey(firstProduct, false, bootstrap.settings),
  );
  const [otherCostsBrl, setOtherCostsBrl] = useState(prefill?.otherCostsBrl ?? '0.00');
  /*
    Which of the four step-3 numbers the operator owns. On CREATE nothing is
    pinned, so every produto change re-proposes the cadastro default. On EDIT the
    registry is SEEDED by comparing each stored value against the default it would
    have inherited: a stored value that differs is a deliberate override and is
    pinned for the whole session, which is what makes a mid-edit produto change
    unable to clobber it. A stored value that equals the default is not pinned,
    which is also correct - it rejoins the re-apply path.
  */
  const [manualOverrides, setManualOverrides] = useState<Record<OverrideField, boolean>>(() => {
    if (!prefill) return OVERRIDE_FIELDS_NONE;
    const defaults = resolveSaleCommissionDefaults(
      prefilledPrimaryProduct,
      prefilledHasFinder,
      bootstrap.settings,
    );
    return {
      sellerCommissionPct: prefill.sellerCommissionPct !== String(defaults.sellerCommissionPct),
      finderCommissionPct: prefill.finderCommissionPct !== String(defaults.finderCommissionPct),
      taxPct: prefill.taxPct !== String(settings.defaultTaxPct ?? 6),
      otherCostsBrl: prefill.otherCostsBrl !== '0.00',
    };
  });
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [showItemErrors, setShowItemErrors] = useState(false);
  const [finderVisible, setFinderVisible] = useState(prefill?.finderVisible ?? false);
  const [sellerIsFinder, setSellerIsFinder] = useState(prefill?.sellerIsFinder ?? false);
  const [items, setItems] = useState<SaleItemForm[]>(() =>
    prefill?.items ??
    (firstProduct
      ? [
          {
            kind: 'product',
            productId: firstProduct.id,
            areaId: '',
            customLabel: '',
            quantity: '1',
            unitBrl: centsToInput(productBaseValueBrl(firstProduct)),
            descriptionOpen: false,
          },
        ]
      : []),
  );
  /**
   * Index whose description input should take focus on its next mount. A callback
   * ref rather than `autoFocus`, because `autoFocus` fires on every mount and would
   * steal focus when the wizard returns to step 1 or when the edit path mounts a
   * prefilled row.
   */
  const pendingDescriptionFocus = useRef<number | null>(null);
  const [professionals, setProfessionals] = useState<ProfessionalForm[]>(prefill?.professionals ?? []);
  /** Source key for the per-função cost re-prefill; see the sync block below. */
  const [funcaoCostKey, setFuncaoCostKey] = useState('');
  /**
   * Áreas created from an item row's own create row, kept locally so the new área is
   * selectable and visible on the trigger before the bootstrap refetch lands.
   */
  const [createdAreas, setCreatedAreas] = useState<SalesOpsArea[]>([]);
  const [installmentRows, setInstallmentRows] = useState<InstallmentRowForm[]>(() =>
    prefill && prefill.installmentRows.length > 0
      ? prefill.installmentRows
      : [{ dueDate: inputDateToday(), amountBrl: '0', method: 'pix' }],
  );
  const initialPlanInputs = planShapeInputs(
    prefill?.planShape ??
      defaultPlanShapeForProduct(firstProduct, prefill?.baseDate ?? inputDateToday()),
  );
  const [entradaMode, setEntradaMode] = useState(initialPlanInputs.entradaMode);
  const [entradaValueInput, setEntradaValueInput] = useState(initialPlanInputs.entradaValueInput);
  const [restanteCountInput, setRestanteCountInput] = useState(
    initialPlanInputs.restanteCountInput,
  );
  const [planAnchorDate, setPlanAnchorDate] = useState(initialPlanInputs.anchorDate);
  /**
   * A whole-plan flag rather than per-row pinning. Recomputing an entrada or a
   * restante redistributes value across EVERY row to hold `Soma === total`, so
   * honouring a pinned row 3 while regenerating rows 1-2 would either break that
   * invariant or produce amounts following no stateable rule.
   */
  const [planDirty, setPlanDirty] = useState(prefill?.planDirty ?? false);
  /**
   * The key the current `installmentRows` were generated from. Seeded on the edit path
   * so opening a proposta neither regenerates a clean plan nor raises the confirm bar
   * over a hand-edited one; `''` on create, which is what makes the first render
   * generate the opening single parcela.
   */
  const [appliedPlanKey, setAppliedPlanKey] = useState(() =>
    prefill ? planShapeKey(itemsTotalCents(prefill.items), wizardPlanShape(initialPlanInputs)) : '',
  );
  const [planAnchorSourceBaseDate, setPlanAnchorSourceBaseDate] = useState(
    prefill?.baseDate ?? inputDateToday(),
  );
  const [planShapeSource, setPlanShapeSource] = useState(() =>
    planShapeSourceKey(prefill ? prefilledPrimaryProduct : firstProduct),
  );
  const [showPlanErrors, setShowPlanErrors] = useState(false);
  const [showCostErrors, setShowCostErrors] = useState(false);
  const [recurringMode, setRecurringMode] = useState<'none' | 'monthly'>(
    prefill?.recurringEnabled ? 'monthly' : 'none',
  );
  const [recurringMonthlyBrl, setRecurringMonthlyBrl] = useState(prefill?.recurringMonthlyBrl ?? '0');
  const [recurringStartDate, setRecurringStartDate] = useState(
    prefill?.recurringStartDate ?? addMonthsToIsoDate(inputDateToday(), 1),
  );
  const [recurringCycles, setRecurringCycles] = useState(prefill?.recurringCycles ?? '12');
  const [recurringSource, setRecurringSource] = useState(() =>
    prefill
      ? JSON.stringify([
          prefilledPrimaryProduct?.id,
          prefilledPrimaryProduct?.hasMonthly,
          prefilledPrimaryProduct?.monthlyBrl,
        ])
      : '',
  );
  const [recurringMethod] = useState<PaymentMethod>(prefill?.recurringMethod ?? 'pix');
  const primaryItemProduct = bootstrap.products.find(
    (product) => product.id === items[0]?.productId,
  );
  const hasFinderForSale = finderVisible && (sellerIsFinder || Boolean(finderPersonId));
  const currentCommissionDefaultsSource = commissionDefaultsSourceKey(
    primaryItemProduct,
    hasFinderForSale,
    bootstrap.settings,
  );

  /**
   * The defaults the CURRENT produto and finder participation would propose. Both
   * the re-apply below and the `Alterado manualmente` marker read this one memo,
   * so the marker can never disagree with what `Restaurar padrão` would write.
   */
  const resolvedDefaults = useMemo<Record<OverrideField, string>>(() => {
    const commission = resolveSaleCommissionDefaults(
      primaryItemProduct,
      hasFinderForSale,
      bootstrap.settings,
    );
    return {
      sellerCommissionPct: String(commission.sellerCommissionPct),
      finderCommissionPct: String(commission.finderCommissionPct),
      taxPct: String(settings.defaultTaxPct ?? 6),
      otherCostsBrl: '0.00',
    };
  }, [primaryItemProduct, hasFinderForSale, bootstrap.settings, settings.defaultTaxPct]);

  /*
    The source key advances UNCONDITIONALLY, so this render-phase guard still
    terminates on the next render; only the two setters are skipped for a pinned
    field. `taxPct` and `otherCostsBrl` have no re-apply path at all and keep
    their single initialisation; they join the registry only so the marker and
    `Restaurar padrão` work uniformly across all four inputs.
  */
  if (commissionDefaultsSource !== currentCommissionDefaultsSource) {
    const defaults = resolveSaleCommissionDefaults(
      primaryItemProduct,
      hasFinderForSale,
      bootstrap.settings,
    );
    setCommissionDefaultsSource(currentCommissionDefaultsSource);
    if (!manualOverrides.sellerCommissionPct) {
      setSellerCommissionPct(String(defaults.sellerCommissionPct));
    }
    if (!manualOverrides.finderCommissionPct) {
      setFinderCommissionPct(String(defaults.finderCommissionPct));
    }
  }

  function markManual(field: OverrideField) {
    setManualOverrides((current) => (current[field] ? current : { ...current, [field]: true }));
  }

  /** True only when the field is pinned AND actually diverges from the default. */
  function isOverridden(field: OverrideField, value: string): boolean {
    return manualOverrides[field] && value !== resolvedDefaults[field];
  }

  /**
   * The chip plus `Restaurar padrão` under an overridden step-3 input.
   *
   * Requiring BOTH the pin and a real divergence keeps the marker honest:
   * retyping the default value by hand is not a divergence and is not flagged.
   * Restoring clears the flag AND writes the default back in the same handler, so
   * the field rejoins the produto re-apply path immediately.
   */
  function overrideMarker(
    field: OverrideField,
    value: string,
    setValue: (next: string) => void,
  ): ReactNode {
    if (!isOverridden(field, value)) return null;
    return (
      <span className="mt-1 flex items-center gap-2">
        <span className="rounded-full bg-[#fdf0cf] px-[7px] py-[2px] text-[11px] font-semibold text-[#9c7210]">
          Alterado manualmente
        </span>
        <button
          className="text-[11px] font-semibold text-[#9c7210] underline"
          onClick={() => {
            setManualOverrides((current) => ({ ...current, [field]: false }));
            setValue(resolvedDefaults[field]);
          }}
          type="button"
        >
          Restaurar padrão
        </button>
      </span>
    );
  }

  const canSave = Boolean(clientName.trim() && sellerPersonId && items.length > 0);
  const totalCents = itemsTotalCents(items);

  /*
    Three render-phase guards, each writing its own source key first, exactly like the
    commission-defaults guard above and the recurrence guard below. Every key is a
    JSON.stringify of primitives and the generator is deterministic, so the next render
    always finds the keys equal and the sequence terminates.
  */
  if (baseDate !== planAnchorSourceBaseDate) {
    setPlanAnchorSourceBaseDate(baseDate);
    setPlanAnchorDate(baseDate);
  }

  const planShapeSourceNow = planShapeSourceKey(primaryItemProduct);
  if (planShapeSource !== planShapeSourceNow) {
    setPlanShapeSource(planShapeSourceNow);
    // A hand-edited plan is never reseeded from a cadastro default behind the
    // operator's back; switching the produto only re-proposes the formula.
    if (!planDirty) {
      const seeded = planShapeInputs(defaultPlanShapeForProduct(primaryItemProduct, baseDate));
      setEntradaMode(seeded.entradaMode);
      setEntradaValueInput(seeded.entradaValueInput);
      setRestanteCountInput(seeded.restanteCountInput);
      setPlanAnchorDate(seeded.anchorDate);
    }
  }

  const planShape = wizardPlanShape({
    entradaMode,
    entradaValueInput,
    restanteCountInput,
    anchorDate: planAnchorDate,
  });
  const currentPlanKey = planShapeKey(totalCents, planShape);
  if (!planDirty && currentPlanKey !== appliedPlanKey) {
    setAppliedPlanKey(currentPlanKey);
    setInstallmentRows(
      generateInstallmentPlan(
        totalCents,
        planShape,
        installmentRows.map((row) => row.method),
      ).map((row) => ({
        dueDate: row.dueDate,
        amountBrl: centsToInput(row.amountBrl),
        method: row.method,
      })),
    );
  }
  /**
   * The operator hand-edited the rows AND then moved a header control, so the header
   * no longer describes the table. Nothing is regenerated until they say which one
   * they meant.
   */
  const planPendingRegeneration = planDirty && currentPlanKey !== appliedPlanKey;

  const recurringSourceNow = JSON.stringify([
    primaryItemProduct?.id,
    primaryItemProduct?.hasMonthly,
    primaryItemProduct?.monthlyBrl,
  ]);
  if (recurringSource !== recurringSourceNow) {
    const suggested = Boolean(primaryItemProduct?.hasMonthly && primaryItemProduct.monthlyBrl > 0);
    setRecurringSource(recurringSourceNow);
    setRecurringMode(suggested ? 'monthly' : 'none');
    setRecurringMonthlyBrl(centsToInput(primaryItemProduct?.monthlyBrl));
    setRecurringStartDate(addMonthsToIsoDate(baseDate, 1));
    setRecurringCycles('12');
  }

  /*
    The fourth render-phase source-key sync, deliberately shaped exactly like
    `planAutoKey` and `recurringSource` above: advance the key first, then apply at
    most one setState. The key is derived from the computed basis, which is a pure
    function of the items and the cadastro cost rows, so the next render always
    finds the keys equal and the sequence terminates.

    Only rows the operator never typed into are re-derived, and only when the row
    carries a funcaoId. Changing a row's PESSOA never moves its cost: a pessoa is
    not a cost driver, the função is.
  */
  const funcaoCostBasis = buildFuncaoCostBasis(
    items.map((item) => ({
      productId: item.kind === 'product' ? item.productId || undefined : undefined,
      productName: saleItemDisplayName(item),
      subtotalBrl: Math.max(1, Number(item.quantity) || 1) * parseCurrencyToCents(item.unitBrl),
    })),
    bootstrap.productFuncaoCosts,
  );
  /*
    The fallback base for a wizard `%` whose função no produto declares. PRODUCT items
    only and item subtotals only, so the recorrência exclusion that governs
    `buildFuncaoCostBasis` governs this too.
  */
  const productItemsSubtotalCents = items
    .filter((item) => item.kind === 'product' && item.productId)
    .reduce(
      (sum, item) =>
        sum + Math.max(1, Number(item.quantity) || 1) * parseCurrencyToCents(item.unitBrl),
      0,
    );
  const funcaoCostKeyNow = JSON.stringify(
    [...funcaoCostBasis.entries()].map(([funcaoId, entry]) => [funcaoId, entry.cents]),
  );
  if (funcaoCostKey !== funcaoCostKeyNow) {
    setFuncaoCostKey(funcaoCostKeyNow);
    setProfessionals((current) =>
      current.map((row) =>
        /*
          The `costUnit === 'pct'` clause is redundant by the invariant that a `%` row
          is always `costManual`; it is written out so the invariant is visible at the
          guard that depends on it. The body writes only `costBrl`, the `fix` field.
        */
        row.costManual || row.costUnit === 'pct' || !row.funcaoId
          ? row
          : { ...row, costBrl: centsToInput(funcaoCostBasis.get(row.funcaoId)?.cents ?? 0) },
      ),
    );
  }

  const activeAreas = bootstrap.areas.filter((area) => area.status === 'active');
  const selectableAreas = [
    ...activeAreas,
    ...createdAreas.filter((created) => !activeAreas.some((area) => area.id === created.id)),
  ];
  const areaNameById = new Map(
    [...bootstrap.areas, ...createdAreas].map((area) => [area.id, area.name]),
  );
  const planSumCents = installmentSumCents(installmentRows);
  const planDeltaCents = planSumCents - totalCents;
  const planRowsValid =
    installmentRows.length >= 1 &&
    installmentRows.every(
      (row) => /^\d{4}-\d{2}-\d{2}$/.test(row.dueDate) && parseCurrencyToCents(row.amountBrl) > 0,
    );
  const planValid = planRowsValid && planDeltaCents === 0;
  const entradaCents = entradaCentsFor(totalCents, planShape);
  const restanteCents = Math.max(0, totalCents - entradaCents);
  const restanteCount = restanteCountFor(planShape);
  /*
    The hint values are the SAME arithmetic the table rows come from - floor base,
    whole remainder on the last row - so the header can never advertise an amount the
    table does not contain. The mock's `3 x R$ 12.166,67` was one cent above the real
    total and is deliberately not reproduced.
  */
  const restanteBaseCents = Math.floor(restanteCents / restanteCount);
  const restanteLastCents = restanteCents - restanteBaseCents * (restanteCount - 1);
  const recurringMonthlyCents = parseCurrencyToCents(recurringMonthlyBrl);
  /** Blank ciclos is the ONLY expression of prazo indeterminado; there is no checkbox. */
  const recurringIndefinite = recurringCycles.trim() === '';
  const recurringCyclesCount = Math.max(1, Math.min(120, Math.floor(Number(recurringCycles) || 0)));
  const recurringCyclesValid = recurringIndefinite || Math.floor(Number(recurringCycles)) >= 1;
  const recurringValid =
    recurringMode === 'none' ||
    (recurringMonthlyCents > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(recurringStartDate) &&
      recurringCyclesValid);
  const canAdvanceStepTwo = planValid && recurringValid;
  /*
    New rather than an extension: step 3 had no advance guard at all, because until
    now `FUNÇÃO NO PROJETO` was free text seeded with the literal 'Operacional' and
    could not be empty. A row is valid with a funcaoId, or with a legacy free-text
    snapshot it inherited from a stored proposta; a row with neither would reach
    the API as a `funcao_or_role_required` 400.
  */
  const professionalsValid = professionals.every(
    (professional) => Boolean(professional.funcaoId) || Boolean(professional.funcaoName.trim()),
  );
  const canAdvanceStepThree = professionalsValid;

  const itemsValid = items.every((item) => {
    if (item.kind === 'free') {
      return Boolean(item.areaId) && Boolean(item.customLabel.trim()) && parseCurrencyToCents(item.unitBrl) > 0;
    }
    const product = selectedProduct(item);
    // Two independent rules, deliberately not fused into one boolean. A serviço
    // has a catalog name to fall back on, so its description is optional - but it
    // still has no catalog price, so the negotiated value stays required.
    const { needsDescription, needsNegotiatedValue } = productRowRequirements(product);
    const valueOk = !needsNegotiatedValue || parseCurrencyToCents(item.unitBrl) > 0;
    const descriptionOk = !needsDescription || Boolean(item.customLabel.trim());
    return valueOk && descriptionOk && Boolean(product?.areaId);
  });
  const canSaveBasics = canSave && totalCents > 0;
  const canAdvanceStepOne = canSaveBasics && itemsValid;
  const draftValid =
    canSaveBasics &&
    planValid &&
    recurringValid &&
    items.every((item) =>
      item.kind === 'free'
        ? Boolean(item.areaId) && Boolean(item.customLabel.trim()) && parseCurrencyToCents(item.unitBrl) > 0
        : Boolean(selectedProduct(item)?.areaId),
    );

  const professionalCents = professionals.reduce(
    (sum, professional) => sum + professionalRowCents(professional),
    0,
  );
  const otherCents = parseCurrencyToCents(otherCostsBrl);

  const selectedSeller = sellers.find((person) => person.id === sellerPersonId);
  const selectedFinder = sellerIsFinder
    ? selectedSeller
    : finders.find((person) => person.id === finderPersonId);

  const previewReceivables = [
    ...installmentRows.map((row) => ({
      dueDate: row.dueDate,
      amountCents: parseCurrencyToCents(row.amountBrl),
    })),
    /*
      `cycles: null` generates no bounded rows anywhere, so an indefinite
      mensalidade contributes nothing to this preview either.

      This list used to be gated on `settings.commissionOnRecurring`, which made
      the preview LIE whenever the toggle was off: `buildSaleLedger` and
      `materializeWonPayables` ignore that setting entirely and generate a
      commission for every non-void receivable. Making the server honour it would
      change payables materialization, which is out of scope, so the preview is
      aligned to the server instead. `commissionOnRecurring` is a dead setting.
    */
    ...(recurringMode === 'monthly' && !recurringIndefinite
      ? Array.from({ length: recurringCyclesCount }, (_, index) => ({
          dueDate: addMonthsToIsoDate(recurringStartDate, index),
          amountCents: recurringMonthlyCents,
        }))
      : []),
  ];

  /*
    The SAME `computeSaleFinancials` the API's `buildSaleLedger` calls, fed the
    same inputs, so the Margem líquida shown in Custos e margem and Revisão is
    byte for byte the `net_margin_brl` a save persists. Before this the wizard
    rounded each percentage once over the item total and left a bounded
    recorrência out of the base entirely, so any proposta with a recorrência or
    with uneven parcelas displayed one number and saved another.
  */
  const financials = computeSaleFinancials({
    itemsTotalBrl: totalCents,
    boundedRecurringBrl:
      recurringMode === 'monthly' && !recurringIndefinite
        ? recurringMonthlyCents * recurringCyclesCount
        : 0,
    receivableAmountsBrl: previewReceivables.map((row) => row.amountCents),
    sellerCommissionPct: parseDecimal(sellerCommissionPct, 0),
    finderCommissionPct: parseDecimal(finderCommissionPct, 0),
    hasFinder: hasFinderForSale,
    taxPct: parseDecimal(taxPct, 0),
    otherCostsBrl: otherCents,
    professionalCostsBrl: professionalCents,
  });
  const sellerCommissionCents = financials.sellerCommissionBrl;
  const finderCommissionCents = financials.finderCommissionBrl;
  const taxCents = financials.taxBrl;
  const marginCents = financials.netMarginBrl;
  /** Two decimals, so the bar width and the persisted percentage agree exactly. */
  const marginPct = Number(financials.netMarginPct);

  const payablesPreview = [
    ...previewReceivables.flatMap((receivable, index) => {
      const rows: Array<{ label: string; type: string; date: string; value: number; className: string }> = [];
      rows.push({
        label: `Comissão - ${selectedSeller?.displayName ?? 'vendedor'} (parcela ${index + 1})`,
        type: 'Comissão vendedor',
        date: displayDate(receivable.dueDate),
        value: Math.floor((receivable.amountCents * parseDecimal(sellerCommissionPct, 0)) / 100),
        className: 'bg-[#fdf0cf] text-[#9c7210]',
      });
      if (hasFinderForSale) {
        rows.push({
          label: `Comissão - ${selectedFinder?.displayName ?? 'finder'} (finder, parcela ${index + 1})`,
          type: 'Comissão finder',
          date: displayDate(receivable.dueDate),
          value: Math.floor((receivable.amountCents * parseDecimal(finderCommissionPct, 0)) / 100),
          className: 'bg-[#fdf0cf] text-[#9c7210]',
        });
      }
      if (parseDecimal(taxPct, 0) > 0) {
        rows.push({
          label: `Imposto sobre a parcela ${index + 1} (${taxPct}%)`,
          type: 'Imposto',
          date: displayDate(receivable.dueDate),
          value: Math.floor((receivable.amountCents * parseDecimal(taxPct, 0)) / 100),
          className: 'bg-[#f6e3dd] text-[#b23a22]',
        });
      }
      return rows;
    }),
    ...professionals.map((professional) => ({
      // Preview text only. The persisted `beneficiaryName` deliberately stays the
      // pessoa alone, so this does not rewrite payables that already exist.
      label: professional.funcaoName
        ? `Alocação - ${professional.personName || 'prestador'} · ${professional.funcaoName}`
        : `Alocação - ${professional.personName || 'prestador'}`,
      type: 'Custo profissional',
      date: displayDate(baseDate),
      value: professionalRowCents(professional),
      className: 'bg-[#e6edf4] text-[#3f6ea3]',
    })),
    ...(otherCents > 0
      ? [
          {
            label: 'Outros custos do projeto',
            type: 'Outro',
            date: displayDate(baseDate),
            value: otherCents,
            className: 'bg-[#ececf1] text-[#84848c]',
          },
        ]
      : []),
  ].filter((row) => row.value > 0);

  function selectedProduct(item: SaleItemForm) {
    if (item.kind === 'free') return undefined;
    return bootstrap.products.find((product) => product.id === item.productId) ?? firstProduct;
  }

  function professionalRowBaseCents(row: ProfessionalForm): number {
    return professionalCostBaseCents(
      row.funcaoId ? funcaoCostBasis.get(row.funcaoId) : undefined,
      productItemsSubtotalCents,
    );
  }

  /*
    The single seam every consumer of a professional cost goes through. A `%` row is
    DERIVED on every render rather than mirrored into `costBrl`, which is what keeps the
    number and the derivation line under it from ever disagreeing, and what avoids a
    second render-phase setState loop next to the four that already exist.
  */
  function professionalRowCents(row: ProfessionalForm): number {
    return resolveProfessionalCostCents(row, professionalRowBaseCents(row));
  }

  /*
    Toggling the unit is an explicit decision about this row's number, so it PINS the row
    in both directions and never un-pins it. That is what stops the render-phase
    produto-default guard from resurrecting a stale default over a number the operator
    just derived: a row that has been toggled even once can no longer be re-derived from
    the cadastro.
  */
  function setProfessionalCostUnit(index: number, unit: ProfessionalCostUnit) {
    setProfessionals((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index || item.costUnit === unit) return item;
        if (unit === 'pct') {
          /*
            Seed the percentage that reproduces the cents currently on the row, to two
            decimals, so the toggle does not blank a number the operator can see. The
            rounding can move the resolved cents by up to half a basis point of the base;
            the derivation line states the percentage and the base, so what is on screen
            is always what is computed.
          */
          const base = professionalRowBaseCents(item);
          const cents = parseCurrencyToCents(item.costBrl);
          const seeded = base > 0 ? String(Math.round((cents / base) * 10000) / 100) : '0';
          return { ...item, costUnit: 'pct', costPct: seeded, costManual: true };
        }
        // Back to R$: freeze the exact cents the percentage resolved to, losslessly.
        return {
          ...item,
          costUnit: 'fix',
          costBrl: centsToInput(professionalRowCents(item)),
          costManual: true,
        };
      }),
    );
  }

  /*
    The ONE `Restaurar padrão` handler, shared by the `%` footer and the `fix` chip.
    Restoring the produto default means restoring its CENTS, so the row must land back
    in `R$`; leaving it in `%` would keep showing a percentage the cadastro never stated.
  */
  function restoreProfessionalDefault(index: number, defaultCents: number) {
    setProfessionals((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              costManual: false,
              costUnit: 'fix' as const,
              costPct: '0',
              costBrl: centsToInput(defaultCents),
            }
          : item,
      ),
    );
  }

  /**
   * What a catalog-product row must carry before step 1 accepts it. Shared by the
   * `itemsValid` gate and the row's error rendering so the two cannot drift: if
   * they disagree, the wizard either blocks with no visible reason or shows an
   * error it does not enforce.
   *
   * A Serviço always needs a negotiated value, base value or not: the base value
   * merely PREFILLS the field (see `productBaseValueBrl`), so a serviço that has
   * one satisfies the gate without a keystroke while one that does not still
   * blocks - and blanking the field blocks either way. A Serviço needs no
   * description, because `saleItemDisplayName` falls back to the catalog name. An
   * open-price row that is not a Serviço needs both. A fixed-price Produto needs
   * neither - it has a catalog price and a catalog name, and the description field
   * is not even rendered.
   *
   * `openPrice` is kept here purely as a CLASSIFICATION fallback for a row whose
   * `kind` never arrived, and is deliberately not folded into `isService` even
   * though the DB CHECK pins the two equal. It is the conservative direction: an
   * unclassifiable row keeps its negotiated-value gate instead of silently passing
   * as a fixed-price Produto and letting an item through at R$ 0. The MONEY question
   * is a different one and goes through `productBaseValueBrl`, which is kind-blind.
   */
  function productRowRequirements(product: SalesOpsProduct | undefined) {
    const isService = isServiceProduct(product);
    const hasVariableValue = Boolean(product?.openPrice) || isService;
    return {
      isService,
      hasVariableValue,
      needsNegotiatedValue: hasVariableValue,
      needsDescription: hasVariableValue && !isService,
    };
  }

  function saleItemDisplayName(item: SaleItemForm): string {
    if (item.kind === 'free') return item.customLabel.trim() || 'Item avulso';
    const product = selectedProduct(item);
    if (!product) return 'Produto';
    // `.trim() || 'Produto'` closes the one path from a blank description to an
    // API 400: ProductSchema.name is `.min(1)` without `.trim()`, so a
    // whitespace-only catalog name would otherwise reach the wire as ''.
    if (!productRowRequirements(product).hasVariableValue) return product.name.trim() || 'Produto';
    return item.customLabel.trim() || product.name.trim() || 'Produto';
  }

  function setItem(index: number, patch: Partial<SaleItemForm>) {
    setItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const next = { ...item, ...patch };
        if (patch.productId && patch.productId !== item.productId) {
          next.customLabel = '';
          // Swapping the produto is a fresh row, so a stale reveal must not survive it.
          next.descriptionOpen = false;
          const product = bootstrap.products.find((candidate) => candidate.id === patch.productId);
          if (product) {
            next.unitBrl = centsToInput(productBaseValueBrl(product));
          }
        }
        return next;
      }),
    );
  }

  function addItem() {
    const product = bootstrap.products[0];
    if (!product) return;
    setItems((current) => [
      ...current,
      {
        kind: 'product',
        productId: product.id,
        areaId: '',
        customLabel: '',
        quantity: '1',
        unitBrl: centsToInput(productBaseValueBrl(product)),
        descriptionOpen: false,
      },
    ]);
  }

  function addFreeItem() {
    if (activeAreas.length === 0) return;
    setItems((current) => [
      ...current,
      {
        kind: 'free',
        productId: '',
        areaId: activeAreas[0]!.id,
        customLabel: '',
        quantity: '1',
        unitBrl: '0',
        descriptionOpen: false,
      },
    ]);
  }

  function revealDescription(index: number) {
    pendingDescriptionFocus.current = index;
    setItem(index, { descriptionOpen: true });
  }

  function setInstallmentRow(index: number, patch: Partial<InstallmentRowForm>) {
    setInstallmentRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
  }

  /**
   * A date or amount edit freezes the plan: the typed value is kept and no
   * regeneration happens until the operator asks for one. A `Forma` edit deliberately
   * does NOT come through here - it carries no arithmetic and is carried positionally
   * through a regeneration, so blocking one over it would be pure friction.
   */
  function markPlanDirty() {
    setPlanDirty(true);
  }

  /**
   * Back to the formula, for both `Regerar plano` and the confirm bar's `Aplicar`.
   * `appliedPlanKey` is cleared as well as the flag, because a row edit alone leaves
   * the key untouched and the regeneration guard would otherwise find nothing to do.
   */
  function regeneratePlan() {
    setPlanDirty(false);
    setAppliedPlanKey('');
  }

  /** Keep the hand-edited rows and rewind the header to the formula that produced them. */
  function keepEditedRows() {
    const inputs = planShapeInputs(planShapeFromKey(appliedPlanKey) ?? planShape);
    setEntradaMode(inputs.entradaMode);
    setEntradaValueInput(inputs.entradaValueInput);
    setRestanteCountInput(inputs.restanteCountInput);
    setPlanAnchorDate(inputs.anchorDate);
    setAppliedPlanKey(planShapeKey(totalCents, wizardPlanShape(inputs)));
  }

  function handleSellerChange(value: string) {
    setSellerPersonId(value);
    if (sellerIsFinder) {
      setFinderPersonId(value);
    }
  }

  /**
   * The cliente create row. When a create handler is wired the typed name becomes a real
   * cliente and the proposta carries its id. With no handler, or when the create fails,
   * this falls back to exactly what the old datalist did: keep the typed name as the
   * snapshot and leave `clientId` empty, so the proposta still saves.
   */
  async function createClient(name: string) {
    setClientName(name);
    setClientId('');
    if (!onCreateClient) return;
    const created = await onCreateClient(name);
    if (!created) return;
    setClientId(created.id);
    setClientName(created.name);
  }

  async function createAreaForItem(index: number, name: string) {
    if (!onCreateArea) return;
    const created = await onCreateArea(name);
    if (!created) return;
    setCreatedAreas((current) =>
      current.some((area) => area.id === created.id) ? current : [...current, created],
    );
    setItem(index, { areaId: created.id });
  }

  /**
   * The one place a profissional row's função is written. Extracted so the picker's
   * `onChange` and its create row cannot drift apart on the cost re-derivation rule.
   */
  function applyFuncaoToProfessional(index: number, funcaoId: string, funcaoName: string) {
    setProfessionals((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const next = { ...item, funcaoId, funcaoName };
        // Re-derive only a cost the operator never typed into.
        return item.costManual
          ? next
          : { ...next, costBrl: centsToInput(funcaoCostBasis.get(funcaoId)?.cents ?? 0) };
      }),
    );
  }

  /**
   * Mirrors `createAreaForItem` above and `handleCreateFuncao` in PersonDialogBody:
   * the Combobox `onCreate` is `(query: string) => void`, so the async create is
   * wrapped rather than returned, and a rejected create resolves to null and leaves
   * the row untouched. No dialog in this app surfaces API errors today.
   *
   * `created` is the row the API RETURNED, never a row read back out of the query
   * cache, which is what keeps a placeholder id out of `professionals[].funcaoId`.
   */
  async function createFuncaoForProfessional(index: number, name: string) {
    if (!onCreateFuncao) return;
    const created = await onCreateFuncao(name);
    if (!created) return;
    /*
      `allocatableFuncoes` filters optimistic ids so a placeholder can never be
      SELECTED, but the create path writes `created.id` straight through. In-repo
      `createFuncaoByName` resolves the API response, so this cannot fire; the guard
      exists because `SaleWizardDialog` is exported and an outside caller could hand
      back a cached row. Without it the row would drop out of the options while
      `valueLabel` still printed the name, so the leak would be invisible until the
      uuid cast failed and took the whole wizard with it.
    */
    if (isOptimisticId(created.id)) return;
    setCreatedFuncoes((current) =>
      current.some((funcao) => funcao.id === created.id) ? current : [...current, created],
    );
    applyFuncaoToProfessional(index, created.id, created.name);
  }

  function showFinder() {
    setFinderVisible(true);
    setFinderPersonId((current) => current || finders[0]?.id || sellerPersonId);
  }

  function hideFinder() {
    setFinderVisible(false);
    setSellerIsFinder(false);
    setFinderPersonId('');
  }

  function toggleSellerIsFinder() {
    setSellerIsFinder((current) => {
      const next = !current;
      setFinderPersonId(next ? sellerPersonId : finders[0]?.id ?? '');
      return next;
    });
  }

  function advanceWizard() {
    if (wizardStep === 1) {
      setShowItemErrors(true);
      if (!canAdvanceStepOne) return;
    }
    if (wizardStep === 2) {
      setShowPlanErrors(true);
      if (!canAdvanceStepTwo) return;
    }
    if (wizardStep === 3) {
      setShowCostErrors(true);
      if (!canAdvanceStepThree) return;
    }
    if (wizardStep < 4) {
      setWizardStep((current) => (current + 1) as 2 | 3 | 4);
      return;
    }
    submit('open');
  }

  function goBack() {
    setWizardStep((current) => (current > 1 ? ((current - 1) as 1 | 2 | 3) : current));
  }

  function createPayload(status: 'draft' | 'open'): CreateSalePayload {
    const seller = selectedSeller;
    const finder = selectedFinder;
    const draft: SaleDraft = {
      clientId,
      clientName,
      sellerPersonId,
      sellerName: seller?.displayName ?? '',
      finderPersonId: hasFinderForSale
        ? sellerIsFinder
          ? sellerPersonId
          : finderPersonId || undefined
        : undefined,
      finderName: finder?.displayName,
      status,
      baseDate,
      notes,
      sellerCommissionPct,
      finderCommissionPct,
      taxPct,
      otherCostsBrl: otherCents,
      installments: installmentRows.map((row) => ({
        dueDate: row.dueDate,
        amountBrl: parseCurrencyToCents(row.amountBrl),
        method: row.method,
      })),
      recurring:
        recurringMode === 'monthly'
          ? {
              monthlyBrl: parseCurrencyToCents(recurringMonthlyBrl),
              startDate: recurringStartDate,
              cycles: recurringIndefinite ? null : recurringCyclesCount,
              method: recurringMethod,
            }
          : null,
      items: items.map((item) => {
        if (item.kind === 'free') {
          return {
            productId: undefined,
            areaId: item.areaId,
            productName: item.customLabel.trim() || 'Item avulso',
            productType: 'Avulso',
            quantity: '1',
            unitBrl: parseCurrencyToCents(item.unitBrl),
          };
        }
        const product = selectedProduct(item);
        return {
          productId: product?.id,
          areaId: product?.areaId ?? undefined,
          productName: saleItemDisplayName(item),
          /*
            A literal, not a read off the product: `type` was renamed to `kind` and
            the API no longer returns it, so `product?.type` was always `undefined`
            and this expression always took the fallback. The value on the wire is
            unchanged, because the server derives `product_type_snapshot` from the
            product's own `kind` and ignores whatever the client sends here.
          */
          productType: 'SaaS',
          quantity: item.quantity,
          unitBrl: parseCurrencyToCents(item.unitBrl),
        };
      }),
      professionals: professionals.map((professional) => ({
        personId: professional.personId,
        personName: professional.personName,
        funcaoId: professional.funcaoId,
        // The API derives funcao_name_snapshot from the resolved cadastro row and
        // ignores this; it is sent so a legacy row with no funcaoId stays a valid
        // payload rather than tripping funcao_or_role_required.
        role: professional.funcaoName,
        // Resolved here, never on the wire: `cost_brl` is a single integer-cents column.
        costBrl: professionalRowCents(professional),
      })),
    };
    return buildSalePayload(draft);
  }

  function submit(status: 'draft' | 'open') {
    if (!canSave) return;
    if (editSale && editSale.status !== 'draft' && editSale.status !== 'open') return;
    onSave(createPayload(status));
  }

  const wizardSteps: Array<{ step: 1 | 2 | 3 | 4; label: string }> = [
    { step: 1, label: 'Proposta' },
    { step: 2, label: 'Pagamento' },
    { step: 3, label: 'Custos e margem' },
    { step: 4, label: 'Revisão' },
  ];
  const primaryLabel = wizardStep < 4 ? 'Avançar' : 'Salvar proposta';

  return (
    <Dialog onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)} open>
      <DialogContent className={wizardDialogContentClass}>
        <DialogHeader className={wizardHeaderClass}>
          <DialogTitle className="sales-ops-num text-[19px] font-bold text-[#201f24]">
            {editSale ? 'Editar proposta' : 'Nova proposta'}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-[#8b8b92]">
            Cliente, itens, pagamento e custos - salve como rascunho a qualquer momento
          </DialogDescription>
        </DialogHeader>

        <WizardStepper
          current={wizardStep}
          isEnabled={(step) =>
            !(
              (step > 1 && !canAdvanceStepOne) ||
              (step > 2 && !canAdvanceStepTwo) ||
              (step > 3 && !canAdvanceStepThree)
            )
          }
          onSelect={setWizardStep}
          steps={wizardSteps}
        />

        <div className={wizardBodyClass}>
          {bootstrap.products.length === 0 || sellers.length === 0 ? (
            <EmptyPanel
              text="Cadastre pelo menos um produto e um vendedor para registrar uma proposta."
              title="Cadastro incompleto"
            />
          ) : (
            <>
              {wizardStep === 1 ? (
                <div className="flex flex-col gap-[18px]">
                  <div className="rounded-[14px] border border-[#e8e8ec] bg-white p-4">
                    <div className="mb-4 text-[13px] font-bold">Cliente e responsáveis</div>
                    <FieldBlock label="Cliente" required>
                      <Combobox
                        aria-label="Cliente"
                        className={formSelectClass}
                        emptyMessage="Nenhum cliente encontrado"
                        entityGender="m"
                        entityLabel="cliente"
                        onChange={(value) => {
                          const client = bootstrap.clients.find(
                            (candidate) => candidate.id === value,
                          );
                          setClientId(value);
                          setClientName(client?.name ?? '');
                        }}
                        onCreate={(name) => void createClient(name)}
                        options={bootstrap.clients.map((client) => ({
                          value: client.id,
                          label: client.name,
                        }))}
                        placeholder="Buscar ou digitar um novo cliente..."
                        searchPlaceholder="Buscar ou digitar um novo cliente..."
                        value={clientId}
                        // A name typed into the create row is not in `options`; this keeps it
                        // visible on the trigger with no clientId, as the datalist did.
                        valueLabel={clientName}
                      />
                    </FieldBlock>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <FieldBlock label="Vendedor" required>
                        <Combobox
                          aria-label="Vendedor"
                          className={formSelectClass}
                          emptyMessage="Nenhum vendedor cadastrado"
                          onChange={handleSellerChange}
                          options={personOptions(sellers)}
                          searchPlaceholder="Buscar vendedor..."
                          value={sellerPersonId}
                        />
                      </FieldBlock>

                      {finderVisible ? (
                        <div>
                          <div className="mb-[6px] flex items-center justify-between">
                            <span className="text-xs font-semibold text-[#8b8b92]">Finder</span>
                            <button
                              className="text-xs font-semibold text-[#b23a22]"
                              onClick={hideFinder}
                              type="button"
                            >
                              remover
                            </button>
                          </div>
                          <Combobox
                            aria-label="Finder"
                            className={formSelectClass}
                            disabled={sellerIsFinder}
                            emptyMessage="Nenhum finder cadastrado"
                            onChange={setFinderPersonId}
                            options={personOptions(finders)}
                            searchPlaceholder="Buscar finder..."
                            value={finderPersonId}
                          />
                          {settings.sellerCanBeFinder ? (
                            <button
                              className="mt-[9px] flex items-center gap-2 text-[13px] text-[#57575f]"
                              onClick={toggleSellerIsFinder}
                              type="button"
                            >
                              <span
                                className={`flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border ${
                                  sellerIsFinder
                                    ? 'border-[#eaa81a] bg-[#eaa81a]'
                                    : 'border-[#c9c3b4] bg-white'
                                }`}
                              >
                                {sellerIsFinder ? <Check className="h-3 w-3 text-white" /> : null}
                              </span>
                              Vendedor é o finder desta venda
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <div>
                          <div className="mb-[6px] text-xs font-semibold text-transparent">.</div>
                          <button
                            className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-[#d8cdb0] bg-[#fafafb] px-3 text-[13.5px] font-semibold text-[#9c7210] transition hover:bg-[#f4efe2]"
                            onClick={showFinder}
                            type="button"
                          >
                            <Plus className="h-[15px] w-[15px]" />
                            Essa proposta teve um finder
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <Field label="Data da proposta">
                        <Input
                          className={`sales-ops-num ${formInputClass}`}
                          onChange={(event) => setBaseDate(event.target.value)}
                          type="date"
                          value={baseDate}
                        />
                      </Field>
                    </div>
                  </div>

                  <div className="rounded-[14px] border border-[#e8e8ec] bg-white p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-[13px] font-bold">Itens</div>
                      <div className="flex items-center gap-2">
                        <button
                          className="rounded-[9px] border border-[#dcdce2] bg-white px-3 py-[7px] text-[12.5px] font-semibold text-[#9c7210] transition hover:bg-[#f2f2f4] disabled:cursor-not-allowed disabled:opacity-45"
                          disabled={!onCreateProduct}
                          onClick={() => onCreateProduct?.('')}
                          type="button"
                        >
                          Cadastrar produto
                        </button>
                        <button
                          className="rounded-[9px] border border-[#dcdce2] bg-white px-3 py-[7px] text-[12.5px] font-semibold text-[#57575f] transition hover:bg-[#f2f2f4] disabled:cursor-not-allowed disabled:opacity-45"
                          disabled={activeAreas.length === 0}
                          onClick={addFreeItem}
                          title={activeAreas.length === 0 ? 'Cadastre áreas em Cadastros > Áreas' : undefined}
                          type="button"
                        >
                          + item avulso
                        </button>
                        <button
                          className="rounded-[9px] bg-[#201f24] px-3 py-[7px] text-[12.5px] font-semibold text-white transition hover:bg-[#33333a]"
                          onClick={addItem}
                          type="button"
                        >
                          + item
                        </button>
                      </div>
                    </div>
                    {/*
                      `pl-3` and `pr-3` are the `px-3` of `formSelectClass` and
                      `formInputClass`, so each label sits exactly over the text of the
                      control it names. `Qtd.` needs none because its `Input` is
                      `text-center` inside a symmetric `px-3`; `Subtotal` needs none
                      because the cell under it is a bare `<div>` with no padding.
                    */}
                    <div className={`${saleItemGridClass} ${saleItemHeaderClass}`}>
                      <span className="pl-3">Produto / serviço</span>
                      <span className="text-center">Qtd.</span>
                      <span className="pr-3 text-right">Valor unit.</span>
                      <span className="text-right">Subtotal</span>
                      <span />
                    </div>
                    {/* Larger than the `gap-[7px]` inside one block, so the boundary reads. */}
                    <div className="flex flex-col gap-[10px]">
                      {items.map((item, index) => {
                        if (item.kind === 'free') {
                          const areaValid = Boolean(item.areaId);
                          const descriptionValid = Boolean(item.customLabel.trim());
                          const unitValid = parseCurrencyToCents(item.unitBrl) > 0;
                          const subtotal = parseCurrencyToCents(item.unitBrl);
                          return (
                            <div className={saleItemBlockClass} key={`free-${index}`}>
                              <div className={`${saleItemGridClass} items-center`}>
                                <Combobox
                                  aria-label={`Área do item ${index + 1}`}
                                  className={formSelectClass}
                                  emptyMessage="Nenhuma área encontrada"
                                  entityGender="f"
                                  entityLabel="área"
                                  onChange={(value) => setItem(index, { areaId: value })}
                                  onCreate={
                                    onCreateArea
                                      ? (name) => void createAreaForItem(index, name)
                                      : undefined
                                  }
                                  options={areaOptions(selectableAreas)}
                                  placeholder="Selecione a área"
                                  searchPlaceholder="Buscar área..."
                                  value={item.areaId}
                                />
                                <div className="sales-ops-num text-center text-[13.5px] text-[#57575f]">1</div>
                                <Input
                                  aria-invalid={showItemErrors && !unitValid}
                                  aria-label={`Valor unitário do item ${index + 1}`}
                                  className={cn(
                                    'sales-ops-num text-right',
                                    formInputClass,
                                    showItemErrors && !unitValid && 'border-destructive',
                                  )}
                                  onChange={(event) => setItem(index, { unitBrl: event.target.value })}
                                  value={item.unitBrl}
                                />
                                <div className="sales-ops-num text-right text-[13.5px] font-bold">
                                  {formatMoneyBrl(subtotal, { maximumFractionDigits: 0 })}
                                </div>
                                <button
                                  aria-label={`Remover item ${index + 1}`}
                                  className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#f0dcd5] bg-[#fbeee9] text-[#b23a22] transition hover:bg-[#f6e0d9]"
                                  onClick={() =>
                                    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
                                  }
                                  type="button"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              {/*
                                A free row's description IS the item's name, so it is
                                required and renders open unconditionally, with no
                                reveal affordance.
                              */}
                              <div className={saleItemGridClass}>
                                <label className="flex min-w-0 flex-col gap-[6px]">
                                  <span className={saleItemFieldLabelClass}>Descrição do item</span>
                                  <Input
                                    aria-invalid={showItemErrors && !descriptionValid}
                                    aria-label={`Descrição do item ${index + 1}`}
                                    className={cn(
                                      'h-10 rounded-[9px]',
                                      formInputClass,
                                      showItemErrors && !descriptionValid && 'border-destructive',
                                    )}
                                    maxLength={140}
                                    onChange={(event) => setItem(index, { customLabel: event.target.value })}
                                    placeholder="Ex.: Consultoria de processos"
                                    value={item.customLabel}
                                  />
                                </label>
                              </div>
                              {/* One always-present home for every message this row emits. */}
                              <div className="flex flex-col gap-1 pl-3">
                                {showItemErrors ? (
                                  <span className="flex flex-col gap-1 text-[11.5px] font-semibold text-destructive">
                                    {!areaValid ? <span>Selecione a área deste item.</span> : null}
                                    {!descriptionValid ? (
                                      <span>Informe a descrição deste item avulso.</span>
                                    ) : null}
                                    {!unitValid ? (
                                      <span>Informe um valor negociado maior que zero.</span>
                                    ) : null}
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#9c7210]">
                                    <AlertTriangle className="h-[13px] w-[13px]" />
                                    Item avulso - informe a área, a descrição e o valor
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        }

                        const product = selectedProduct(item);
                        const { isService, hasVariableValue, needsDescription } =
                          productRowRequirements(product);
                        const customLabelValid = Boolean(item.customLabel.trim());
                        const customUnitValid = parseCurrencyToCents(item.unitBrl) > 0;
                        const showCustomLabelError =
                          needsDescription && showItemErrors && !customLabelValid;
                        const showCustomUnitError =
                          hasVariableValue && showItemErrors && !customUnitValid;
                        const showAreaError = showItemErrors && !product?.areaId;
                        /*
                          The ONE regime the affordance may collapse. A free row's
                          description is its name and an open-price non-Serviço row
                          REQUIRES one, so neither is ever hidden; a Serviço falls back
                          to the catalog name, which is what makes its description
                          genuinely optional.

                          Note the deliberate asymmetry: once revealed, clearing the
                          text does NOT re-collapse the field, because `descriptionOpen`
                          stays true. A field must never vanish from under the caret.
                        */
                        const descriptionOptional = hasVariableValue && !needsDescription;
                        const descriptionVisible =
                          hasVariableValue &&
                          (needsDescription ||
                            item.descriptionOpen ||
                            Boolean(item.customLabel.trim()));
                        // Three cases, three hints: a serviço says the description
                        // is optional and names the label it will fall back to, an
                        // open-price produto keeps asking for both.
                        let descriptionHint =
                          'Sistema personalizado - informe um nome/descrição e o valor negociado';
                        if (isService) {
                          descriptionHint = customLabelValid
                            ? 'Serviço com valor variável - descrição opcional'
                            : `Serviço com valor variável - sem descrição, o item aparece como "${saleItemDisplayName(item)}"`;
                        }
                        const showRowMessages = showItemErrors
                          ? showCustomLabelError || showCustomUnitError || showAreaError
                          : hasVariableValue;
                        const subtotal =
                          Math.max(1, Number(item.quantity) || 1) * parseCurrencyToCents(item.unitBrl);
                        return (
                          <div className={saleItemBlockClass} key={`${item.productId}-${index}`}>
                            {/*
                              Column 1 is now the picker and nothing else, which is what
                              lets `items-center` line the numbers up with it: the área
                              badge used to stack under the picker and make this cell
                              ~68px tall against 40px everywhere else.
                            */}
                            <div className={`${saleItemGridClass} items-center`}>
                              <Combobox
                                aria-label={`Produto / serviço do item ${index + 1}`}
                                className={formSelectClass}
                                emptyMessage="Nenhum produto encontrado"
                                entityGender="m"
                                entityLabel="produto"
                                onChange={(value) => setItem(index, { productId: value })}
                                // Deliberately not an inline create: a produto is invalid
                                // without an área and carries pricing plus three commission
                                // pairs, so the create row opens ProductDialog prefilled.
                                onCreate={
                                  onCreateProduct ? (name) => onCreateProduct(name) : undefined
                                }
                                options={productOptions(bootstrap.products, areaNameById)}
                                searchPlaceholder="Buscar produto..."
                                value={item.productId}
                              />
                              <Input
                                aria-label={`Quantidade do item ${index + 1}`}
                                className={`sales-ops-num text-center ${formInputClass}`}
                                min={1}
                                onChange={(event) => setItem(index, { quantity: event.target.value })}
                                type="number"
                                value={item.quantity}
                              />
                              <Input
                                aria-invalid={showCustomUnitError}
                                aria-label={`Valor unitário do item ${index + 1}`}
                                className={cn(
                                  'sales-ops-num text-right',
                                  formInputClass,
                                  showCustomUnitError && 'border-destructive',
                                )}
                                onChange={(event) => setItem(index, { unitBrl: event.target.value })}
                                value={item.unitBrl}
                              />
                              <div className="sales-ops-num text-right text-[13.5px] font-bold">
                                {formatMoneyBrl(subtotal, { maximumFractionDigits: 0 })}
                              </div>
                              <button
                                aria-label={`Remover item ${index + 1}`}
                                className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#f0dcd5] bg-[#fbeee9] text-[#b23a22] transition hover:bg-[#f6e0d9]"
                                onClick={() =>
                                  setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
                                }
                                type="button"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            {/* Metadata about the produto in column 1, plus the reveal affordance. */}
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pl-3">
                              {product?.areaId ? (
                                <span className="rounded-full bg-[#ececf1] px-2 py-[2px] text-[11px] font-bold text-[#57575f]">
                                  {areaNameById.get(product.areaId) ?? 'Área'}
                                </span>
                              ) : (
                                <span className="rounded-full bg-[#fdf0cf] px-2 py-[2px] text-[11px] font-bold text-[#9c7210]">
                                  Sem área
                                </span>
                              )}
                              {descriptionOptional && !descriptionVisible ? (
                                <button
                                  className="rounded-[7px] border border-dashed border-[#dcdce2] px-2 py-[3px] text-[11.5px] font-semibold text-[#57575f] transition hover:border-[#eaa81a] hover:text-[#9c7210]"
                                  onClick={() => revealDescription(index)}
                                  type="button"
                                >
                                  + Adicionar descrição
                                </button>
                              ) : null}
                            </div>
                            {/*
                              The description, on the same grid, so the input lands exactly
                              under the produto picker and reads as a property of it.
                            */}
                            {descriptionVisible ? (
                              <div className={saleItemGridClass}>
                                <label className="flex min-w-0 flex-col gap-[6px]">
                                  <span className={saleItemFieldLabelClass}>
                                    {isService
                                      ? 'Nome / descrição do item (opcional)'
                                      : 'Nome / descrição do item'}
                                  </span>
                                  <Input
                                    aria-invalid={showCustomLabelError}
                                    // Frozen: existing wizard tests query this exact
                                    // string, and the (opcional) hint belongs to the
                                    // visible label, not to the accessible name.
                                    aria-label={`Nome / descrição do item ${index + 1}`}
                                    className={cn(
                                      'h-10 rounded-[9px]',
                                      formInputClass,
                                      showCustomLabelError && 'border-destructive',
                                    )}
                                    maxLength={140}
                                    onChange={(event) =>
                                      setItem(index, { customLabel: event.target.value })
                                    }
                                    placeholder={
                                      isService ? 'Ex.: detalhe do escopo' : 'Ex.: Módulo Vendas'
                                    }
                                    ref={(node) => {
                                      if (node && pendingDescriptionFocus.current === index) {
                                        pendingDescriptionFocus.current = null;
                                        node.focus();
                                      }
                                    }}
                                    value={item.customLabel}
                                  />
                                </label>
                              </div>
                            ) : null}
                            {/*
                              Every message this row can emit, in one always-present home
                              OUTSIDE the collapsible block. `showCustomUnitError` is a
                              VALUE error and a blank-description Serviço row is exactly
                              the collapsing case, so keeping it inside the description
                              would hide it from the row that most needs it.
                            */}
                            {showRowMessages ? (
                              <div className="flex flex-col gap-1 pl-3">
                                {showItemErrors ? (
                                  <span className="flex flex-col gap-1 text-[11.5px] font-semibold text-destructive">
                                    {showCustomLabelError ? (
                                      <span>
                                        Informe o nome ou a descrição deste item personalizado.
                                      </span>
                                    ) : null}
                                    {showCustomUnitError ? (
                                      <span>Informe um valor negociado maior que zero.</span>
                                    ) : null}
                                    {showAreaError ? (
                                      <span>
                                        Defina a área deste produto em Cadastros {'>'} Produtos &
                                        Serviços.
                                      </span>
                                    ) : null}
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#9c7210]">
                                    <AlertTriangle className="h-[13px] w-[13px]" />
                                    {descriptionHint}
                                  </span>
                                )}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <Field label="Observações">
                    <textarea
                      className="min-h-[74px] rounded-[10px] border border-[#dcdce2] bg-white px-3 py-2 text-sm outline-none transition focus:border-[#eaa81a]"
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="Notas internas sobre a proposta..."
                      value={notes}
                    />
                  </Field>

                  <div className="flex items-baseline justify-end gap-2.5 rounded-[12px] border border-[#e8e8ec] bg-white px-[18px] py-[14px]">
                    <span className="text-[13px] font-semibold text-[#8b8b92]">Total da proposta</span>
                    <span className="sales-ops-num text-2xl font-bold text-[#9c7210]">
                      {formatMoneyBrl(totalCents, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>
              ) : null}

              {wizardStep === 2 ? (
                <div className="flex flex-col gap-[18px]">
                  <div className="rounded-[14px] border border-[#e8e8ec] bg-white p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-[13px] font-bold">Plano de pagamento</div>
                      {planDirty ? (
                        <button
                          className="text-[12.5px] font-semibold text-[#9c7210] underline-offset-2 transition hover:underline"
                          onClick={regeneratePlan}
                          type="button"
                        >
                          Regerar plano
                        </button>
                      ) : null}
                    </div>

                    {/*
                      Declarative and always visible: nothing to toggle and no per-row add
                      or remove affordance. "50% de entrada + o resto em 3x" is two
                      controls, and the table below follows them as they are typed.

                      One grid, three columns, one 9px gutter - the same gutter the
                      `Parcelas a receber` table below uses. Each control's derived line is
                      the next child of its OWN `FieldBlock` and is left-aligned, so it sits
                      under the control it describes instead of being pushed to that grid
                      column's right edge.
                    */}
                    <div className="grid gap-x-[9px] gap-y-3 md:grid-cols-3">
                      <FieldBlock label="Entrada">
                        <div className="flex items-center gap-[9px]">
                          {/* With no value input beside it the picker takes the whole column,
                              so all three columns read as one filled 44px control on one axis. */}
                          <div
                            className={entradaMode === 'none' ? 'flex-1' : 'w-[116px] flex-none'}
                          >
                            <Combobox
                              aria-label="Tipo de entrada"
                              className={formSelectClass}
                              onChange={(value) => setEntradaMode(value as PaymentPlanEntradaMode)}
                              options={entradaModeOptions}
                              searchPlaceholder="Buscar tipo de entrada..."
                              value={entradaMode}
                            />
                          </div>
                          {entradaMode === 'none' ? null : (
                            <UnitInput
                              ariaLabel="Valor da entrada"
                              onChange={setEntradaValueInput}
                              unit={entradaMode === 'fix' ? 'R$' : '%'}
                              value={entradaValueInput}
                            />
                          )}
                        </div>
                        <div
                          className={cn(
                            'sales-ops-num text-[12.5px] font-bold',
                            entradaMode === 'none' ? 'text-[#9b9ba3]' : 'text-[#2f7d4b]',
                          )}
                        >
                          {entradaMode === 'none' ? 'sem entrada' : formatMoneyBrl(entradaCents)}
                        </div>
                      </FieldBlock>

                      <FieldBlock label="Restante">
                        {/* Same suffix affordance as `UnitInput`, kept local because this input
                            carries `min`/`max` clamps that `UnitInput` does not accept - routing
                            it through the shared helper would silently drop them. */}
                        <div className="relative">
                          <Input
                            aria-label="Parcelas restantes"
                            className={`sales-ops-num ${formInputClass} pr-8`}
                            max={maxRemainingInstallments(entradaMode)}
                            min={1}
                            onChange={(event) => setRestanteCountInput(event.target.value)}
                            type="number"
                            value={restanteCountInput}
                          />
                          <span className="pointer-events-none absolute right-[13px] top-1/2 -translate-y-1/2 text-[13px] font-bold text-[#9b9ba3]">
                            x
                          </span>
                        </div>
                        <div
                          className={cn(
                            'sales-ops-num text-[12.5px] font-bold',
                            restanteCents === 0 ? 'text-[#9b9ba3]' : 'text-[#2f7d4b]',
                          )}
                        >
                          {restanteCents === 0
                            ? 'entrada cobre o total'
                            : `${restanteCount} x ${formatMoneyBrl(restanteBaseCents)}${
                                restanteLastCents === restanteBaseCents
                                  ? ''
                                  : ` (última ${formatMoneyBrl(restanteLastCents)})`
                              }`}
                        </div>
                      </FieldBlock>

                      <FieldBlock label="Recorrência">
                        <Combobox
                          aria-label="Recorrência"
                          className={formSelectClass}
                          onChange={(value) => setRecurringMode(value as 'none' | 'monthly')}
                          options={recurringModeOptions}
                          searchPlaceholder="Buscar recorrência..."
                          value={recurringMode}
                        />
                      </FieldBlock>
                    </div>

                    {recurringMode === 'monthly' ? (
                      <div className="mt-3">
                        <div className="grid gap-x-[9px] gap-y-3 md:grid-cols-3">
                          <Field label="Mensalidade (R$)">
                            <Input
                              aria-label="Valor da mensalidade"
                              className={`sales-ops-num text-right ${formInputClass}`}
                              onChange={(event) => setRecurringMonthlyBrl(event.target.value)}
                              value={recurringMonthlyBrl}
                            />
                          </Field>
                          <Field label="Início">
                            <Input
                              aria-label="Início da recorrência"
                              className={`sales-ops-num ${formInputClass}`}
                              onChange={(event) => setRecurringStartDate(event.target.value)}
                              type="date"
                              value={recurringStartDate}
                            />
                          </Field>
                          <Field label="Nº de ciclos">
                            <Input
                              aria-label="Número de ciclos"
                              className={`sales-ops-num ${formInputClass}`}
                              max={MAX_PLAN_INSTALLMENTS}
                              min={1}
                              onChange={(event) => setRecurringCycles(event.target.value)}
                              placeholder="Indeterminado"
                              type="number"
                              value={recurringCycles}
                            />
                            <span className="text-[11.5px] text-[#8b8b92]">
                              Deixe em branco para prazo indeterminado
                            </span>
                          </Field>
                        </div>
                        {showPlanErrors ? (
                          <div className="mt-2 flex flex-col gap-1 text-[11.5px] font-semibold text-destructive">
                            {recurringMonthlyCents <= 0 ? (
                              <span>Informe uma mensalidade maior que zero.</span>
                            ) : null}
                            {recurringCyclesValid ? null : (
                              <span>
                                Informe um número de ciclos válido ou deixe em branco para prazo
                                indeterminado.
                              </span>
                            )}
                          </div>
                        ) : null}
                        {recurringMonthlyCents > 0 &&
                        /^\d{4}-\d{2}-\d{2}$/.test(recurringStartDate) ? (
                          <div className="mt-[14px] flex items-center gap-2.5 rounded-[11px] border border-[#cfe4cf] bg-[#e2efe2] px-[14px] py-[11px] text-[13px] font-semibold text-[#2f7d4b]">
                            <RotateCcw className="h-4 w-4 flex-none" />
                            Mensalidade de{' '}
                            {formatMoneyBrl(recurringMonthlyCents, {
                              maximumFractionDigits: 0,
                            })}{' '}
                            a partir de {displayDate(recurringStartDate)}
                            {recurringIndefinite
                              ? ', por prazo indeterminado'
                              : `, por ${recurringCyclesCount} ciclos`}
                          </div>
                        ) : null}
                        {recurringIndefinite ? (
                          <div className="mt-2 text-[12px] font-semibold text-[#9b9ba3]">
                            Sem parcelas futuras geradas agora - a mensalidade entra como receita
                            recorrente (MRR).
                          </div>
                        ) : (
                          <div className="mt-2 text-[12px] font-semibold text-[#9b9ba3]">
                            {recurringCyclesCount} ciclos de{' '}
                            {formatMoneyBrl(recurringMonthlyCents)}, de{' '}
                            {displayDate(recurringStartDate)} a{' '}
                            {displayDate(
                              addMonthsToIsoDate(recurringStartDate, recurringCyclesCount - 1),
                            )}
                          </div>
                        )}
                      </div>
                    ) : null}

                    <div className="mt-4 border-t border-[#eeeef1] pt-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[12.5px] font-bold text-[#57575f]">
                          Parcelas a receber
                        </div>
                        {planDirty ? (
                          <div className="text-[12px] font-semibold text-[#9b9ba3]">
                            Plano ajustado manualmente
                          </div>
                        ) : null}
                      </div>
                      {planPendingRegeneration ? (
                        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#f0dfae] bg-[#fdf0cf] px-3 py-2 text-[12.5px] font-semibold text-[#9c7210]">
                          <span>
                            Você ajustou as parcelas manualmente. Aplicar{' '}
                            {entradaMode === 'none' ? '' : 'entrada + '}
                            {restanteCount} x vai substituir as parcelas editadas.
                          </span>
                          <span className="flex items-center gap-2">
                            <button
                              className="rounded-[9px] bg-[#201f24] px-3 py-[7px] text-[12.5px] font-semibold text-white transition hover:bg-[#33333a]"
                              onClick={regeneratePlan}
                              type="button"
                            >
                              Aplicar
                            </button>
                            <button
                              className="rounded-[9px] border border-[#dcdce2] bg-white px-3 py-[7px] text-[12.5px] font-semibold text-[#57575f] transition hover:bg-[#f2f2f4]"
                              onClick={keepEditedRows}
                              type="button"
                            >
                              Manter parcelas
                            </button>
                          </span>
                        </div>
                      ) : null}
                      {/*
                        Four columns, not five: `Restante em N x` owns the row count now, so a
                        manual remove would desynchronise the header from the table.
                      */}
                      <div className="grid grid-cols-[44px_minmax(0,1fr)_150px_150px] gap-[9px] pb-[7px] text-[11px] font-bold uppercase tracking-[0.05em] text-[#9b9ba3]">
                        <span>Nº</span>
                        <span>Vencimento</span>
                        <span className="text-right">Valor</span>
                        <span>Forma</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {installmentRows.map((row, index) => {
                          const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(row.dueDate);
                          const amountValid = parseCurrencyToCents(row.amountBrl) > 0;
                          return (
                            <div
                              className="grid grid-cols-[44px_minmax(0,1fr)_150px_150px] items-center gap-[9px]"
                              key={index}
                            >
                              <div className="sales-ops-num text-[13px] font-semibold">
                                {index + 1}
                              </div>
                              <Input
                                aria-invalid={showPlanErrors && !dateValid}
                                aria-label={`Vencimento da parcela ${index + 1}`}
                                className={cn(
                                  'sales-ops-num',
                                  formInputClass,
                                  showPlanErrors && !dateValid && 'border-destructive',
                                )}
                                onChange={(event) => {
                                  markPlanDirty();
                                  setInstallmentRow(index, { dueDate: event.target.value });
                                }}
                                type="date"
                                value={row.dueDate}
                              />
                              <Input
                                aria-invalid={showPlanErrors && !amountValid}
                                aria-label={`Valor da parcela ${index + 1}`}
                                className={cn(
                                  'sales-ops-num text-right',
                                  formInputClass,
                                  showPlanErrors && !amountValid && 'border-destructive',
                                )}
                                onChange={(event) => {
                                  markPlanDirty();
                                  setInstallmentRow(index, { amountBrl: event.target.value });
                                }}
                                value={row.amountBrl}
                              />
                              {/* No markPlanDirty: forma carries positionally through a regeneration. */}
                              <Combobox
                                aria-label={`Forma de pagamento da parcela ${index + 1}`}
                                className={formSelectClass}
                                onChange={(value) =>
                                  setInstallmentRow(index, { method: value as PaymentMethod })
                                }
                                options={paymentMethodOptions}
                                searchPlaceholder="Buscar forma..."
                                value={row.method}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-[#eeeef1] pt-3 text-[12.5px]">
                        <span className="font-semibold text-[#8b8b92]">Soma das parcelas</span>
                        <span
                          className={`sales-ops-num font-bold ${planDeltaCents === 0 ? 'text-[#2f7d4b]' : 'text-[#b23a22]'}`}
                        >
                          {formatMoneyBrl(planSumCents)} / {formatMoneyBrl(totalCents)}
                        </span>
                      </div>
                      {planDeltaCents !== 0 ? (
                        <div className="mt-2 rounded-[10px] border border-[#f0dcd5] bg-[#fbeee9] px-3 py-2 text-[12.5px] font-semibold text-[#b23a22]">
                          A soma das parcelas precisa ser igual ao total da proposta. Diferença:{' '}
                          {formatMoneyBrl(Math.abs(planDeltaCents))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {wizardStep === 3 ? (
                <div className="flex flex-col gap-[18px]">
                  <div className="rounded-[11px] border border-[#f0dfae] bg-[#fdf0cf] px-[14px] py-[11px] text-[13px] text-[#57575f]">
                    Aloque os profissionais do projeto e ajuste os percentuais - a margem líquida e as comissões são calculadas em tempo real.
                  </div>

                  <div className="rounded-[14px] border border-[#e8e8ec] bg-white p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-[13px] font-bold">Profissionais alocados</div>
                      <button
                        className="rounded-[9px] bg-[#201f24] px-3 py-[7px] text-[12.5px] font-semibold text-white transition hover:bg-[#33333a]"
                        onClick={() =>
                          setProfessionals((current) => [
                            ...current,
                            {
                              personId: allocatablePeople[0]?.id ?? '',
                              personName: allocatablePeople[0]?.displayName ?? '',
                              // No seeded função: the old hardcoded 'Operacional'
                              // silently invented a cargo nobody chose.
                              funcaoId: '',
                              funcaoName: '',
                              // `fix` is the default everywhere, so a fresh row behaves
                              // exactly as it did before the unit toggle existed.
                              costUnit: 'fix',
                              costPct: '0',
                              costBrl: '0.00',
                              costManual: false,
                            },
                          ])
                        }
                        type="button"
                      >
                        + profissional
                      </button>
                    </div>
                    {/*
                      212px = a 96px toggle group + an 8px gap + a ~108px input, so the
                      `% | R$` pair fits beside the number instead of squeezing it.
                    */}
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_212px_36px] gap-[9px] px-0.5 pb-[7px] text-[11px] font-bold uppercase tracking-[0.05em] text-[#9b9ba3]">
                      <span>Profissional</span>
                      <span>Função no projeto</span>
                      {/* Left-aligned now: the control group starts at this cell's left edge. */}
                      <span>Custo alocado</span>
                      <span />
                    </div>
                    <div className="flex flex-col gap-2">
                      {professionals.length === 0 ? (
                        <div className="rounded-[10px] border border-dashed border-[#dcdce2] px-4 py-5 text-center text-[13px] font-semibold text-[#9b9ba3]">
                          Nenhum profissional alocado
                        </div>
                      ) : null}
                      {professionals.map((professional, index) => {
                        const basis = professional.funcaoId
                          ? funcaoCostBasis.get(professional.funcaoId)
                          : undefined;
                        const derivation = describeFuncaoCostBasis(basis);
                        const funcaoMissing =
                          showCostErrors &&
                          !professional.funcaoId &&
                          !professional.funcaoName.trim();
                        return (
                          <div
                            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_212px_36px] items-start gap-[9px]"
                            key={`${professional.personId}-${index}`}
                          >
                            <Combobox
                              aria-label={`Profissional ${index + 1}`}
                              className={formSelectClass}
                              emptyMessage="Nenhuma pessoa cadastrada"
                              entityGender="m"
                              entityLabel="profissional"
                              onChange={(value) => {
                                const person = allocatablePeople.find(
                                  (candidate) => candidate.id === value,
                                );
                                // The cost is deliberately untouched: a pessoa is
                                // not a cost driver, the função is.
                                setProfessionals((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? {
                                          ...item,
                                          personId: value,
                                          personName: person?.displayName ?? '',
                                        }
                                      : item,
                                  ),
                                );
                              }}
                              onCreate={(name) => {
                                setProfessionals((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, personId: '', personName: name }
                                      : item,
                                  ),
                                );
                              }}
                              options={personOptions(allocatablePeople)}
                              placeholder="Buscar ou digitar um nome..."
                              searchPlaceholder="Buscar ou digitar um nome..."
                              value={professional.personId}
                              valueLabel={professional.personName}
                            />
                            <div className="flex flex-col gap-1">
                              <Combobox
                                aria-invalid={funcaoMissing}
                                aria-label={`Função do profissional ${index + 1}`}
                                className={cn(
                                  formSelectClass,
                                  funcaoMissing && 'border-destructive',
                                )}
                                emptyMessage="Nenhuma função cadastrada"
                                entityGender="f"
                                entityLabel="função"
                                onChange={(value) => {
                                  const funcao = allocatableFuncoes.find(
                                    (candidate) => candidate.id === value,
                                  );
                                  applyFuncaoToProfessional(index, value, funcao?.name ?? '');
                                }}
                                onCreate={
                                  onCreateFuncao
                                    ? (name) => void createFuncaoForProfessional(index, name)
                                    : undefined
                                }
                                options={allocatableFuncoes.map((funcao) => ({
                                  value: funcao.id,
                                  label: funcao.name,
                                }))}
                                placeholder="Selecionar função..."
                                searchPlaceholder="Buscar função..."
                                value={professional.funcaoId}
                                // A legacy free-text snapshot such as `Operacional`
                                // still renders as this row's label, with a null
                                // funcaoId behind it.
                                valueLabel={professional.funcaoName}
                              />
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <div className="flex w-full gap-2">
                                <div className="flex flex-none gap-[3px] rounded-[9px] bg-[#f2f2f4] p-[3px]">
                                  <UnitToggle
                                    active={professional.costUnit === 'pct'}
                                    /*
                                      Indexed, not name-interpolated: stable from the
                                      moment the row is added.
                                    */
                                    ariaLabel={`Custo do profissional ${index + 1} em porcentagem`}
                                    onClick={() => setProfessionalCostUnit(index, 'pct')}
                                    value="%"
                                  />
                                  <UnitToggle
                                    active={professional.costUnit === 'fix'}
                                    ariaLabel={`Custo do profissional ${index + 1} em reais`}
                                    onClick={() => setProfessionalCostUnit(index, 'fix')}
                                    value="R$"
                                  />
                                </div>
                                <UnitInput
                                  // Unchanged label: the existing DOM tests address the
                                  // row by it.
                                  ariaLabel={`Custo alocado do profissional ${index + 1}`}
                                  onChange={(value) =>
                                    setProfessionals((current) =>
                                      current.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? item.costUnit === 'pct'
                                            ? { ...item, costPct: value, costManual: true }
                                            : { ...item, costBrl: value, costManual: true }
                                          : item,
                                      ),
                                    )
                                  }
                                  unit={professional.costUnit === 'fix' ? 'R$' : '%'}
                                  value={
                                    professional.costUnit === 'fix'
                                      ? professional.costBrl
                                      : professional.costPct
                                  }
                                />
                              </div>
                              {/*
                                The `%` branch comes FIRST: a percent row is always
                                costManual, so the chip branch would otherwise hide its
                                own derivation. The chip string still lives in the `fix`
                                branch below.
                              */}
                              {professional.costUnit === 'pct' ? (
                                <div className="flex flex-col items-end gap-1">
                                  {professionalRowBaseCents(professional) > 0 ? (
                                    <span className="text-right text-[11.5px] leading-tight text-[#9b9ba3]">
                                      {describeProfessionalCostBase(
                                        professional.costPct,
                                        basis,
                                        productItemsSubtotalCents,
                                      )}{' '}
                                      = {formatMoneyBrl(professionalRowCents(professional))}
                                    </span>
                                  ) : (
                                    /*
                                      The empty-basis case, never a silent zero: with no
                                      product item on the proposta a percentage has
                                      nothing to be a percentage OF.
                                    */
                                    <span className="text-right text-[11.5px] font-semibold leading-tight text-[#9c7210]">
                                      Nenhum item de produto na proposta - o percentual resolve para R$ 0,00.
                                    </span>
                                  )}
                                  {basis ? (
                                    <button
                                      className="text-[11px] font-semibold text-[#9c7210] underline"
                                      onClick={() => restoreProfessionalDefault(index, basis.cents)}
                                      type="button"
                                    >
                                      Restaurar padrão
                                    </button>
                                  ) : null}
                                </div>
                              ) : professional.costManual ? (
                                <div className="flex items-center gap-2">
                                  <span className="rounded-full bg-[#fdf0cf] px-[7px] py-[2px] text-[11px] font-semibold text-[#9c7210]">
                                    Alterado manualmente
                                  </span>
                                  {basis ? (
                                    <button
                                      className="text-[11px] font-semibold text-[#9c7210] underline"
                                      onClick={() => restoreProfessionalDefault(index, basis.cents)}
                                      type="button"
                                    >
                                      Restaurar padrão
                                    </button>
                                  ) : null}
                                </div>
                              ) : derivation ? (
                                <span className="text-right text-[11.5px] leading-tight text-[#9b9ba3]">
                                  {derivation}
                                </span>
                              ) : null}
                            </div>
                            <button
                              className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#f0dcd5] bg-[#fbeee9] text-[#b23a22] transition hover:bg-[#f6e0d9]"
                              onClick={() =>
                                setProfessionals((current) =>
                                  current.filter((_, itemIndex) => itemIndex !== index),
                                )
                              }
                              type="button"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {showCostErrors && !professionalsValid ? (
                      <div className="mt-3 rounded-[10px] border border-[#f0dcd5] bg-[#fbeee9] px-3 py-2 text-[12.5px] font-semibold text-[#b23a22]">
                        Selecione a função de cada profissional alocado.
                      </div>
                    ) : null}
                  </div>

                  {/*
                    Every one of these four is a produto DEFAULT, not a constraint.
                    Typing in one pins it for the rest of the session, so a later
                    produto change re-proposes only the fields nobody touched.
                  */}
                  <div className="grid gap-4 md:grid-cols-4">
                    <Field label="Outros custos (R$)">
                      <Input
                        className={`sales-ops-num bg-white ${formInputClass}`}
                        onChange={(event) => {
                          markManual('otherCostsBrl');
                          setOtherCostsBrl(event.target.value);
                        }}
                        value={otherCostsBrl}
                      />
                      {overrideMarker('otherCostsBrl', otherCostsBrl, setOtherCostsBrl)}
                    </Field>
                    <Field label="Comissão vendedor %">
                      <Input
                        className={`sales-ops-num bg-white ${formInputClass}`}
                        onChange={(event) => {
                          markManual('sellerCommissionPct');
                          setSellerCommissionPct(event.target.value);
                        }}
                        value={sellerCommissionPct}
                      />
                      {overrideMarker(
                        'sellerCommissionPct',
                        sellerCommissionPct,
                        setSellerCommissionPct,
                      )}
                    </Field>
                    <Field label="Comissão finder %">
                      <Input
                        className={`sales-ops-num bg-white ${formInputClass}`}
                        onChange={(event) => {
                          markManual('finderCommissionPct');
                          setFinderCommissionPct(event.target.value);
                        }}
                        value={finderCommissionPct}
                      />
                      {overrideMarker(
                        'finderCommissionPct',
                        finderCommissionPct,
                        setFinderCommissionPct,
                      )}
                    </Field>
                    <Field label="Imposto %">
                      <Input
                        className={`sales-ops-num bg-white ${formInputClass}`}
                        onChange={(event) => {
                          markManual('taxPct');
                          setTaxPct(event.target.value);
                        }}
                        value={taxPct}
                      />
                      {overrideMarker('taxPct', taxPct, setTaxPct)}
                    </Field>
                  </div>

                  <div className="rounded-2xl bg-[#18181b] px-[22px] py-5 text-[#f3f3f5]">
                    <div className="mb-[14px] flex items-end justify-between gap-4">
                      <div>
                        <div className="text-[13px] font-semibold text-[#9b9ba3]">Margem líquida</div>
                        <div className="mt-1 flex items-baseline gap-[11px]">
                          <span
                            className={`sales-ops-num text-[30px] font-bold ${marginCents >= 0 ? 'text-[#8fd19e]' : 'text-[#f08b72]'}`}
                          >
                            {formatMoneyBrl(marginCents, { maximumFractionDigits: 0 })}
                          </span>
                          <span
                            className={`sales-ops-num text-[17px] font-bold ${marginCents >= 0 ? 'text-[#8fd19e]' : 'text-[#f08b72]'}`}
                          >
                            ({marginPct}%)
                          </span>
                        </div>
                      </div>
                      <div className="text-right text-[12.5px] leading-[1.9] text-[#c9c9d0]">
                        <div>
                          Comissão vendedor ·{' '}
                          <span className="sales-ops-num font-semibold text-[#f3f3f5]">
                            {formatMoneyBrl(sellerCommissionCents, { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                        {hasFinderForSale ? (
                          <div>
                            Comissão finder ·{' '}
                            <span className="sales-ops-num font-semibold text-[#f3f3f5]">
                              {formatMoneyBrl(finderCommissionCents, { maximumFractionDigits: 0 })}
                            </span>
                          </div>
                        ) : null}
                        <div>
                          Custos profissionais ·{' '}
                          <span className="sales-ops-num font-semibold text-[#f3f3f5]">
                            {formatMoneyBrl(professionalCents, { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                        <div>
                          Imposto ·{' '}
                          <span className="sales-ops-num font-semibold text-[#f3f3f5]">
                            {formatMoneyBrl(taxCents, { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="h-2 overflow-hidden rounded-[5px] bg-[#33333a]">
                      <div
                        className={`h-full rounded-[5px] ${marginCents >= 0 ? 'bg-[#8fd19e]' : 'bg-[#f08b72]'}`}
                        style={{ width: `${Math.max(0, Math.min(100, marginPct))}%` }}
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              {wizardStep === 4 ? (
                <div className="flex flex-col gap-[14px]">
                  <div className="rounded-[11px] border border-[#f0dfae] bg-[#fdf0cf] px-[14px] py-[11px] text-[13px] text-[#57575f]">
                    Esta é uma previsão - nada é lançado no financeiro até a proposta ser marcada como Ganha.
                  </div>
                  <div className="grid gap-[14px] md:grid-cols-2">
                    <div className="rounded-[14px] border border-[#e8e8ec] bg-white p-[17px]">
                      <div className="mb-[11px] flex items-center justify-between">
                        <div className="text-[13px] font-bold">Dados da proposta</div>
                        <button
                          className="text-xs font-semibold text-[#9c7210]"
                          onClick={() => setWizardStep(1)}
                          type="button"
                        >
                          editar
                        </button>
                      </div>
                      <div className="flex flex-col gap-[7px] text-[13.5px]">
                        <div className="flex justify-between gap-4">
                          <span className="text-[#8b8b92]">Cliente</span>
                          <span className="font-semibold">{clientName || 'Sem cliente'}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-[#8b8b92]">Produto(s)</span>
                          <span className="font-semibold">
                            {items.map(saleItemDisplayName).join(', ')}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-[#8b8b92]">Vendedor</span>
                          <span className="font-semibold">{selectedSeller?.displayName ?? '-'}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-[#8b8b92]">Finder</span>
                          <span className="font-semibold">{selectedFinder?.displayName ?? 'Sem finder'}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-[#8b8b92]">Pagamento</span>
                          <span className="font-semibold">
                            {installmentRows.length} parcela{installmentRows.length > 1 ? 's' : ''}
                          </span>
                        </div>
                        {recurringMode === 'monthly' ? (
                          <div className="flex justify-between gap-4">
                            <span className="text-[#8b8b92]">Recorrência</span>
                            <span className="font-semibold">
                              {formatMoneyBrl(recurringMonthlyCents, { maximumFractionDigits: 0 })}/mês
                              {recurringIndefinite ? ' (indeterminado)' : ` por ${recurringCyclesCount} ciclos`}
                            </span>
                          </div>
                        ) : null}
                        {/*
                          `financials.totalBrl`, NOT the itens total: this is the
                          same basis the Margem líquida beside it uses and the same
                          one `sales_ops_sales.total_brl` persists, so a bounded
                          recorrência is inside it. Rendering the itens total here
                          let the card claim `Total R$ 1.000,00` next to a margin of
                          R$ 3.000, which reads as nonsense. An indeterminada
                          recorrência generates no bounded rows anywhere, so it
                          contributes nothing here either, and the Recorrência line
                          above still states the mensalidade separately.
                        */}
                        <div className="mt-0.5 flex justify-between gap-4 border-t border-[#eeeef1] pt-2">
                          <span className="text-[#8b8b92]">Total</span>
                          <span className="sales-ops-num text-[15px] font-bold text-[#9c7210]">
                            {formatMoneyBrl(financials.totalBrl)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col rounded-[14px] bg-[#18181b] p-[17px] text-[#f3f3f5]">
                      <div className="flex items-center justify-between">
                        <div className="text-[13px] font-bold">Margem líquida</div>
                        <button
                          className="text-xs font-semibold text-[#eaa81a]"
                          onClick={() => setWizardStep(3)}
                          type="button"
                        >
                          editar
                        </button>
                      </div>
                      <div className="mt-2.5">
                        <span
                          className={`sales-ops-num text-[30px] font-bold ${marginCents >= 0 ? 'text-[#8fd19e]' : 'text-[#f08b72]'}`}
                        >
                          {formatMoneyBrl(marginCents, { maximumFractionDigits: 0 })}
                        </span>{' '}
                        <span
                          className={`sales-ops-num text-[15px] font-bold ${marginCents >= 0 ? 'text-[#8fd19e]' : 'text-[#f08b72]'}`}
                        >
                          ({marginPct}%)
                        </span>
                      </div>
                      <div className="mt-3 text-[12.5px] leading-[1.9] text-[#c9c9d0]">
                        {/*
                          The effective percentages are on the labels and the three
                          costs are split out, so an override is visible exactly
                          where the operator confirms the proposta rather than
                          hidden inside one lumped costs-plus-tax total.
                        */}
                        <div className="flex justify-between gap-4">
                          <span>Comissão vendedor ({sellerCommissionPct}%)</span>
                          <span className="sales-ops-num font-semibold text-[#f3f3f5]">
                            {formatMoneyBrl(sellerCommissionCents)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span>Comissão finder ({finderCommissionPct}%)</span>
                          <span className="sales-ops-num font-semibold text-[#f3f3f5]">
                            {formatMoneyBrl(finderCommissionCents)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span>Custos profissionais</span>
                          <span className="sales-ops-num font-semibold text-[#f3f3f5]">
                            {formatMoneyBrl(professionalCents)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span>Imposto ({taxPct}%)</span>
                          <span className="sales-ops-num font-semibold text-[#f3f3f5]">
                            {formatMoneyBrl(taxCents)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span>Outros custos</span>
                          <span className="sales-ops-num font-semibold text-[#f3f3f5]">
                            {formatMoneyBrl(otherCents)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-[14px] border border-[#e8e8ec] bg-white">
                    <div className="flex items-center justify-between border-b border-[#eeeef1] px-4 py-[13px]">
                      <div>
                        <div className="text-[13px] font-bold">Previsão de contas a pagar</div>
                        <div className="mt-0.5 text-[11.5px] text-[#9b9ba3]">
                          Estes lançamentos serão gerados quando a proposta for marcada como Ganha.
                        </div>
                      </div>
                      <button
                        className="text-xs font-semibold text-[#9c7210]"
                        onClick={() => setWizardStep(3)}
                        type="button"
                      >
                        editar custos
                      </button>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-[#fafafb]">
                          <TableHead className={tableHeadClass}>Descrição</TableHead>
                          <TableHead className={tableHeadClass}>Tipo</TableHead>
                          <TableHead className={tableHeadClass}>Vencimento</TableHead>
                          <TableHead className={`${tableHeadClass} text-right`}>Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payablesPreview.map((payable, index) => (
                          <TableRow key={`${payable.label}-${index}`}>
                            <TableCell className="px-4 py-3 text-[13.5px] font-semibold">
                              {payable.label}
                            </TableCell>
                            <TableCell className="px-3 py-3">
                              <span
                                className={`rounded-full px-[9px] py-[3px] text-[11.5px] font-bold ${payable.className}`}
                              >
                                {payable.type}
                              </span>
                            </TableCell>
                            <TableCell className="sales-ops-num px-3 py-3 text-[13px] text-[#57575f]">
                              {payable.date}
                            </TableCell>
                            <TableCell className="sales-ops-num px-4 py-3 text-right text-[13.5px] font-bold">
                              {formatMoneyBrl(payable.value)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2 border-[#e8e8ec] bg-[#fafafb]">
                          <TableCell className="px-4 py-[13px] text-[13.5px] font-bold" colSpan={3}>
                            Total previsto
                          </TableCell>
                          <TableCell className="sales-ops-num px-4 py-[13px] text-right text-base font-bold text-[#b23a22]">
                            {formatMoneyBrl(payablesPreview.reduce((sum, item) => sum + item.value, 0))}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className={wizardFooterClass}>
          <button
            className={`${wizardSecondaryButtonClass} ${wizardStep === 1 ? 'invisible' : ''}`}
            onClick={goBack}
            type="button"
          >
            Voltar
          </button>
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-[#9b9ba3]">
              Passo {wizardStep} de 4
            </span>
            {!editSale || editSale.status === 'draft' ? (
              <button
                className="rounded-[11px] border border-[#dcdce2] bg-white px-[18px] py-[11px] text-sm font-semibold text-[#57575f] transition hover:bg-[#f2f2f4] disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!draftValid || saving}
                onClick={() => submit('draft')}
                title="Salvar como rascunho para terminar depois"
                type="button"
              >
                Salvar rascunho
              </button>
            ) : null}
            <button
              className={wizardPrimaryButtonClass}
              disabled={saving || (wizardStep === 1 && !canSave)}
              onClick={advanceWizard}
              type="button"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : primaryLabel}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
