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
  /** Controlled vendedor filter; the routing layer owns the state. */
  sellerFilter?: { value: string | null; onChange: (value: string | null) => void };
  /** Forwarded verbatim to `LeadsBoard`. The conversion flow's entire attachment surface. */
  onRequestConversion?: (request: LeadConversionRequest) => Promise<string | null>;
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
  sellerFilter,
  onRequestConversion,
}: LeadsBoardContainerProps) {
  // The columns are resolved FIRST: the board query fans out one request per
  // stage and the API requires a `stageId`, so without the stage list there is
  // nothing to ask for.
  const stagesQuery = useLeadStages();
  const stages = React.useMemo(() => stagesQuery.data ?? [], [stagesQuery.data]);

  const sellerFilterValue = sellerFilter?.value ?? null;
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
        onRequestConversion={onRequestConversion}
        {...(sellerFilter
          ? {
              sellerFilter: {
                value: sellerFilter.value,
                options: sellers,
                onChange: sellerFilter.onChange,
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
