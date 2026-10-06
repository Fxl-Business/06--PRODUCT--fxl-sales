import { Archive, Edit3, Loader2, RotateCcw, Save } from 'lucide-react';
import { useState, type FormEvent } from 'react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { SavePersonPayload } from '../api';
import { isOptimisticId } from '../optimistic';
import type { SalesOpsFuncao, SalesOpsPerson } from '../types';
import { VENDEDORES_COPY, buildVendedorPayload } from './vendedores';

/*
  Intentional local copies of the SalesOpsApp.tsx style constants, as in
  CadastroHistoryPanel.tsx: the shell depends on this module, so reading them back
  from it would be a cycle.
*/
const panelClass = 'rounded-[18px] border border-[#e8e8ec] bg-white';
const mutedPanelClass = 'rounded-[18px] border border-[#e8e8ec] bg-[#fbfbfc]';
const tableHeadClass =
  'px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]';
const tableCellClass = 'px-4 py-3 text-[13.5px] text-[#57575f]';
/** `tableCellClass` with the muted text colour of an inactive row. */
const mutedCellClass = 'px-4 py-3 text-[13.5px] text-[#9b9ba3]';
const iconButtonBaseClass =
  'inline-flex h-8 w-8 items-center justify-center rounded-[9px] border transition';
