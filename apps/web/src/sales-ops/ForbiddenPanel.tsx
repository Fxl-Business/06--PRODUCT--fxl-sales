import { FORBIDDEN_COPY } from './forbidden-copy';

/*
  Intentional local copies of the `SalesOpsApp.tsx` style constants, exactly as
  `MissingEntitlementPanel.tsx` and `CadastroHistoryPanel.tsx` re-declare what they
  cannot import: both of those hosts import THIS module to route a 403, so an import
  the other way would be a cycle.
*/
const mutedPanelClass = 'rounded-[18px] border border-[#e8e8ec] bg-[#fbfbfc]';
const mutedStateClass = 'text-[13px] text-[#8b8b92]';

/**
 * The honest state for a `403 forbidden`.
 *
 * The token is valid and the operator is correctly identified; they simply do not
 * hold the membership, Seat, module or role the route requires. That is neither a
 * dead session nor a dead server, so it must reach neither `Sessão expirada` nor
 * the "verifique o servidor local" copy, which is where every 403 landed before.
 *
 * It takes NO props and reads NO hook, unlike `MissingEntitlementPanel`, which reads
 * the Organization seam because it can offer a switch. A 403 offers nothing this app
 * can act on: there is no URL this product could send the operator to that would
 * grant them a role, and a dead affordance on a dead-end screen is the defect class
 * this release exists to remove. That is also what makes this panel renderable with
 * no `QueryClientProvider` and no auth mock.
 *
 * `data-forbidden` is the counterpart of `data-missing-entitlement` and is
 * load-bearing rather than decoration: it is what makes the shell-level oracle go red
 * when the panel is mutated to render nothing.
 */
export function ForbiddenPanel() {
  return (
    <section className={`${mutedPanelClass} flex min-h-[154px] flex-col gap-3 p-6`} data-forbidden>
      <h3 className="text-sm font-bold text-[#201f24]">{FORBIDDEN_COPY.title}</h3>
      <p className="text-[13px] leading-5 text-[#57575f]">{FORBIDDEN_COPY.body}</p>
      <p className={`${mutedStateClass} leading-5`}>{FORBIDDEN_COPY.note}</p>
    </section>
  );
}
