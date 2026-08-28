import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrganizations } from '@/auth/react';
import type { Organization } from '@/auth/react';
import { Combobox } from '@/components/ui/combobox';
import { Skeleton } from '@/components/ui/skeleton';
import { isOrgLabelFallback, orgLabel } from '@/lib/displayNames';
import { MISSING_ENTITLEMENT_COPY } from './missing-entitlement-copy';

/*
  Intentional local copies of the `SalesOpsApp.tsx` style constants, exactly as
  `CadastroHistoryPanel.tsx` and `ProfessionalSplitPanel.tsx` re-declare what they
  cannot import. Here the reason is the same shape: `SalesOpsApp.tsx` imports THIS
  module to route a `402 missing_entitlement`, so an import the other way would be a
  cycle.
*/
const mutedPanelClass = 'rounded-[18px] border border-[#e8e8ec] bg-[#fbfbfc]';
const mutedStateClass = 'text-[13px] text-[#8b8b92]';
const actionButtonClass =
  'inline-flex items-center gap-1.5 rounded-[9px] border border-[#dcdce2] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#57575f] transition hover:border-[#eaa81a] hover:bg-[#f5f2ea] hover:text-[#9c7210] disabled:cursor-not-allowed disabled:opacity-60';

/*
  The AGREED SHARED SPELLING for a switch control's accessible name, across this
  panel and the sales ops account dropdown: `Trocar para <Organização>`. It is spelled
  at the call site rather than exported, because exporting a FUNCTION beside a
  component is what trips `react-refresh/only-export-components` (the rule allows a
  constant export and nothing else).

  `orgLabel` falls back to the raw id by design, and an accessible name that says
  WHICH Organization the operator is about to move to is worth more than one that
  refuses to name it. The identifier law still governs the VISIBLE label below, where
  the raw id stays confined to the muted monospace branch.
*/

type CheckoutState =
  | { status: 'loading' }
  | { status: 'ready'; href: string }
  | { status: 'failed' };

/**
 * The honest state for a `402 missing_entitlement`.
 *
 * The API answered perfectly and the local server is fine: the Organization this
 * session is anchored to simply does not carry FXL Sales. So the panel names that
 * Organization, offers the account's OTHER Organizations as switch targets, and then
 * offers the Hub checkout for the active one - switch first, because switching is
 * free and instant while checkout costs money.
 *
 * It reads the Organization seam itself rather than taking it as props: this is auth
 * state, not view state, and the account dropdown reads the very same seam, so
 * threading it through would be the duplicated switching logic the feature exists to
 * avoid. `onRetry` is a prop and OPTIONAL because the bootstrap query belongs to the
 * host, and because the sales ops shell deliberately passes nothing: `setActive`
 * already runs `queryClient.clear()`, which DESTROYS the query, so the mounted
 * observer re-subscribes at `status: 'pending'` and fetches on its own, while a
 * `refetch()` would leave `status: 'error'` and keep this panel on screen naming the
 * OLD Organization.
 *
 * Nothing here reloads the page. The whole point of `setActive` is that components
 * stay mounted across a tenant switch; a reload would throw away the scroll position,
 * any open dialog and the warmed cache to achieve what the seam already did.
 *
 * This panel is the LAST thing between the operator and a blank screen, so no branch
 * in it may throw during render and no branch may render an anchor whose href is
 * unresolved.
 */