const iconButtonClass = `${iconButtonBaseClass} border-[#dcdce2] bg-white text-[#57575f] hover:border-[#eaa81a] hover:bg-[#f5f2ea] hover:text-[#9c7210]`;
const iconButtonPendingClass = `${iconButtonBaseClass} cursor-not-allowed border-[#ececf1] bg-[#f6f6f8] text-[#b6b6bd]`;
const primaryButtonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-[11px] bg-[#201f24] px-4 py-2 text-[13.5px] font-bold text-white transition hover:bg-[#33333a] disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButtonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-[11px] border border-[#dcdce2] bg-white px-4 py-2 text-[13.5px] font-semibold text-[#57575f] transition hover:bg-[#f2f2f4] disabled:cursor-not-allowed disabled:opacity-60';

/**
 * The leads-edition people cadastro. Every pessoa is listed without a função filter:
 * in this edition the server makes every pessoa a vendedor, and a filter would hide a
 * just-created optimistic row whenever the catalogue had no vendedor yet.
 * Inactive vendedores are listed last with `Reativar` (SEAM A4), because Geral and
 * `GET /history` are gated off in this edition and this is the only restore path.
 */
export function VendedoresView(props: {
  people: readonly SalesOpsPerson[];
  onEdit: (person: SalesOpsPerson) => void;
  onInactivate: (person: SalesOpsPerson) => void;
  /** SEAM A4: a status-only PATCH back to 'active'. Geral and GET /history are gated off in this edition. */
  onReactivate: (person: SalesOpsPerson) => void;
}) {
  // Above the early return: `react-hooks/rules-of-hooks` fails lint otherwise.
  const [pending, setPending] = useState<SalesOpsPerson | null>(null);
  const active = props.people.filter((person) => person.status === 'active');
  const inactive = props.people.filter((person) => person.status !== 'active');
  const listed = [...active, ...inactive];

  if (listed.length === 0) {
    return (
      <div
        className={`${mutedPanelClass} flex min-h-[154px] flex-col items-center justify-center gap-2 p-6 text-center`}
        data-vendedores-empty
      >
        <div className="text-sm font-bold text-[#201f24]">{VENDEDORES_COPY.emptyTitle}</div>
        <div className="max-w-[420px] text-[13px] leading-5 text-[#8b8b92]">
          {VENDEDORES_COPY.emptyText}
        </div>
      </div>
    );
  }

  return (
    <div className={`${panelClass} overflow-hidden`} data-vendedores-view>
      <Table>
        <TableHeader>
          <TableRow className="bg-[#fafafb] hover:bg-[#fafafb]">
            {/*
              Fixed widths: with the auto layout the columns jumped sideways whenever
              an `Inativo` badge appeared or disappeared.
            */}
            <TableHead className={`${tableHeadClass} w-[40%]`}>Nome</TableHead>
            <TableHead className={tableHeadClass}>E-mail</TableHead>
            <TableHead className={`${tableHeadClass} w-[140px] text-center`}>Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {listed.map((person) => {
            const name = person.displayName;
            const email = person.contactEmail ?? <span className="text-[#b6b6bd]">-</span>;
            if (person.status !== 'active') {
              return (
                /*
                  Muted through the TEXT colour, never a row opacity: an opacity also
                  fades the Reativar button until it reads as disabled.
                */
                <TableRow data-vendedor-inactive key={person.id}>
                  <TableCell className="px-4 py-3 text-sm font-semibold text-[#9b9ba3]">
                    {name}
                    <span
                      className="ml-2 inline-flex items-center rounded-full bg-[#eeeef1] px-2 py-0.5 align-middle text-[11px] font-semibold text-[#6a6a72]"
                      data-vendedor-status-badge
                    >
                      {VENDEDORES_COPY.inactiveBadge}
                    </span>
                  </TableCell>
                  <TableCell className={mutedCellClass}>{email}</TableCell>
                  <TableCell className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {/* No confirmation: a restore loses nothing. No Editar on an inactive row. */}
                      <button
                        aria-label={VENDEDORES_COPY.reactivateLabel(name)}
                        className={iconButtonClass}
                        onClick={() => props.onReactivate(person)}
                        title="Reativar"
                        type="button"
                      >
                        <RotateCcw className="h-[15px] w-[15px]" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            }
            const optimistic = isOptimisticId(person.id);
            return (
              <TableRow key={person.id}>
                <TableCell className="px-4 py-3 text-sm font-semibold">{name}</TableCell>
                <TableCell className={tableCellClass}>{email}</TableCell>
                <TableCell className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <button
                      aria-label={
                        optimistic
                          ? VENDEDORES_COPY.savingLabel(name)
                          : VENDEDORES_COPY.editLabel(name)
                      }
                      className={optimistic ? iconButtonPendingClass : iconButtonClass}
                      disabled={optimistic}
                      onClick={() => props.onEdit(person)}
                      title={optimistic ? 'Salvando...' : 'Editar'}
                      type="button"
                    >
                      <Edit3 className="h-[15px] w-[15px]" />
                    </button>
                    <button
                      aria-label={VENDEDORES_COPY.inactivateLabel(name)}
                      className={optimistic ? iconButtonPendingClass : iconButtonClass}
                      disabled={optimistic}
                      onClick={() => setPending(person)}
                      title="Inativar"
                      type="button"
                    >
                      <Archive className="h-[15px] w-[15px]" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {/*
        The body points to this same screen for a restore, never to Geral or the
        history: the leads edition has no Geral screen and `GET /history` is gated.
      */}
      <AlertDialog
        onOpenChange={(open) => (!open ? setPending(null) : undefined)}
        open={pending !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending ? VENDEDORES_COPY.inactivateTitle(pending.displayName) : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>{VENDEDORES_COPY.inactivateBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{VENDEDORES_COPY.inactivateBack}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) props.onInactivate(pending);
                setPending(null);
              }}
            >
              {VENDEDORES_COPY.inactivateAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type VendedorDialogProps = {
  open: boolean;
  person: SalesOpsPerson | null;
  funcoes: readonly SalesOpsFuncao[];
  onClose: () => void;
  onSave: (payload: SavePersonPayload) => void;
  saving: boolean;
};

/**
 * The leads-edition person dialog: Nome and E-mail only. Remounted per record, the
 * same pattern as `PersonDialog`. It holds no Combobox and no InfoHint, so there is no
 * inline layer to register.
 */
export function VendedorDialog({ open, ...props }: VendedorDialogProps) {
  if (!open) return null;
  return <VendedorDialogBody key={props.person?.id ?? 'new-vendedor'} {...props} />;
}

function VendedorDialogBody({
  person,
  funcoes,
  onClose,
  onSave,
  saving,
}: Omit<VendedorDialogProps, 'open'>) {
  const [displayName, setDisplayName] = useState(person?.displayName ?? '');
  const [contactEmail, setContactEmail] = useState(person?.contactEmail ?? '');
  // The whole gate: no função check, the client-side `funcao_required` bypass for this edition.
  const canSave = !saving && displayName.trim().length > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!displayName.trim()) return;
    onSave(buildVendedorPayload({ person, displayName, contactEmail, funcoes }));
  }

  return (
    <Dialog onOpenChange={(next) => (!next ? onClose() : undefined)} open>
      <DialogContent className="max-w-[520px] rounded-[20px] border-none bg-white p-0">
        <DialogHeader className="border-b border-[#e8e8ec] px-6 py-5 text-left">
          <DialogTitle className="sales-ops-num text-[19px]">
            {VENDEDORES_COPY.dialogTitle}
          </DialogTitle>
          <DialogDescription>{VENDEDORES_COPY.dialogDescription}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4 px-6 py-5" data-vendedor-form onSubmit={submit}>
          <label className="flex flex-col gap-[6px]">
            <span className="text-xs font-semibold text-[#8b8b92]">
              {VENDEDORES_COPY.nameLabel}
              <span className="text-[#b23a22]"> *</span>
            </span>
            <Input
              className="bg-[#fafafb]"
              name="displayName"
              onChange={(event) => setDisplayName(event.target.value)}
              value={displayName}
            />
          </label>
          <label className="flex flex-col gap-[6px]">
            <span className="text-xs font-semibold text-[#8b8b92]">
              {VENDEDORES_COPY.emailLabel}
            </span>
            <Input
              aria-describedby="vendedor-email-helper"
              className="bg-[#fafafb]"
              name="contactEmail"
              onChange={(event) => setContactEmail(event.target.value)}
              type="email"
              value={contactEmail}
            />
            <span className="text-[12.5px] text-[#8b8b92]" id="vendedor-email-helper">
              {VENDEDORES_COPY.emailHelper}
            </span>
          </label>
          <div className="flex justify-end gap-3 border-t border-[#e8e8ec] pt-4">
            <button className={secondaryButtonClass} onClick={onClose} type="button">
              {VENDEDORES_COPY.cancel}
            </button>
            <button className={primaryButtonClass} disabled={!canSave} type="submit">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {VENDEDORES_COPY.save}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
