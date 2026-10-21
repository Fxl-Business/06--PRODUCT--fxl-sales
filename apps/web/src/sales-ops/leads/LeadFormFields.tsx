import * as React from 'react';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { isServiceProduct } from '../calculations';
import type { SalesOpsProduct } from '../types';
import {
  chipClass,
  fieldLabelClass,
  formInputClass,
  formSelectClass,
  formTextareaClass,
  mutedStateClass,
  secondaryButtonClass,
} from './board-ui';
import type { FieldDefinition, FieldKind, FieldReferenceTarget } from './crm-types';
import { renderableDefinitions, type FieldDraft } from './lead-form';

/** The dynamic renderers of the one LeadForm. The Cliente is never rendered here (LeadForm owns it). */

export type FieldRendererProps = {
  definition: FieldDefinition;
  draft: FieldDraft | undefined;
  onChange: (next: FieldDraft) => void;
  products: SalesOpsProduct[];
  sales: ComboboxOption[];
};

export type LeadFormFieldsProps = {
  definitions: FieldDefinition[];
  drafts: Record<string, FieldDraft>;
  onChange: (fieldId: string, next: FieldDraft) => void;
  products: SalesOpsProduct[];
  sales?: ComboboxOption[];
};

const EMPTY_SALES: ComboboxOption[] = [];

function textOf(draft: FieldDraft | undefined): string {
  return typeof draft === 'string' ? draft : '';
}

function itemsOf(draft: FieldDraft | undefined): Array<{ id: string | null; name: string }> {
  return Array.isArray(draft) ? draft : [];
}

function TextRenderer({ definition, draft, onChange }: FieldRendererProps) {
  return (
    <textarea
      className={formTextareaClass}
      id={`lead-field-${definition.id}`}
      maxLength={4000}
      onChange={(event) => onChange(event.target.value)}
      value={textOf(draft)}
    />
  );
}

function NumberRenderer({ definition, draft, onChange }: FieldRendererProps) {
  return (
    <Input
      className={formInputClass}
      id={`lead-field-${definition.id}`}
      inputMode="decimal"
      onChange={(event) => onChange(event.target.value)}
      step="any"
      type="number"
      value={textOf(draft)}
    />
  );
}

function MoneyRenderer({ definition, draft, onChange }: FieldRendererProps) {
  return (
    <Input
      className={formInputClass}
      id={`lead-field-${definition.id}`}
      inputMode="decimal"
      min="0"
      onChange={(event) => onChange(event.target.value)}
      step="0.01"
      type="number"
      value={textOf(draft)}
    />
  );
}

function DateRenderer({ definition, draft, onChange }: FieldRendererProps) {
  return (
    <Input
      className={formInputClass}
      id={`lead-field-${definition.id}`}
      onChange={(event) => onChange(event.target.value)}
      type="date"
      value={textOf(draft)}
    />
  );
}

function OptionsRenderer({ definition, draft, onChange }: FieldRendererProps) {
  const current = textOf(draft);
  return (
    <Combobox
      aria-label={definition.label}
      className={formSelectClass}
      id={`lead-field-${definition.id}`}
      onChange={(value) => onChange(value)}
      options={[
        { value: '', label: 'Nenhum' },
        ...(definition.options ?? []).map((option) => ({ value: option.key, label: option.label })),
      ]}
      value={current === '' ? null : current}
    />
  );
}

