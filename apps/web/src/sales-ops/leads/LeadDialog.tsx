import * as React from 'react';
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
import { parseCurrencyInputToCents } from '../calculations';
import type { SaveLeadPayload, SaveLeadProductPayload } from './api';
import {
  blockedNoticeClass,
  fieldLabelClass,
  formInputClass,
  formSelectClass,
  formTextareaClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './board-ui';

/**
 * Create / edit a lead. PURELY presentational: props in, one `SaveLeadPayload`
 * out.
 *
 * There is NO `Etapa` picker, and that is a reconciliation against the shipped
 * API rather than an omission: `CreateLeadSchema` / `UpdateLeadSchema` are
 * `.strict()` and declare no `stageId`, because a new lead always lands in the
 * first active `kind = 'normal'` stage by position. A card born converted or
 * lost is therefore not expressible at all, rather than merely rejected - so a
 * picker here could only ever offer a value nothing would read.
 */

export type LeadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` means create. On edit the caller maps the lead into a seed payload. */
  initial: SaveLeadPayload | null;
  clients: ComboboxOption[];
  products: ComboboxOption[];
  /**
   * Pessoas carrying the `vendedor` SYSTEM função, already resolved to options by
   * the caller. This slice deliberately does NOT derive it: `hasFuncao` lives in
   * `SalesOpsApp.tsx`, a per-call-site slug comparison is forbidden, and the
   * deprecated `is_seller` mirror must never be read.
   */
  sellers: ComboboxOption[];
  onSubmit: (payload: SaveLeadPayload) => void;
  pending?: boolean;
};

type ProductDraft = { key: string; productId: string | null; label: string };

function seedProducts(
  initial: SaveLeadPayload | null,
  products: ComboboxOption[],
): ProductDraft[] {
  return (initial?.products ?? []).map((row, index) => ({
    key: `seed-${index}`,
    productId: row.productId ?? null,
    label:
      (row.productId
        ? products.find((option) => option.value === row.productId)?.label
        : undefined) ??
      row.productName ??
      'Produto sem nome',
  }));
}

export function LeadDialog({
  open,
  onOpenChange,
  initial,
  clients,
  products,
  sellers,
  onSubmit,
  pending = false,
}: LeadDialogProps) {
  /*
    MOUNT-SCOPED, with no reset effect, for the same reason `MoveLeadDialog` is:
    the caller mounts this dialog only while it is open, so a cancelled edit is
    discarded by the unmount rather than by a reset somebody has to keep in step
    with the field list. Seeding through `useState`'s initializer also means
    `initial` is read exactly once per opening, so a re-render can never throw
    away what the operator has typed.
  */
  const [contactName, setContactName] = React.useState(initial?.contactName ?? '');
  const [clientId, setClientId] = React.useState<string | null>(initial?.clientId ?? null);
  const [companyText, setCompanyText] = React.useState(
    initial?.clientId ? '' : (initial?.clientName ?? ''),
  );
  const [rows, setRows] = React.useState<ProductDraft[]>(() =>
    seedProducts(initial, products),
  );
  const [pickedProductId, setPickedProductId] = React.useState<string | null>(null);
  const [freeProductName, setFreeProductName] = React.useState('');
  const [estimatedInput, setEstimatedInput] = React.useState(
    initial?.estimatedValueBrl ? (initial.estimatedValueBrl / 100).toFixed(2) : '',
  );
  const [description, setDescription] = React.useState(initial?.description ?? '');
  const [sellerPersonId, setSellerPersonId] = React.useState<string | null>(
    initial?.sellerPersonId ?? null,
  );

  const clientLabel = clients.find((option) => option.value === clientId)?.label ?? '';
  const resolvedCompanyName = clientId ? clientLabel : companyText.trim();

  const availableProducts = products.filter(
    (option) => !rows.some((row) => row.productId === option.value),
  );

  const blocked =
    contactName.trim() === ''
      ? 'Informe o nome do contato.'
      : resolvedCompanyName === ''
        ? 'Informe a empresa, escolhendo um cliente ou digitando o nome.'
        : null;

  function addCatalogProduct() {
    if (!pickedProductId) return;
    const option = products.find((row) => row.value === pickedProductId);
    if (!option) return;
    setRows((current) => [
      ...current,
      { key: `catalog-${option.value}`, productId: option.value, label: option.label },
    ]);
    setPickedProductId(null);
  }

  function addFreeProduct() {
    const name = freeProductName.trim();
    if (name === '') return;
    setRows((current) => [
      ...current,
      { key: `free-${current.length}-${name}`, productId: null, label: name },
    ]);
    setFreeProductName('');
  }

  function save() {
    if (blocked !== null) return;
    const payloadProducts: SaveLeadProductPayload[] = rows.map((row) =>
      row.productId ? { productId: row.productId } : { productName: row.label },
    );
    onSubmit({
      ...(initial?.id ? { id: initial.id } : {}),
      contactName: contactName.trim(),
      clientId,
      clientName: resolvedCompanyName,
      estimatedValueBrl: parseCurrencyInputToCents(estimatedInput),
      description: description.trim() === '' ? null : description.trim(),
      sellerPersonId,
      products: payloadProducts,
    });
    onOpenChange(false);
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial?.id ? 'Editar lead' : 'Novo lead'}</DialogTitle>
          <DialogDescription>
            Um lead é uma negociação em andamento; os números aqui são estimativas.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-1.5">
            <label className={fieldLabelClass} htmlFor="lead-contact-name">
              Nome do contato
            </label>
            <Input
              className={formInputClass}
              id="lead-contact-name"
              onChange={(event) => setContactName(event.target.value)}
              value={contactName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={fieldLabelClass} id="lead-client-label">
              Empresa (cliente cadastrado)
            </span>
            {/*
              No `onCreate`: a lead never creates a `sales_ops_clients` row. The
              resolve-or-create happens at conversion time, inside the proposta
              flow, where the record is complete enough to be worth persisting.
            */}
            <div className="flex items-center gap-2">
              <Combobox
                aria-labelledby="lead-client-label"
                className={formSelectClass}
                onChange={(value) => {
                  setClientId(value);
                  setCompanyText('');
                }}
                options={clients}
                placeholder="Selecione o cliente"
                value={clientId}
              />
              <button
                className={secondaryButtonClass}
                onClick={() => setClientId(null)}
                type="button"
              >
                Limpar
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={fieldLabelClass} htmlFor="lead-company-text">
              Empresa (texto livre)
            </label>
            <Input
              className={formInputClass}
              disabled={clientId !== null}
              id="lead-company-text"
              onChange={(event) => setCompanyText(event.target.value)}
              value={clientId !== null ? clientLabel : companyText}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={fieldLabelClass} id="lead-products-label">
              Produtos em negociação
            </span>
            <div className="flex items-center gap-2">
              <Combobox
                aria-labelledby="lead-products-label"
                className={formSelectClass}
                onChange={(value) => setPickedProductId(value)}
                options={availableProducts}
                placeholder="Selecione o produto"
                value={pickedProductId}
              />
              <button className={secondaryButtonClass} onClick={addCatalogProduct} type="button">
                Adicionar
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={fieldLabelClass} htmlFor="lead-free-product">
                Produto não cadastrado
              </label>
              {/*
                Deliberately not the `Combobox`'s create row, whose copy promises a
                catalog row this never creates. A free line is a snapshot with no
                `productId`, exactly as a free sale item is.
              */}
              <div className="flex items-center gap-2">
                <Input
                  className={formInputClass}
                  id="lead-free-product"
                  onChange={(event) => setFreeProductName(event.target.value)}
                  value={freeProductName}
                />
                <button className={secondaryButtonClass} onClick={addFreeProduct} type="button">
                  + Adicionar item livre
                </button>
              </div>
            </div>

            {rows.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {rows.map((row, index) => (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-[#f4f4f6] px-2 py-0.5 text-[12px] text-[#57575f]"
                    key={row.key}
                  >
                    {row.label}
                    <button
                      aria-label={`Remover ${row.label}`}
                      className="text-[#8b8b92]"
                      onClick={() =>
                        setRows((current) => current.filter((_, other) => other !== index))
                      }
                      type="button"
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={fieldLabelClass} htmlFor="lead-estimated-value">
              Valor estimado (R$)
            </label>
            <Input
              className={formInputClass}
              id="lead-estimated-value"
              min="0"
              onChange={(event) => setEstimatedInput(event.target.value)}
              step="0.01"
              type="number"
              value={estimatedInput}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={fieldLabelClass} htmlFor="lead-description">
              Descrição
            </label>
            <textarea
              className={formTextareaClass}
              id="lead-description"
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={fieldLabelClass} id="lead-seller-label">
              Vendedor responsável
            </span>
            {/* No `onCreate`: a pessoa is invalid without a função. */}
            <Combobox
              aria-labelledby="lead-seller-label"
              className={formSelectClass}
              onChange={(value) => setSellerPersonId(value)}
              options={sellers}
              placeholder="Selecione o vendedor"
              value={sellerPersonId}
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
