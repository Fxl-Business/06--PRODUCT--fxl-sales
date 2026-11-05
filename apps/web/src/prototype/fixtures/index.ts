import { buildLeadsOrgFixture, LEADS_ORG_ID, LEADS_OWNER_PERSON_ID, LEADS_SELLER_PERSON_ID } from './leads-org';
import { buildNorteFixture, NORTE_ORG_ID, NORTE_OWNER_PERSON_ID } from './norte';
import { makeClock } from './support';
import type { FixtureSet } from './types';

export type { FixtureSet, IdentityFixture, OrgFixture } from './types';

/**
 * The prototype's whole seed, built for ONE Sao Paulo day. Identities are keyed by the
 * token's `sub` (the dev identity's `accountId`); any other identity has no entry, and the
 * fake network answers it with an error that names it.
 *
 *   team-owner   -> org_fake_norte (every module on, propostas and baixas)
 *   leads-owner  -> org_fake_leads (compact profile, admin)
 *   leads-seller -> org_fake_leads (compact profile, a vendedor: own leads plus unassigned)
 */
export function buildFixtures(today: string): FixtureSet {
  const clock = makeClock(today);
  return {
    orgs: {
      [NORTE_ORG_ID]: buildNorteFixture(clock),
      [LEADS_ORG_ID]: buildLeadsOrgFixture(clock),
    },
    identities: {
      user_fake_ana: { accountId: 'user_fake_ana', orgId: NORTE_ORG_ID, admin: true, personId: NORTE_OWNER_PERSON_ID, displayName: 'Ana Diretora' },
      user_fake_lara: { accountId: 'user_fake_lara', orgId: LEADS_ORG_ID, admin: true, personId: LEADS_OWNER_PERSON_ID, displayName: 'Lara Gestora' },
      user_fake_leo: { accountId: 'user_fake_leo', orgId: LEADS_ORG_ID, admin: false, personId: LEADS_SELLER_PERSON_ID, displayName: 'Leo Vendedor' },
    },
  };
}
