import type { PeriodPreset, PeriodRange } from '../period';
import { periodQuery } from '../period';
import type { FollowupScope, FollowupStatus, FollowupListRow, ListFollowupsParams } from './crm-types';

/*
 * The pure rules of the follow-ups list (`operacional|meus-dados/follow-ups`). No
 * React and no clock: the period arrives already resolved to a range.
 */

export const FOLLOWUP_COPY = {
  teamLabel: 'Equipe',
  mineLabel: 'Minha',
  statusLabel: 'Situação',
  statusOpen: 'Em aberto',
  statusDone: 'Concluídos',
  statusAll: 'Todos',
  empty: 'Nenhum follow-up neste período.',
  loadFailed: 'Não foi possível carregar os follow-ups.',
  openLead: 'Abrir lead',
  done: 'Concluir',
  doneBadge: 'Concluído',
  noOwner: 'Sem responsável',
} as const;

export const FOLLOWUP_SCOPE_OPTIONS: ReadonlyArray<{ value: FollowupScope; label: string }> = [
  { value: 'team', label: FOLLOWUP_COPY.teamLabel },
  { value: 'mine', label: FOLLOWUP_COPY.mineLabel },
];

export const FOLLOWUP_STATUS_OPTIONS: ReadonlyArray<{ value: FollowupStatus; label: string }> = [
  { value: 'open', label: FOLLOWUP_COPY.statusOpen },
  { value: 'done', label: FOLLOWUP_COPY.statusDone },
  { value: 'all', label: FOLLOWUP_COPY.statusAll },
];

/** The agenda's presets: a forward-looking `next7` sits next to the past ones. */
export const FOLLOWUP_PRESETS: readonly PeriodPreset[] = ['all', 'today', 'next7', 'last7', 'month', 'custom'];

/** By due day ascending, then by the lead's name (pt-BR), so the list reads as an agenda. */
export function sortFollowups(rows: readonly FollowupListRow[]): FollowupListRow[] {
  return [...rows].sort((a, b) => {
    if (a.dueOn !== b.dueOn) return a.dueOn < b.dueOn ? -1 : 1;
    return a.leadContactName.localeCompare(b.leadContactName, 'pt-BR');
  });
}

/** The list's query: an open period sends no `from`/`to` at all. */
export function followupsParams(
  scope: FollowupScope,
  status: FollowupStatus,
  range: PeriodRange,
): ListFollowupsParams {
  return { scope, status, ...periodQuery(range) };
}
