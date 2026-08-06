import { Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { userLabel } from '@/lib/displayNames';
import { isAuthFailure } from '@/lib/require-token';
import {
  formatLedgerTimestampBr,
  purgedEntityIds,
  resolveHistoryRow,
  type CadastroHistoryRow,
  type ResolvedHistoryRow,
} from './cadastro-history';
import { useCadastroHistory, useSetSalesOpsCadastroStatus } from './hooks';
import type { SetCadastroStatusPayload } from './api';
import type { SalesOpsBootstrap } from './types';

/*
  Intentional local copies of the `SalesOpsApp.tsx` style constants, exactly as
  `ProfessionalSplitPanel.tsx` re-declares what it cannot import: `SalesOpsApp.tsx`
  imports this module, so an import the other way would be a cycle.
*/
const panelClass = 'rounded-[18px] border border-[#e8e8ec] bg-white';
const mutedPanelClass = 'rounded-[18px] border border-[#e8e8ec] bg-[#fbfbfc]';
const tableHeadClass =
  'px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]';
const tableCellClass = 'px-4 py-3 text-[13.5px] text-[#57575f]';
const neutralBadgeClass = 'bg-[#eeeef1] text-[#6a6a72]';
const activeBadgeClass = 'bg-[#c9e7cf] text-[#1f7d43]';
/** The `Perdida` / `Imposto` palette, reused: this is the one irreversible event. */
const purgedBadgeClass = 'bg-[#f6d1c5] text-[#a5341c]';
const mutedStateClass = 'text-[13px] text-[#8b8b92]';
const restoreButtonClass =
  'inline-flex items-center gap-1.5 rounded-[9px] border border-[#dcdce2] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#57575f] transition hover:border-[#eaa81a] hover:bg-[#f5f2ea] hover:text-[#9c7210] disabled:cursor-not-allowed disabled:opacity-60';

/** The one place the append-only fact is spelled out for the operator. */
const APPEND_ONLY_SUBTITLE =
  'Registro somente-acréscimo: restaurar não apaga o arquivamento, apenas acrescenta um novo evento ao histórico.';

function MutedBlock({ text: body, title }: { text: string; title: string }) {
  return (
    <div className={`${mutedPanelClass} m-[22px] p-6 text-center`}>
      <p className="text-sm font-bold text-[#201f24]">{title}</p>
      <p className="mt-1 text-[13px] text-[#8b8b92]">{body}</p>
    </div>
  );
}

/**
 * `Histórico de arquivamentos` - flat, reverse-chronological, never grouped by
 * entity.
 *
 * The ledger is a hash chain: its order IS its meaning. Folding an archive and
 * its later restore into one visual row would collapse two independent chain
 * entries into one and would read as "the archive was undone", which is exactly
 * the impression an append-only record must never give.
 *
 * Pure and prop-driven, so every branch below is directly renderable from a test.
 */
export function CadastroHistoryPanel({
  bootstrap,
  entries,
  error,
  hasMore,
  isError,
  isLoading,
  onRestore,
  restoringId,
}: {
  bootstrap: SalesOpsBootstrap;
  entries: CadastroHistoryRow[];
  error: unknown;
  /** From `nextCursor !== null`, never from `entries.length`. */
  hasMore: boolean;
  isError: boolean;
  isLoading: boolean;
  onRestore: (target: SetCadastroStatusPayload, row: ResolvedHistoryRow) => void;
  /** The `entityId` whose restore is in flight, or null. */
  restoringId: string | null;
}) {
  /*
    Computed ONCE for the whole table, not per row: `Restaurar` has to disappear
    from an entity's earlier ARCHIVE row too, and that row cannot see the later
    purge entry on its own. Cheap and pure, so no memo - the page is 50 rows.
  */
  const purged = purgedEntityIds(entries);

  return (
    <section className={`${panelClass} overflow-hidden`}>
      <div className="border-b border-[#ececf1] px-[22px] py-4">
        <h3 className="text-[15px] font-bold text-[#201f24]">Histórico de arquivamentos</h3>
        <p className="mt-1 text-[13px] text-[#8b8b92]">{APPEND_ONLY_SUBTITLE}</p>
      </div>

      {isLoading ? (
        <div
          className={`${mutedPanelClass} m-[22px] flex items-center justify-center gap-2 p-6 text-[13px] text-[#8b8b92]`}
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando histórico
        </div>
      ) : isError ? (
        /*
          The same split the bootstrap panel makes: an expired or unrenewable Hub
          session must never read as "the server is broken".
        */
        isAuthFailure(error) ? (
          <MutedBlock
            text="Sua sessão do FXL Hub expirou ou não pôde ser renovada. Atualize a página para entrar novamente."
            title="Sessão expirada"
          />
        ) : (
          <MutedBlock
            text="Não foi possível carregar o histórico de arquivamentos."
            title="Não foi possível carregar"
          />
        )
      ) : entries.length === 0 ? (
        <MutedBlock
          text="Quando alguém arquivar um produto, uma área, uma função ou uma pessoa, o evento aparece aqui com autor, data e a opção de restaurar. A exclusão automática de itens arquivados há mais de 30 dias também fica registrada aqui."
          title="Nenhum arquivamento registrado"
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="bg-[#fafafb] hover:bg-[#fafafb]">
                <TableHead className={tableHeadClass}>Quando</TableHead>
                <TableHead className={tableHeadClass}>Quem</TableHead>
                <TableHead className={`${tableHeadClass} text-center`}>Evento</TableHead>
                <TableHead className={tableHeadClass}>Cadastro</TableHead>
                <TableHead className={`${tableHeadClass} text-center`}>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const row = resolveHistoryRow(entry, bootstrap, purged);
                const pending = restoringId === row.entityId;
                return (
                  <TableRow key={row.id}>
                    <TableCell className={`sales-ops-num ${tableCellClass}`}>
                      {formatLedgerTimestampBr(row.ts)}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      {/*
                        Three mutually exclusive branches, and the raw account id is
                        never the primary line in any of them. A Hub account id is
                        forensic data; it may sit under a name, never in place of one.
                      */}
                      {row.actorUserId === 'system' ? (
                        <Badge className={neutralBadgeClass}>Sistema</Badge>
                      ) : row.actorDisplayName ? (
                        <span className="text-[13.5px] text-[#201f24]">
                          {userLabel({ id: row.actorUserId, name: row.actorDisplayName })}
                        </span>
                      ) : (
                        <div className="flex flex-col">
                          <span className="text-[13.5px] text-[#201f24]">
                            Autor não identificado
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {row.actorLabel}
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-center">
                      <Badge
                        className={
                          row.verb === 'restore'
                            ? activeBadgeClass
                            : row.verb === 'purge'
                              ? purgedBadgeClass
                              : neutralBadgeClass
                        }
                      >
                        {row.eventLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="flex flex-col">
                        <span
                          className={
                            row.entityLabelIsId
                              ? 'font-mono text-xs text-muted-foreground'
                              : 'text-sm font-semibold text-[#201f24]'
                          }
                        >
                          {row.entityLabel}
                        </span>
                        <span className="text-xs text-[#8b8b92]">{row.kindLabel}</span>
                        {row.previousLabel ? (
                          <span className="text-xs text-[#9b9ba3]">antes: {row.previousLabel}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-center">
                      {row.restore.state === 'available' ? (
                        <button
                          aria-label={`Restaurar ${row.kindLabel} ${row.entityLabel}`}
                          className={restoreButtonClass}
                          disabled={pending}
                          onClick={() => {
                            if (row.restore.state === 'available') {
                              onRestore(row.restore.target, row);
                            }
                          }}
                          type="button"
                        >
                          {pending ? (
                            <Loader2 className="h-[14px] w-[14px] animate-spin" />
                          ) : (
                            <RotateCcw className="h-[14px] w-[14px]" />
                          )}
                          Restaurar
                        </button>
                      ) : row.restore.state === 'already-active' ? (
                        /*
                          Deliberately NOT a disabled button: a disabled control reads
                          as "temporarily unavailable, try again", which is the wrong
                          story for something that has already happened.
                        */
                        <span className={mutedStateClass}>Já restaurado</span>
                      ) : row.restore.state === 'purged' ? (
                        /*
                          The same muted shape as `Já restaurado`, and for the same
                          reason: the row was hard deleted after 30 days, so a
                          `Restaurar` here would be a guaranteed 404.
                        */
                        <span className={mutedStateClass}>Excluído definitivamente</span>
                      ) : row.restore.state === 'missing' ? (
                        <span className={mutedStateClass}>Registro não encontrado</span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {hasMore ? (
            <p className="border-t border-[#ececf1] px-[22px] py-3 text-[12.5px] text-[#8b8b92]">
              Mostrando os 50 eventos mais recentes.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

type PendingRestore = { target: SetCadastroStatusPayload; row: ResolvedHistoryRow };

/**
 * The container: the read, slice 03's status-only writer and the confirmation.
 *
 * The restore adds NO mutation of its own. `useSetSalesOpsCadastroStatus` already
 * issues a `{ status }`-only PATCH and already invalidates `['sales-ops']`, and a
 * body carrying a cached `name` could silently revert a rename made in another
 * tab. One door, one fact.
 */
export function CadastroHistorySection({ bootstrap }: { bootstrap: SalesOpsBootstrap }) {
  const history = useCadastroHistory();
  const restore = useSetSalesOpsCadastroStatus();
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  function confirm() {
    if (!pending) return;
    setRestoringId(pending.target.id);
    restore.mutate(pending.target, { onSettled: () => setRestoringId(null) });
    setPending(null);
  }

  return (
    <>
      <CadastroHistoryPanel
        bootstrap={bootstrap}
        entries={history.data?.rows ?? []}
        error={history.error}
        hasMore={history.data?.hasMore ?? false}
        isError={history.isError}
        isLoading={history.isLoading}
        onRestore={(target, row) => setPending({ target, row })}
        restoringId={restore.isPending ? restoringId : null}
      />
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        open={pending !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending
                ? `Restaurar ${pending.row.kindLabel} "${pending.row.entityLabel}"?`
                : 'Restaurar cadastro?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending
                ? `${pending.row.entityLabel} volta a aparecer como ativo nas listas e nos seletores. O arquivamento continua registrado aqui: restaurar não apaga o evento anterior, acrescenta um novo.`
                : APPEND_ONLY_SUBTITLE}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>Restaurar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
