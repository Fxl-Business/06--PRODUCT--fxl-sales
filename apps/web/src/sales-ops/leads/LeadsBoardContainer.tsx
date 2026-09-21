import * as React from 'react';
import type { ComboboxOption } from '@/components/ui/combobox';
import { Skeleton } from '@/components/ui/skeleton';
import type { SalesOpsClient, SalesOpsPerson, SalesOpsProduct } from '../types';
import type { SaveLeadPayload } from './api';
import { buildLabelLookups } from './board-labels';
import { mutedStateClass } from './board-ui';
import { LeadDialog } from './LeadDialog';
import { LeadsBoard, type LeadConversionRequest } from './LeadsBoard';
import { useLeadsBoard, useLeadStages, useMoveLead, useSaveLead } from './hooks';
import type { LeadBoardFilters, SalesOpsLead } from './types';

/**
 * The ONLY file in this slice that names a hook. Everything above it -
 * `LeadsBoard`, `LeadCard`, `MoveLeadDialog`, `LeadDialog` - is pure props in,
 * callbacks out, which is what lets every board oracle drive the real components
 * with no query client at all.
 *
 * It classifies no auth or entitlement failure: `SalesOpsApp` already owns that
 * chain one level up, and a second classifier would be a second gate.
 */

export type LeadsBoardContainerProps = {
  clients: SalesOpsClient[];
  people: SalesOpsPerson[];
  products: SalesOpsProduct[];
  /** Built by the routing layer with `hasFuncao(person, FUNCAO_SLUG_VENDEDOR)`. */
  sellers: ComboboxOption[];
  /**
   * Whether to OFFER the vendedor narrowing filter. `true` under `operacional`
   * (the team board), `false` under `meus-dados`.
   *
   * It is NOT a scope switch and must never be read as one. A seller's board is
   * narrowed SERVER-side inside `withTenant` from the verified token; this boolean
   * only decides whether an admin is offered a control, and setting it `true` for
   * a seller would add a picker, not data.
   *
   * The STATE behind it lives here and not in `SalesOpsApp.tsx`, unlike
   * `productKind`: that one is hoisted because the shell's header action READS it,
   * and nothing in the shell chrome reads this one. It is component state and not
   * URL state for the same reason `productKind` is - the URL is the source of
   * truth for the painel and the page, and a narrowing filter is neither.
   */
  showSellerFilter?: boolean;
  /** Forwarded verbatim to `LeadsBoard`. The conversion flow's entire attachment surface. */
  onRequestConversion?: (request: LeadConversionRequest) => Promise<string | null>;
  /** Opens the proposta a converted lead became. Forwarded verbatim. */
  onOpenSale?: (saleId: string) => void;
};

/** The edit path maps a rendered lead back into the write payload the dialog seeds from. */
function leadToSeed(lead: SalesOpsLead): SaveLeadPayload {
  return {
    id: lead.id,
    contactName: lead.contactName,
    clientId: lead.clientId,
    clientName: lead.clientNameSnapshot,
    estimatedValueBrl: lead.estimatedValueBrl,
    description: lead.description,
    sellerPersonId: lead.sellerPersonId,
    products: lead.products.map((row) =>
      row.productId ? { productId: row.productId } : { productName: row.productNameSnapshot },
    ),
  };
}

export function LeadsBoardContainer({
  clients,
  people,
  products,
  sellers,
  showSellerFilter = false,
  onRequestConversion,
  onOpenSale,
}: LeadsBoardContainerProps) {
  const [sellerPersonId, setSellerPersonId] = React.useState<string | null>(null);
  // The columns are resolved FIRST: the board query fans out one request per
  // stage and the API requires a `stageId`, so without the stage list there is
  // nothing to ask for.
  const stagesQuery = useLeadStages();
  const stages = React.useMemo(() => stagesQuery.data ?? [], [stagesQuery.data]);

  // A filter that is not OFFERED can never narrow: an operator who filters under
  // `operacional` and then opens their own board must not carry that narrowing
  // into a query the server has already scoped.
  const sellerFilterValue = showSellerFilter ? sellerPersonId : null;
  /*
    Memoized on the VALUE alone, and the same object reaches both hooks: the
    mutation patches the cache entry the board reads, so a mismatch would
    silently degrade to no optimistic write at all.
  */
  const filters = React.useMemo<LeadBoardFilters>(
    () => (sellerFilterValue ? { sellerPersonId: sellerFilterValue } : undefined),
    [sellerFilterValue],
  );

  const boardQuery = useLeadsBoard(stages, filters);
  const moveLead = useMoveLead(filters);
  const saveLead = useSaveLead();

  const lookups = React.useMemo(
    () => buildLabelLookups({ clients, people, products }),
    [clients, people, products],
  );

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dialogSeed, setDialogSeed] = React.useState<SaveLeadPayload | null>(null);

  const clientOptions = React.useMemo(
    () => clients.map((row) => ({ value: row.id, label: row.name })),
    [clients],
  );
  const productOptions = React.useMemo(
    () => products.map((row) => ({ value: row.id, label: row.name })),
    [products],
  );

  if (stagesQuery.isPending || boardQuery.isPending) {
    return <Skeleton className="h-[420px] w-full" />;
  }

  if (stagesQuery.isError || boardQuery.isError) {
    return <p className={mutedStateClass}>Não foi possível carregar o funil de leads.</p>;
  }

  // One clock per render, handed down, so no presentational component reads it.
  const now = new Date();

  return (
    <>
      <LeadsBoard
        hasMore={boardQuery.data?.hasMore ?? false}
        leads={boardQuery.data?.leads ?? []}
        loadingMore={boardQuery.isFetchingNextPage}
        lookups={lookups}
        movePending={moveLead.isPending}
        now={now}
        onCreateLead={() => {
          setDialogSeed(null);
          setDialogOpen(true);
        }}
        onEditLead={(lead) => {
          setDialogSeed(leadToSeed(lead));
          setDialogOpen(true);
        }}
        onLoadMore={() => {
          void boardQuery.fetchNextPage();
        }}
        onMoveLead={(payload) => moveLead.mutate(payload)}
        onOpenSale={onOpenSale}
        onRequestConversion={onRequestConversion}
        {...(showSellerFilter
          ? {
              sellerFilter: {
                value: sellerPersonId,
                options: sellers,
                onChange: setSellerPersonId,
              },
            }
          : {})}
        stages={stages}
      />

      {dialogOpen ? (
        <LeadDialog
          clients={clientOptions}
          initial={dialogSeed}
          // `LeadDialog` seeds its fields at MOUNT, so the identity of what is
          // being edited has to be the identity of the component.
          key={dialogSeed?.id ?? 'novo'}
          onOpenChange={setDialogOpen}
          onSubmit={(payload) => saveLead.mutate(payload)}
          open
          pending={saveLead.isPending}
          products={productOptions}
          sellers={sellers}
        />
      ) : null}
    </>
  );
}
