import * as React from 'react';
import { Trash2 } from 'lucide-react';
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
import { todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import type { SalesOpsClient, SalesOpsProduct } from '../types';
import type { SalesOpsLead } from './types';
import type { LeadWritePayload } from './api';
import {
  blockedNoticeClass,
  dangerOutlineButtonClass,
  fieldLabelClass,
  formInputClass,
  formSelectClass,
  mutedStateClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './board-ui';
import { clientPickerCopy } from './client-picker-copy';
import { LEAD_DELETE_COPY } from './delete-copy';
import type { FieldDefinition } from './crm-types';
import { LeadFormFields } from './LeadFormFields';
import {
  LEAD_FORM_COPY,
  buildLeadWritePayload,
  fieldIdsWithValue,
  leadFormDraftFromLead,
  leadFormSaveErrorCopy,
  prefillContactFromClient,
  validateLeadFormDraft,
  type FieldDraft,
  type LeadFormDraft,
} from './lead-form';

export type LeadFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null means create. The caller keys the form by lead id (mount-scoped state). */
  initial: SalesOpsLead | null;
  definitions: FieldDefinition[];
  clients: SalesOpsClient[];
  products: SalesOpsProduct[];
  sales?: ComboboxOption[];
  sellers: ComboboxOption[];
  showSellerPicker?: boolean;
  onCreateClient?: (name: string) => Promise<ComboboxOption | null>;
  onSubmit: (payload: LeadWritePayload) => Promise<unknown> | void;
  pending?: boolean;
  /** Create only: the pipeline the board is showing. */
  pipelineId?: string;
  onDelete?: () => void;
};

/** The ONE lead form of both editions. Logic is in lead-form.ts; this file is the view and its state. */
export function LeadForm({
  open,
  onOpenChange,
  initial,
  definitions,
  clients,
  products,
  sales,
  sellers,
  showSellerPicker = true,
  onCreateClient,
  onSubmit,
  pending = false,
  pipelineId,
  onDelete,
}: LeadFormProps) {
  const [draft, setDraft] = React.useState<LeadFormDraft>(() => leadFormDraftFromLead(initial, definitions));
  const [hadValue] = React.useState<ReadonlySet<string>>(() => fieldIdsWithValue(initial));
  // A lead that never had a contact may be saved without one; the form does not force one on it.
  const [contactOptional] = React.useState(() => initial !== null && !initial.contactPhone && !initial.contactEmail);
  const [touched, setTouched] = React.useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [prefilled, setPrefilled] = React.useState(false);

  // The São Paulo civil day, read here (the view) and passed down; the logic modules never read the clock.
  const today = todayInSaoPaulo();
  const problem = validateLeadFormDraft(draft, definitions, { contactOptional, today });
  const showProblem = problem !== null && (submitted || touched.has(problem.field));
  const canCreateClient = Boolean(onCreateClient);
  const clientPlaceholder = clientPickerCopy(canCreateClient);
  const clientOptions = React.useMemo<ComboboxOption[]>(
    () => clients.map((row) => ({ value: row.id, label: row.name })),
    [clients],
  );

  function touch(...fields: string[]) {
    setTouched((current) => {
      const next = new Set(current);
      for (const field of fields) next.add(field);
      return next;
    });
  }

  function patch(changes: Partial<LeadFormDraft>) {
    setDraft((current) => ({ ...current, ...changes }));
  }

  function selectClient(value: string) {
    const picked = clients.find((row) => row.id === value);
    const contact = prefillContactFromClient(draft, picked);
    patch({ clientId: value === '' ? null : value, clientName: picked?.name ?? '', ...contact });
    setPrefilled(Object.keys(contact).length > 0);
  }

  async function createClient(name: string) {
    if (!onCreateClient) return;
    const created = await onCreateClient(name);
    if (!created) return;
    patch({ clientId: created.value, clientName: created.label });
  }

  function setFieldDraft(fieldId: string, next: FieldDraft) {
    touch(`field:${fieldId}`);
    setDraft((current) => ({ ...current, fields: { ...current.fields, [fieldId]: next } }));
  }

  async function save() {
    setSubmitted(true);
    if (problem !== null || submitting) return;
    setSubmitting(true);
    setSaveError(null);
    try {
      await onSubmit(
        buildLeadWritePayload(draft, definitions, {
          ...(initial?.id ? { id: initial.id } : {}),
          includeSeller: showSellerPicker,
          ...(pipelineId ? { pipelineId } : {}),
          hadValue,
          contactOptional,
        }),
      );
    } catch (error: unknown) {
      setSaveError(leadFormSaveErrorCopy(error));
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
          <DialogTitle>{initial?.id ? LEAD_FORM_COPY.editTitle : LEAD_FORM_COPY.createTitle}</DialogTitle>
          <DialogDescription>{LEAD_FORM_COPY.description}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-1.5">
            <label className={fieldLabelClass} htmlFor="lead-contact-name">
              {LEAD_FORM_COPY.nameLabel}
              <span aria-hidden="true"> *</span>
            </label>
            <Input
              className={formInputClass}
              id="lead-contact-name"
              maxLength={140}
              onChange={(event) => {
                touch('contactName');
                patch({ contactName: event.target.value });
              }}
              required
              value={draft.contactName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className={fieldLabelClass} htmlFor="lead-phone">
                  {LEAD_FORM_COPY.phoneLabel}
                </label>
                <Input
                  autoComplete="tel"
                  className={formInputClass}
                  id="lead-phone"
                  inputMode="tel"
                  maxLength={40}
                  onChange={(event) => {
                    touch('contact', 'contactEmail');
                    setPrefilled(false);
                    patch({ contactPhone: event.target.value });
                  }}
                  type="tel"
                  value={draft.contactPhone}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={fieldLabelClass} htmlFor="lead-email">
                  {LEAD_FORM_COPY.emailLabel}
                </label>
                <Input
                  autoComplete="email"
                  className={formInputClass}
                  id="lead-email"
                  maxLength={254}
                  onChange={(event) => {
                    touch('contact', 'contactEmail');
                    setPrefilled(false);
                    patch({ contactEmail: event.target.value });
                  }}
                  type="email"
                  value={draft.contactEmail}
                />
              </div>
            </div>
            <p className={mutedStateClass}>{LEAD_FORM_COPY.contactHint}</p>
            {prefilled ? <p className={mutedStateClass} data-contact-prefilled="">{LEAD_FORM_COPY.contactPrefilled}</p> : null}
          </div>

          <div className="flex flex-col gap-1.5" data-lead-field="cliente" data-field-removable="false">
            <span className={fieldLabelClass} id="lead-client-label">
              {LEAD_FORM_COPY.clientLabel}
            </span>
            <div className="flex items-center gap-2">
              <Combobox
                aria-labelledby="lead-client-label"
                className={formSelectClass}
                entityGender="m"
                entityLabel="cliente"
                onChange={selectClient}
                {...(canCreateClient ? { onCreate: (name: string) => void createClient(name) } : {})}
                options={clientOptions}
                placeholder={clientPlaceholder}
                searchPlaceholder={clientPlaceholder}
                value={draft.clientId}
                valueLabel={draft.clientName || undefined}
              />
              <button className={`${secondaryButtonClass} self-stretch`} onClick={() => selectClient('')} type="button">
                {LEAD_FORM_COPY.clearLabel}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={fieldLabelClass} htmlFor="lead-estimated-value">
              {LEAD_FORM_COPY.valueLabel}
            </label>
            <Input
              className={formInputClass}
              id="lead-estimated-value"
              inputMode="decimal"
              min="0"
              onChange={(event) => patch({ estimatedValue: event.target.value })}
              step="0.01"
              type="number"
              value={draft.estimatedValue}
            />
          </div>

          <LeadFormFields
            definitions={definitions}
            drafts={draft.fields}
            onChange={setFieldDraft}
            products={products}
            {...(sales ? { sales } : {})}
            today={today}
          />

          {showSellerPicker ? (
            <div className="flex flex-col gap-1.5">
              <span className={fieldLabelClass} id="lead-seller-label">
                {LEAD_FORM_COPY.sellerLabel}
              </span>
              {/* No `onCreate`: a pessoa is invalid without a função. */}
              <Combobox
                aria-label={LEAD_FORM_COPY.sellerLabel}
                className={formSelectClass}
                onChange={(value) => patch({ sellerPersonId: value === '' ? null : value })}
                options={sellers}
                placeholder={LEAD_FORM_COPY.sellerPlaceholder}
                value={draft.sellerPersonId}
              />
            </div>
          ) : null}

          {showProblem && problem !== null ? (
            <p className={blockedNoticeClass} data-lead-blocked="true">
              {problem.message}
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
          <button className={secondaryButtonClass} onClick={() => onOpenChange(false)} type="button">
            Cancelar
          </button>
          <button
            className={primaryButtonClass}
            data-lead-save="true"
            disabled={problem !== null || pending || submitting}
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
