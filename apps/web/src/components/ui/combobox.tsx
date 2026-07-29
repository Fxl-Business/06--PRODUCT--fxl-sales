import * as React from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildComboboxFilter,
  createRowLabel,
  shouldShowCreateRow,
  type ComboboxOption,
} from './combobox-filter';

export type { ComboboxOption };

export type ComboboxProps = {
  /** Options in preferred order. Rendering order is derived by buildComboboxFilter. */
  options: ComboboxOption[];
  /** Controlled value. null or '' means nothing selected. */
  value: string | null;
  /** Fired with the chosen option's `value`. Never fired for the create row. */
  onChange: (value: string) => void;

  /**
   * When provided, the create row is offered. Receives the trimmed query.
   * The primitive does NOT mutate `value` on create; the caller decides what to do.
   */
  onCreate?: (query: string) => void;
  /** Noun for the create row, e.g. 'contato', 'cliente'. Default 'item'. */
  entityLabel?: string;
  /** pt-BR gender agreement for the create row: 'm' -> "novo", 'f' -> "nova". Default 'm'. */
  entityGender?: 'm' | 'f';

  /** Trigger id. Point a `<Label htmlFor>` at it. Falls back to React.useId(). */
  id?: string;
  /** Trigger text when nothing is selected. Default 'Selecionar...'. */
  placeholder?: string;
  /** Trigger text when `value` matches no option, e.g. a freshly typed name not yet in the list. */
  valueLabel?: string;
  /** Search field placeholder and its aria-label. Default 'Buscar...'. */
  searchPlaceholder?: string;
  /** Shown when nothing matches and no create row is offered. */
  emptyMessage?: string;

  disabled?: boolean;
  /** Merged onto the trigger through `cn`, so sales-ops can pass formInputClass / formSelectClass. */
  className?: string;
  /** Merged onto the floating panel through `cn`. */
  panelClassName?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
};

/**
 * Single-select searchable combobox.
 *
 * The panel is inline, non-portalled and absolutely positioned inside the
 * component's own `relative` wrapper. That is deliberate: it keeps the whole
 * control reachable from a plain DOM query, both for assistive tech and for the
 * test harness, and it avoids pulling in a popover dependency.
 */
