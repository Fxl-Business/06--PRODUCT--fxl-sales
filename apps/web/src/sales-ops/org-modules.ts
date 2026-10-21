import {
  ALL_MODULES_ENABLED,
  CRM_MODULE_KEYS,
  modulesForEdition,
  type CrmModuleKey,
  type OrgModules,
} from '@fxl-sales/shared-utils/crm-model';
import type { SalesEdition } from '@fxl-sales/shared-utils/sales-edition';

export { ALL_MODULES_ENABLED };
export type { OrgModules };

export function hasModule(modules: OrgModules, key: CrmModuleKey): boolean {
  return modules[key] === true;
}

export function hasEveryModule(modules: OrgModules, keys: readonly CrmModuleKey[]): boolean {
  return keys.every((key) => hasModule(modules, key));
}

/** `orcamentos` off: the compact CRM profile (what the leads edition is today). */
export function isCompactProfile(modules: OrgModules): boolean {
  return !hasModule(modules, 'orcamentos');
}

/**
 * The module set implied by the token-derived `profile.edition`. A HINT used only until
 * the bootstrap delivers the organization's real modules (slice 12b), and as the fallback
 * for a hand-written test profile with no modules. Correct for every organization the
 * backfill has not been toggled away from.
 */
export function modulesHintFromEdition(edition: SalesEdition | undefined): OrgModules {
  return edition === 'leads' ? modulesForEdition('leads') : ALL_MODULES_ENABLED;
}

/** Stable key for memoizing per module set, for example `1011010`. */
export function modulesCacheKey(modules: OrgModules): string {
  return CRM_MODULE_KEYS.map((key) => (hasModule(modules, key) ? '1' : '0')).join('');
}
