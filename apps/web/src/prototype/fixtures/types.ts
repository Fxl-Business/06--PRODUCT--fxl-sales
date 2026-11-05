import type { OrgModules } from '@fxl-sales/shared-utils/crm-model';
import type { CadastroHistoryEntryWire } from '@/sales-ops/cadastro-history';
import type {
  CrmPipeline,
  FieldDefinition,
  LeadTimelineItem,
} from '@/sales-ops/leads/crm-types';
import type { DeletedLeadView } from '@/sales-ops/leads/deleted-leads';
import type { SalesOpsLead } from '@/sales-ops/leads/types';
import type { SalesOpsBootstrap, SalesOpsSettlement } from '@/sales-ops/types';

/** One stored follow-up: the list row plus the owner pessoa the scope filter keys on. */
export type FixtureFollowup = {
  id: string;
  leadId: string;
  nextStep: string;
  dueOn: string;
  ownerPersonId: string | null;
  ownerName: string | null;
  doneAt: string | null;
};

/** A lead in the lixeira: the lead itself plus who removed it and when. */
export type FixtureDeletedLead = {
  lead: SalesOpsLead;
  deletedAt: string;
  deletedByName: string | null;
};

/** Everything one organization's screens read, typed against the app's own wire types. */
export type OrgFixture = {
  orgId: string;
  modules: OrgModules;
  bootstrap: SalesOpsBootstrap;
  pipelines: CrmPipeline[];
  fieldDefinitions: FieldDefinition[];
  leads: SalesOpsLead[];
  timeline: Record<string, LeadTimelineItem[]>;
  followups: FixtureFollowup[];
  deletedLeads: FixtureDeletedLead[];
  settlements: SalesOpsSettlement[];
  history: CadastroHistoryEntryWire[];
};

/** One identity the prototype answers for, keyed by the token's `sub`. */
export type IdentityFixture = {
  accountId: string;
  orgId: string;
  /** Mirrors the real `requireAdmin`: an admin sees the whole org, a seller only own leads. */
  admin: boolean;
  /** The pessoa this identity is bound to (the real API binds it by e-mail or account). */
  personId: string | null;
  displayName: string;
};

export type FixtureSet = {
  orgs: Record<string, OrgFixture>;
  identities: Record<string, IdentityFixture>;
};

export type { DeletedLeadView };
