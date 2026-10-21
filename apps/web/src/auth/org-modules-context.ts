import { createContext } from 'react';
import type { OrgModules } from '@fxl-sales/shared-utils/crm-model';

/** The organization's modules as the Sales shell resolved them from the bootstrap. Null outside the shell. */
export const OrgModulesContext = createContext<OrgModules | null>(null);