/** A catalog reference: chips, a catalog picker, and a free-text line. */
function CatalogReferenceField({ definition, draft, onChange, products }: FieldRendererProps) {
  const wantsService = definition.referenceTarget === 'servico';
  const items = itemsOf(draft);
  const chosenIds = new Set(items.map((item) => item.id).filter((id): id is string => id !== null));
  const [pickedId, setPickedId] = React.useState('');
  const [free, setFree] = React.useState('');
  const catalogOptions: ComboboxOption[] = products
    .filter((p) => p.status === 'active' && isServiceProduct(p) === wantsService && !chosenIds.has(p.id))
    .map((p) => ({ value: p.id, label: p.name }));
  const productLabel = new Map(products.map((p) => [p.id, p.name]));

  function add(item: { id: string | null; name: string }) {
    const next = definition.multiple ? [...items, item] : [item];
    onChange(next);
  }

  function addCatalog() {
    if (pickedId === '') return;
    const name = productLabel.get(pickedId) ?? '';
    if (name === '') return;
    add({ id: pickedId, name });
    setPickedId('');
  }

  function addFree() {
    const name = free.trim();
    if (name === '') return;
    add({ id: null, name });
    setFree('');
  }

  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((item, index) => (
            <li className={chipClass} key={`${item.id ?? 'free'}-${index}`}>
              {item.name}
              <button
                aria-label={`Remover ${item.name}`}
                className="ml-1 text-[#8b8b92]"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                type="button"
              >
                x
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2">
        <Combobox
          aria-label={`${definition.label} - catalogo`}
          className={formSelectClass}
          onChange={setPickedId}
          options={catalogOptions}
          placeholder="Selecionar do catálogo"
          searchPlaceholder="Buscar no catálogo..."
          value={pickedId === '' ? null : pickedId}
        />
        <button className={`${secondaryButtonClass} self-stretch`} onClick={addCatalog} type="button">
          Adicionar
        </button>
      </div>
      <div className="flex items-center gap-2">
        <Input
          className={formInputClass}
          id={`lead-field-${definition.id}-free`}
          onChange={(event) => setFree(event.target.value)}
          placeholder="Item livre"
          value={free}
        />
        <button className={`${secondaryButtonClass} shrink-0 self-stretch whitespace-nowrap`} onClick={addFree} type="button">
          + Adicionar item livre
        </button>
      </div>
    </div>
  );
}

/** A contato reference: one name, stored as a free item. */
function ContatoReferenceField({ definition, draft, onChange }: FieldRendererProps) {
  const name = itemsOf(draft)[0]?.name ?? '';
  return (
    <Input
      className={formInputClass}
      id={`lead-field-${definition.id}`}
      onChange={(event) => {
        const next = event.target.value;
        onChange(next.trim() === '' ? [] : [{ id: null, name: next }]);
      }}
      value={name}
    />
  );
}

/** A venda reference: one proposta picked from the org's list. */
function VendaReferenceField({ definition, draft, onChange, sales }: FieldRendererProps) {
  const current = itemsOf(draft)[0]?.id ?? null;
  if (sales.length === 0) return <p className={mutedStateClass}>Nenhuma venda disponível.</p>;
  return (
    <Combobox
      aria-label={definition.label}
      className={formSelectClass}
      id={`lead-field-${definition.id}`}
      onChange={(value) => {
        const picked = sales.find((option) => option.value === value);
        onChange(picked ? [{ id: picked.value, name: picked.label }] : []);
      }}
      options={sales}
      value={current}
    />
  );
}

const REFERENCE_RENDERERS: Record<Exclude<FieldReferenceTarget, 'cliente'>, (props: FieldRendererProps) => React.JSX.Element> = {
  produto: CatalogReferenceField,
  servico: CatalogReferenceField,
  contato: ContatoReferenceField,
  venda: VendaReferenceField,
};

function ReferenceRenderer(props: FieldRendererProps) {
  const target = props.definition.referenceTarget;
  if (target === null || target === 'cliente') return <p className={mutedStateClass}>Campo indisponível.</p>;
  const Renderer = REFERENCE_RENDERERS[target];
  return <Renderer {...props} />;
}

const FIELD_RENDERERS: Record<FieldKind, (props: FieldRendererProps) => React.JSX.Element> = {
  text: TextRenderer,
  number: NumberRenderer,
  money: MoneyRenderer,
  date: DateRenderer,
  options: OptionsRenderer,
  reference: ReferenceRenderer,
};

export function LeadFormFields({ definitions, drafts, onChange, products, sales = EMPTY_SALES }: LeadFormFieldsProps) {
  return (
    <>
      {renderableDefinitions(definitions).map((definition) => {
        const Renderer = FIELD_RENDERERS[definition.kind];
        return (
          <div className="flex flex-col gap-1.5" data-lead-field={definition.key} key={definition.id}>
            <label className={fieldLabelClass} htmlFor={`lead-field-${definition.id}`}>
              {definition.label}
            </label>
            <Renderer
              definition={definition}
              draft={drafts[definition.id]}
              onChange={(next) => onChange(definition.id, next)}
              products={products}
              sales={sales}
            />
          </div>
        );
      })}
    </>
  );
}
