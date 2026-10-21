import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import { useAuthProfile } from '@/auth/react';
import { Skeleton } from '@/components/ui/skeleton';
import { buildSalesOpsPath, type SalesOpsWorkspace } from '../navigation';
import { type PeriodSelection, selectionToRange } from '../period';
import type { FollowupScope, FollowupStatus } from './crm-types';
import { useFollowups, useMarkFollowupDone } from './crm-hooks';
import { followupsParams } from './followups';
import { FollowupsView } from './FollowupsView';
import { LEAD_SUMMARY_OPENED_IN_APP } from './lead-summary-nav';

/*
 * The follow-ups route. The scope is `team` only for an admin under `operacional`
 * (the API answers team to an admin alone); everywhere else it is `mine`. The
 * period defaults to the next seven days, the agenda's forward view.
 */

const DEFAULT_PERIOD: PeriodSelection = { preset: 'next7', from: '', to: '' };

export function FollowupsContainer({ workspace }: { workspace: SalesOpsWorkspace }) {
  const navigate = useNavigate();
  const isAdmin = useAuthProfile().roles.includes('admin');
  const showScopeToggle = workspace === 'operacional' && isAdmin;
  const [scope, setScope] = React.useState<FollowupScope>(showScopeToggle ? 'team' : 'mine');
  const [status, setStatus] = React.useState<FollowupStatus>('open');
  const [period, setPeriod] = React.useState<PeriodSelection>(DEFAULT_PERIOD);
  const today = React.useMemo(() => todayInSaoPaulo(), []);
  const range = React.useMemo(() => selectionToRange(period, today), [period, today]);
  const params = React.useMemo(() => followupsParams(scope, status, range), [scope, status, range]);
  const followupsQuery = useFollowups(params);
  const markDone = useMarkFollowupDone();

  if (followupsQuery.isPending) {
    return <Skeleton className="h-[320px] w-full" />;
  }

  return (
    <FollowupsView
      loadFailed={followupsQuery.isError}
      onMarkDone={(followupId) => markDone.mutate(followupId)}
      onOpenLead={(leadId) =>
        navigate(buildSalesOpsPath({ workspace, view: 'leads', leadId }), { state: LEAD_SUMMARY_OPENED_IN_APP })
      }
      onPeriodChange={setPeriod}
      onScopeChange={setScope}
      onStatusChange={setStatus}
      pendingId={markDone.isPending ? (markDone.variables ?? null) : null}
      period={period}
      rows={followupsQuery.data ?? []}
      scope={scope}
      showScopeToggle={showScopeToggle}
      status={status}
      today={today}
    />
  );
}