export const Combobox = React.forwardRef<HTMLButtonElement, ComboboxProps>(
  (
    {
      options,
      value,
      onChange,
      onCreate,
      entityLabel = 'item',
      entityGender = 'm',
      id,
      placeholder = 'Selecionar...',
      valueLabel,
      searchPlaceholder = 'Buscar...',
      emptyMessage = 'Nenhum resultado encontrado.',
      disabled = false,
      className,
      panelClassName,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      'aria-describedby': ariaDescribedBy,
    },
    forwardedRef,
  ) => {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [activeIndex, setActiveIndex] = React.useState(0);

    const wrapperRef = React.useRef<HTMLDivElement | null>(null);
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);
    const searchRef = React.useRef<HTMLInputElement | null>(null);
    const panelRef = React.useRef<HTMLDivElement | null>(null);

    const setTriggerRef = React.useCallback(
      (node: HTMLButtonElement | null) => {
        triggerRef.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    const { groups, filtered } = React.useMemo(
      () => buildComboboxFilter(options, query),
      [options, query],
    );
    const showCreate = React.useMemo(
      () => shouldShowCreateRow(options, query, Boolean(onCreate)),
      [options, query, onCreate],
    );

    const createIndex = filtered.length;
    const navigableCount = filtered.length + (showCreate ? 1 : 0);
    const activeRow = navigableCount === 0 ? 0 : Math.min(activeIndex, navigableCount - 1);
    const createIsActive = showCreate && activeRow === createIndex;

    const reactId = React.useId();
    const baseId = id ?? reactId;
    const listboxId = `${baseId}-listbox`;
    const searchId = `${baseId}-search`;
    const createId = `${baseId}-create`;
    const optionId = (index: number) => `${baseId}-option-${index}`;

    const activeDescendantId =
      navigableCount === 0 ? undefined : createIsActive ? createId : optionId(activeRow);

    // Focus the search field as soon as the panel mounts.
    React.useLayoutEffect(() => {
      if (open) searchRef.current?.focus();
    }, [open]);

    // Outside dismissal. `mousedown` rather than `pointerdown` so this never
    // races Radix's own pointerdown dismissal machinery in a surrounding Dialog.
    React.useEffect(() => {
      if (!open) return;
      const handleDocumentMouseDown = (event: MouseEvent) => {
        const target = event.target;
        if (target instanceof Node && wrapperRef.current?.contains(target)) return;
        setOpen(false);
      };
      document.addEventListener('mousedown', handleDocumentMouseDown);
      return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
    }, [open]);

    // Keep the active row in view. happy-dom does not implement scrollIntoView.
    React.useEffect(() => {
      if (!open) return;
      const node = panelRef.current?.querySelector('[data-active="true"]');
      if (node instanceof HTMLElement) node.scrollIntoView?.({ block: 'nearest' });
    }, [open, activeRow]);

    function openPanel() {
      if (disabled) return;
      setQuery('');
      const initial = buildComboboxFilter(options, '').filtered;
      const selectedIndex = initial.findIndex((option) => option.value === value);
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
      setOpen(true);
    }

    function closePanel(focusTrigger: boolean) {
      setOpen(false);
      if (focusTrigger) triggerRef.current?.focus();
    }

    function commitOption(option: ComboboxOption) {
      onChange(option.value);
      closePanel(true);
    }

    function commitCreate() {
      onCreate?.(query.trim());
      closePanel(true);
    }

    function commitActiveRow() {
      if (navigableCount === 0) return;
      if (createIsActive) {
        commitCreate();
        return;
      }
      const option = filtered[activeRow];
      if (option) commitOption(option);
    }

    function moveActive(delta: number) {
      if (navigableCount === 0) return;
      setActiveIndex((current) => {
        const from = Math.min(current, navigableCount - 1);
        return (from + delta + navigableCount) % navigableCount;
      });
    }

    function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
      if (disabled) return;
      if (
        event.key === 'Enter' ||
        event.key === ' ' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp'
      ) {
        event.preventDefault();
        openPanel();
      }
    }

    function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          moveActive(1);
          return;
        case 'ArrowUp':
          event.preventDefault();
          moveActive(-1);
          return;
        case 'Enter':
          // Unconditional, so a surrounding <form> never submits on Enter.
          event.preventDefault();
          commitActiveRow();
          return;
        case 'Escape':
          // All three together, so Escape closes only the combobox and not a
          // surrounding Radix Dialog.
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
          closePanel(true);
          return;
        case 'Tab':
          // No preventDefault: focus moves on naturally.
          closePanel(false);
          return;
        default:
          return;
      }
    }

    function handleQueryChange(event: React.ChangeEvent<HTMLInputElement>) {
      setQuery(event.target.value);
      setActiveIndex(0);
    }

    const selectedOption = options.find((option) => option.value === value);
    const resolvedLabel = selectedOption?.label ?? (valueLabel ? valueLabel : undefined);
    const triggerText = resolvedLabel ?? placeholder;

    let renderIndex = 0;
    const groupNodes = groups.map((group, groupIndex) => {
      const headingId = `${baseId}-group-${groupIndex}`;
      const rows = group.options.map((option) => {
        const index = renderIndex;
        renderIndex += 1;
        const isActive = index === activeRow && !createIsActive;
        return (
          <div
            aria-selected={option.value === value}
            className={cn(
              'flex cursor-pointer select-none flex-col gap-0.5 rounded-sm px-2 py-1.5 text-sm outline-none',
              isActive && 'bg-accent text-accent-foreground',
            )}
            id={optionId(index)}
            key={`${option.value}-${index}`}
            onClick={() => commitOption(option)}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => setActiveIndex(index)}
            role="option"
            {...(isActive ? { 'data-active': 'true' } : {})}
          >
            <span className="line-clamp-1 font-medium">{option.label}</span>
            {option.description ? (
              <span className="line-clamp-1 text-xs text-muted-foreground">
                {option.description}
              </span>
            ) : null}
          </div>
        );
      });

      if (group.label === null) return <React.Fragment key={group.key}>{rows}</React.Fragment>;

      return (
        <div aria-labelledby={headingId} key={group.key} role="group">
          <div
            className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
            id={headingId}
          >
            {group.label}
          </div>
          {rows}
        </div>
      );
    });

    return (
      <div className="relative w-full" ref={wrapperRef}>
        <button
          aria-controls={open ? listboxId : undefined}
          aria-describedby={ariaDescribedBy}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          className={cn(
            'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground [&>span]:line-clamp-1',
            className,
          )}
          disabled={disabled}
          id={baseId}
          onClick={() => (open ? closePanel(true) : openPanel())}
          onKeyDown={handleTriggerKeyDown}
          ref={setTriggerRef}
          role="combobox"
          type="button"
          {...(resolvedLabel === undefined ? { 'data-placeholder': '' } : {})}
        >
          <span>{triggerText}</span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 opacity-50" />
        </button>

        {open ? (
          <div
            className={cn(
              'absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-background text-foreground shadow-md',
              panelClassName,
            )}
            ref={panelRef}
          >
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                aria-activedescendant={activeDescendantId}
                aria-autocomplete="list"
                aria-controls={listboxId}
                aria-label={searchPlaceholder}
                className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                id={searchId}
                onChange={handleQueryChange}
                onKeyDown={handleSearchKeyDown}
                placeholder={searchPlaceholder}
                ref={searchRef}
                type="text"
                value={query}
              />
            </div>

            <div
              aria-labelledby={baseId}
              className="flex max-h-72 flex-col"
              id={listboxId}
              role="listbox"
            >
              <div className="min-h-0 flex-1 overflow-y-auto p-1" role="presentation">
                {groupNodes}
                {filtered.length === 0 && !showCreate ? (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {emptyMessage}
                  </div>
                ) : null}
              </div>

              {showCreate ? (
                <div className="border-t border-border p-1" role="presentation">
                  <div
                    aria-selected={false}
                    className={cn(
                      'flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm font-semibold text-[#9c7210]',
                      createIsActive ? 'bg-[#f4efe2]' : 'bg-[#fdf7e8]',
                    )}
                    data-combobox-create="true"
                    id={createId}
                    onClick={commitCreate}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setActiveIndex(createIndex)}
                    role="option"
                    {...(createIsActive ? { 'data-active': 'true' } : {})}
                  >
                    <span className="line-clamp-1">
                      {createRowLabel(entityLabel, entityGender, query)}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  },
);
Combobox.displayName = 'Combobox';
