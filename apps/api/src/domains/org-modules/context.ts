/**
 * The organization's modules for THIS request: one query, memoized on the Hono context.
 * Services never call this; routes resolve it and pass the value down as an argument.
 */
import {
  ALL_MODULES_ENABLED,
  editionFromModules,
  type OrgModules,
} from '@fxl-sales/shared-utils/crm-model';
import type { SalesEdition } from '@fxl-sales/shared-utils/sales-edition';
import type { Context } from 'hono';
import { loadOrgModules } from './service.js';

const KEY = 'orgModules';

type Loose = { get(key: string): unknown; set(key: string, value: unknown): void };

/**
 * A value already on the context wins (tests inject it; the first call stores it).
 * A context with neither modules nor a verified Hub context is the whole product -
 * the same fail-to-full rule requireCapability always had. A store failure THROWS.
 */
export async function getOrgModules(c: Context): Promise<OrgModules> {
  const loose = c as unknown as Loose;
  const preset = loose.get(KEY) as OrgModules | undefined;
  if (preset) return preset;
  const hubAuth = loose.get('hubAuth') as { entitlements?: { modules?: readonly unknown[] } } | undefined;
  const orgId = loose.get('orgId') as string | undefined;
  if (!hubAuth || !orgId) return ALL_MODULES_ENABLED;
  const state = await loadOrgModules(orgId, hubAuth.entitlements?.modules);
  loose.set(KEY, state.modules);
  return state.modules;
}

/** The legacy two-value projection of the request's modules (orcamentos off => 'leads'). */
export async function getSalesEdition(c: Context): Promise<SalesEdition> {
  return editionFromModules(await getOrgModules(c));
}