export function MissingEntitlementPanel({ onRetry }: { onRetry?: () => void }) {
  const { active, activeName, others, setActive, client } = useOrganizations();

  const [attempt, setAttempt] = useState(0);
  /*
    The resolution is STAMPED with the attempt it answers, and anything that does not
    answer the CURRENT attempt reads as `loading`. That is what lets `Tentar novamente`
    return the block to its skeleton without a `setState` in the effect body, which
    `react-hooks/set-state-in-effect` rejects as a cascading render.
  */
  const [resolved, setResolved] = useState<{ attempt: number; state: CheckoutState } | null>(null);
  const checkout: CheckoutState =
    resolved && resolved.attempt === attempt ? resolved.state : { status: 'loading' };
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchFailed, setSwitchFailed] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /*
    Resolved on mount rather than on click, so the offer is a real anchor: only an
    anchor with a real href supports middle click, "open in new tab" and "copy link".
    Resolve on click would also leave the operator's click doing nothing visible for
    the length of the Hub discovery fetch, which on this exact screen reads as a
    second thing being broken.

    `attempt` is in the dependency array so `Tentar novamente` really re-runs it, and
    a `cancelled` flag drops a resolution that lands after unmount. Do NOT add a ref
    based "already fetched" guard: it would break the retry.
  */
  useEffect(() => {
    let cancelled = false;
    client
      .checkoutUrl()
      .then((href) => {
        if (!cancelled) setResolved({ attempt, state: { status: 'ready', href } });
      })
      .catch(() => {
        if (!cancelled) setResolved({ attempt, state: { status: 'failed' } });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, client]);

  const handleSwitch = useCallback(
    (organizationId: string) => {
      if (switchingId !== null) return;
      setSwitchFailed(false);
      setSwitchingId(organizationId);
      void setActive(organizationId)
        .then(() => {
          /*
            AFTER the await, never before: firing a refetch against the old token
            would just reproduce the same 402.
          */
          onRetry?.();
        })
        .catch(() => {
          if (mountedRef.current) setSwitchFailed(true);
        })
        .finally(() => {
          /*
            A successful switch very probably unmounts this panel, and a setState on
            a dead root is a warning the next reader will take for a real bug.
          */
          if (mountedRef.current) setSwitchingId(null);
        });
    },
    [onRetry, setActive, switchingId],
  );

  const [firstOther] = others;
  const activeIsFallback = active ? isOrgLabelFallback(active) : false;
  const activeLabel = active ? orgLabel(active) : (activeName ?? '');
  const hasActiveLabel = activeLabel !== '';

  return (
    <section
      className={`${mutedPanelClass} flex min-h-[154px] flex-col gap-3 p-6`}
      data-missing-entitlement
    >
      <h3 className="text-sm font-bold text-[#201f24]">{MISSING_ENTITLEMENT_COPY.title}</h3>

      {hasActiveLabel ? (
        <p className="text-[13px] leading-5 text-[#57575f]">
          {MISSING_ENTITLEMENT_COPY.activePrefix}
          <span
            className={
              activeIsFallback
                ? 'font-mono text-xs text-muted-foreground'
                : 'font-semibold text-[#201f24]'
            }
            data-active-organization
          >
            {activeLabel}
          </span>
          {MISSING_ENTITLEMENT_COPY.activeSuffix}
        </p>
      ) : (
        <p className="text-[13px] leading-5 text-[#57575f]">
          {MISSING_ENTITLEMENT_COPY.activeUnknown}
        </p>
      )}

      <p className={`${mutedStateClass} leading-5`}>
        {others.length > 0
          ? MISSING_ENTITLEMENT_COPY.leadWithOthers
          : MISSING_ENTITLEMENT_COPY.leadWithoutOthers}
      </p>

      {/*
        Rendered ONLY when there is somewhere to go. An empty picker on this screen is
        the same dead end the panel exists to remove, and a picker over a single row
        costs three interactions to express a one bit decision, so that case is a
        direct button instead. The active Organization is never a switch target.
      */}
      {others.length > 0 ? (
        <div className="flex flex-col gap-2 pt-1" data-organization-switch>
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]">
            {MISSING_ENTITLEMENT_COPY.switchHeading}
          </p>

          {others.length === 1 && firstOther ? (
            <SingleSwitchButton
              busy={switchingId !== null}
              onSwitch={handleSwitch}
              organization={firstOther}
            />
          ) : (
            <Combobox
              aria-label={MISSING_ENTITLEMENT_COPY.switchAriaLabel}
              className="h-10 w-full max-w-[360px] rounded-[10px]"
              disabled={switchingId !== null}
              emptyMessage={MISSING_ENTITLEMENT_COPY.switchEmptyMessage}
              onChange={handleSwitch}
              options={others.map((organization) => ({
                value: organization.id,
                label: orgLabel(organization),
                description: isOrgLabelFallback(organization) ? organization.id : undefined,
              }))}
              placeholder={MISSING_ENTITLEMENT_COPY.switchPlaceholder}
              searchPlaceholder={MISSING_ENTITLEMENT_COPY.switchSearchPlaceholder}
              value={null}
            />
          )}

          {switchingId !== null ? (
            <p className={mutedStateClass}>{MISSING_ENTITLEMENT_COPY.switching}</p>
          ) : null}
          {/* The control stays on screen beside the error, so the operator can retry
              or pick a different Organization. */}
          {switchFailed ? (
            <p className="text-[13px] leading-5 text-[#a5341c]">
              {MISSING_ENTITLEMENT_COPY.switchFailed}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 pt-1" data-hub-checkout={checkout.status}>
        <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]">
          {MISSING_ENTITLEMENT_COPY.checkoutHeading}
        </p>
        <p className={`${mutedStateClass} leading-5`}>{MISSING_ENTITLEMENT_COPY.checkoutBody}</p>

        {checkout.status === 'loading' ? (
          <>
            <Skeleton className="h-9 w-[168px] rounded-[10px]" />
            <span className="sr-only">{MISSING_ENTITLEMENT_COPY.checkoutLoading}</span>
          </>
        ) : null}

        {checkout.status === 'ready' ? (
          <a
            className={`${actionButtonClass} w-fit`}
            href={checkout.href}
            rel="noreferrer"
            target="_blank"
          >
            {MISSING_ENTITLEMENT_COPY.checkoutLink}
          </a>
        ) : null}

        {/* No anchor at all in this branch: a dead link here would be the same class
            of defect as the copy this panel replaces. */}
        {checkout.status === 'failed' ? (
          <>
            <p className={mutedStateClass}>{MISSING_ENTITLEMENT_COPY.checkoutFailed}</p>
            <button
              className={`${actionButtonClass} w-fit`}
              onClick={() => setAttempt((value) => value + 1)}
              type="button"
            >
              {MISSING_ENTITLEMENT_COPY.checkoutRetry}
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}

function SingleSwitchButton({
  busy,
  onSwitch,
  organization,
}: {
  busy: boolean;
  onSwitch: (organizationId: string) => void;
  organization: Organization;
}) {
  const isFallback = isOrgLabelFallback(organization);
  return (
    <button
      aria-label={`Trocar para ${orgLabel(organization)}`}
      className={`${actionButtonClass} w-fit`}
      disabled={busy}
      onClick={() => onSwitch(organization.id)}
      type="button"
    >
      {busy ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : null}
      {busy ? (
        <span>{MISSING_ENTITLEMENT_COPY.switching}</span>
      ) : (
        <>
          <span>{MISSING_ENTITLEMENT_COPY.switchSinglePrefix}</span>
          <span
            className={
              isFallback ? 'font-mono text-xs text-muted-foreground' : 'font-semibold text-[#201f24]'
            }
          >
            {orgLabel(organization)}
          </span>
        </>
      )}
    </button>
  );
}
