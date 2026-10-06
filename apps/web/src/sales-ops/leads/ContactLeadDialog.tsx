import * as React from 'react';
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
  fieldLabelClass,
  formInputClass,
  formSelectClass,
  formTextareaClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './board-ui';
import {
  CONTACT_LEAD_COPY,
  buildContactLeadPayload,
  contactDraftFromSeed,
  validateContactLeadDraft,
  type ContactLeadDraft,
} from './contact-lead';

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
 */

export type ContactLeadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null means create. */
  initial: SaveContactLeadPayload | null;
  /** Pessoas with the vendedor função, resolved by the caller (same list LeadDialog gets). */
  sellers: ComboboxOption[];
  onSubmit: (payload: SaveContactLeadPayload) => void;
  pending?: boolean;
  /** Injected for tests; defaults to todayInSaoPaulo() read once at mount. */
  today?: string;
};

export function ContactLeadDialog({
  open,
  onOpenChange,
  initial,
  sellers,
  onSubmit,
  pending = false,
  today,
}: ContactLeadDialogProps) {
  const [draft, setDraft] = React.useState<ContactLeadDraft>(() => contactDraftFromSeed(initial));
  const [todayDay] = React.useState(() => today ?? todayInSaoPaulo());

  const blocked = validateContactLeadDraft(draft, todayDay);

  function setField<K extends keyof ContactLeadDraft>(key: K, value: ContactLeadDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function save() {
    if (blocked !== null) return;
    onSubmit(buildContactLeadPayload(draft, initial?.id));
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

          <div className="flex flex-col gap-1.5">
            <span className={fieldLabelClass} id="lead-seller-label">
              {CONTACT_LEAD_COPY.sellerLabel}
            </span>
            {/* No `onCreate`: a pessoa is invalid without a função. */}
            <Combobox
              aria-labelledby="lead-seller-label"
              className={formSelectClass}
              onChange={(value) => setField('sellerPersonId', value)}
              options={sellers}
              placeholder={CONTACT_LEAD_COPY.sellerPlaceholder}
              value={draft.sellerPersonId}
            />
          </div>

          {blocked !== null ? (
            <p className={blockedNoticeClass} data-lead-blocked="true">
              {blocked}
            </p>
          ) : null}
        </div>

        <DialogFooter>
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
            disabled={blocked !== null || pending}
            onClick={save}
            type="button"
          >
            Salvar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
