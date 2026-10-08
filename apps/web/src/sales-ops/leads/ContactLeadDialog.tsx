import * as React from 'react';
import { Trash2 } from 'lucide-react';
import { todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { SaveContactLeadPayload } from './api';
import {
  blockedNoticeClass,
  dangerOutlineButtonClass,
  fieldLabelClass,
  formInputClass,
  formSelectClass,
  formTextareaClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './board-ui';
import { clientPickerCopy } from './client-picker-copy';
import {
  CONTACT_LEAD_COPY,
  buildContactLeadPayload,
  contactDraftFromSeed,
  contactLeadSaveErrorCopy,
  validateContactLeadDraft,
  type ContactLeadDraft,
} from './contact-lead';
import { LEAD_DELETE_COPY } from './delete-copy';

/**
 * Create / edit a lead in the leads edition. PURELY presentational: props in,
 * one six-key `SaveContactLeadPayload` out.
 *
 * A separate component on purpose, so the full edition's `LeadDialog` stays
 * byte-identical. Like `LeadDialog` there is no Etapa picker: a new lead always
 * lands in the first active normal etapa.
 *
 * State is MOUNT-SCOPED (the caller keys it by the seed), so there is no reset
 * effect to race the operator's typing.
 *
 * The dialog closes only once `onSubmit`'s promise resolves. A rejection keeps
 * it open with every typed value and renders the mapped error inline
 * (D-07.1c), so a refused save never throws the operator's work away.
 */

export type ContactLeadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null means create. */
  initial: SaveContactLeadPayload | null;
  /** Pessoas with the vendedor função, resolved by the caller (same list LeadDialog gets). */
  sellers: ComboboxOption[];
  /**
   * False hides the Vendedor field and omits `sellerPersonId` from the payload
   * (a non-admin viewer, D-07.1b). Defaults to true.
   */
  showSellerPicker?: boolean;
  /** Client cadastro options for the empresa picker. */
  clients?: ComboboxOption[];
  /**
   * Create a client by name inline. Resolves the created option, or null when it
   * could not be created. Absent means the picker still selects, but the Criar
   * row is not offered.
   */
  onCreateClient?: (name: string) => Promise<ComboboxOption | null>;
  /** The dialog awaits it: resolve closes, reject keeps it open with an inline error. */
  onSubmit: (payload: SaveContactLeadPayload) => Promise<unknown> | void;
  pending?: boolean;
  /** Injected for tests; defaults to todayInSaoPaulo() read once at mount. */
  today?: string;
  /**
   * Asks for this lead's delete confirmation (the container's shared
   * `LeadDeleteDialog`). Rendered only when editing (`initial.id`); the container
   * withholds it for a converted lead.
   */
  onDelete?: () => void;
};

function blockedFieldOf(message: string | null): keyof ContactLeadDraft | null {
  if (message === CONTACT_LEAD_COPY.nameRequired) return 'contactName';
  if (
    message === CONTACT_LEAD_COPY.birthDateInvalid ||
    message === CONTACT_LEAD_COPY.birthDateFuture
  ) {
    return 'contactBirthDate';
  }
  if (message === CONTACT_LEAD_COPY.emailInvalid) return 'contactEmail';
  return null;
}

export function ContactLeadDialog({
  open,
  onOpenChange,
  initial,
  sellers,
  showSellerPicker = true,
  clients = [],
  onCreateClient,
  onSubmit,
  pending = false,
  today,
  onDelete,
}: ContactLeadDialogProps) {
  const [draft, setDraft] = React.useState<ContactLeadDraft>(() => contactDraftFromSeed(initial));
  const [todayDay] = React.useState(() => today ?? todayInSaoPaulo());
  const [submitting, setSubmitting] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const [touched, setTouched] = React.useState<ReadonlySet<keyof ContactLeadDraft>>(new Set());
  const [submitted, setSubmitted] = React.useState(false);

  const blocked = validateContactLeadDraft(draft, todayDay);
  // The message is shown only once the field it belongs to changed, or after Salvar.
  const blockedField = blockedFieldOf(blocked);
  const showBlocked =
    blocked !== null && (submitted || (blockedField !== null && touched.has(blockedField)));
  // One boolean drives both the create row and the copy, so the picker never
  // promises a creation it cannot perform.
  const canCreateClient = Boolean(onCreateClient);
  const clientPickerText = clientPickerCopy(canCreateClient);

  function setField<K extends keyof ContactLeadDraft>(key: K, value: ContactLeadDraft[K]) {
    setTouched((current) => (current.has(key) ? current : new Set(current).add(key)));
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function selectClient(value: string) {
    const picked = clients.find((option) => option.value === value);
    setField('clientId', value === '' ? null : value);
    setField('clientName', picked?.label ?? '');
  }

  async function createClient(name: string) {
    if (!onCreateClient) {
      // No create permission: keep the typed name as a free-text snapshot.
      setField('clientId', null);
      setField('clientName', name);
      return;
    }
    const created = await onCreateClient(name);
    if (!created) return;
    setField('clientId', created.value);
    setField('clientName', created.label);
  }

  async function save() {
    setSubmitted(true);
    if (blocked !== null || submitting) return;
    setSubmitting(true);
    setSaveError(null);
    try {
      await onSubmit(
        buildContactLeadPayload(draft, initial?.id, { includeSeller: showSellerPicker }),
      );
    } catch (error: unknown) {
      setSaveError(contactLeadSaveErrorCopy(error));
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    onOpenChange(false);
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial?.id ? 'Editar lead' : 'Novo lead'}</DialogTitle>
          <DialogDescription>{CONTACT_LEAD_COPY.dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-1.5">
            <label className={fieldLabelClass} htmlFor="lead-contact-name">
              {CONTACT_LEAD_COPY.nameLabel}
              <span aria-hidden="true"> *</span>
            </label>
            <Input
              className={formInputClass}
              id="lead-contact-name"
              maxLength={140}
              onChange={(event) => setField('contactName', event.target.value)}
              required
              value={draft.contactName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={fieldLabelClass} id="lead-client-label">
              {CONTACT_LEAD_COPY.clientLabel}
            </span>
            <div className="flex items-center gap-2">
              <Combobox
                aria-labelledby="lead-client-label"
                className={formSelectClass}
                entityGender="m"
                entityLabel="cliente"
                onChange={selectClient}
                {...(canCreateClient ? { onCreate: (name) => void createClient(name) } : {})}
                options={clients}
                placeholder={clientPickerText}
                searchPlaceholder={clientPickerText}
                value={draft.clientId}
                valueLabel={draft.clientName || undefined}
              />
              <button
                className={`${secondaryButtonClass} self-stretch`}
                onClick={() => selectClient('')}
                type="button"
              >
                {CONTACT_LEAD_COPY.clearLabel}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={fieldLabelClass} htmlFor="lead-estimated-value">
              {CONTACT_LEAD_COPY.valueLabel}
            </label>
            <Input
              className={formInputClass}
              id="lead-estimated-value"
              inputMode="decimal"
              min="0"
              onChange={(event) => setField('estimatedValue', event.target.value)}
              step="0.01"
              type="number"
              value={draft.estimatedValue}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={fieldLabelClass} htmlFor="lead-birth-date">
              {CONTACT_LEAD_COPY.birthDateLabel}
            </label>
            <Input
              className={formInputClass}
              id="lead-birth-date"
              max={todayDay}
              onChange={(event) => setField('contactBirthDate', event.target.value)}
              type="date"
              value={draft.contactBirthDate}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={fieldLabelClass} htmlFor="lead-phone">
              {CONTACT_LEAD_COPY.phoneLabel}
            </label>
            <Input
              autoComplete="tel"
              className={formInputClass}
              id="lead-phone"
              inputMode="tel"
              maxLength={40}
              onChange={(event) => setField('contactPhone', event.target.value)}
              type="tel"
              value={draft.contactPhone}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={fieldLabelClass} htmlFor="lead-email">
              {CONTACT_LEAD_COPY.emailLabel}
            </label>
            <Input
              autoComplete="email"
              className={formInputClass}
              id="lead-email"
              maxLength={254}
              onChange={(event) => setField('contactEmail', event.target.value)}
              type="email"
              value={draft.contactEmail}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={fieldLabelClass} htmlFor="lead-description">
              {CONTACT_LEAD_COPY.descriptionLabel}
            </label>
            <textarea
              className={formTextareaClass}
              id="lead-description"
              maxLength={4000}
              onChange={(event) => setField('description', event.target.value)}
              value={draft.description}
            />
          </div>

          {showSellerPicker ? (
            <div className="flex flex-col gap-1.5">
              <span className={fieldLabelClass} id="lead-seller-label">
                {CONTACT_LEAD_COPY.sellerLabel}
              </span>
              {/* No `onCreate`: a pessoa is invalid without a função. */}
              <Combobox
                aria-label={CONTACT_LEAD_COPY.sellerLabel}
                className={formSelectClass}
                onChange={(value) => setField('sellerPersonId', value)}
                options={sellers}
                placeholder={CONTACT_LEAD_COPY.sellerPlaceholder}
                value={draft.sellerPersonId}
              />
            </div>
          ) : null}

          {showBlocked ? (
            <p className={blockedNoticeClass} data-lead-blocked="true">
              {blocked}
            </p>
          ) : null}

          {saveError !== null ? (
            <p className={blockedNoticeClass} data-lead-save-error="true" role="alert">
              {saveError}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {initial?.id && onDelete ? (
            <button
              className={`${dangerOutlineButtonClass} sm:mr-auto`}
              data-delete-lead-form=""
              disabled={submitting}
              onClick={onDelete}
              type="button"
            >
              <Trash2 aria-hidden className="h-[15px] w-[15px]" />
              {LEAD_DELETE_COPY.formButton}
            </button>
          ) : null}
          <button
            className={secondaryButtonClass}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            Cancelar
          </button>
          <button
            className={primaryButtonClass}
            data-lead-save="true"
            disabled={blocked !== null || pending || submitting}
            onClick={() => {
              void save();
            }}
            type="button"
          >
            Salvar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
