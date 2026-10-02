import type { Context } from 'hono';
import { getHubActorDisplayName } from '../../middleware/app-auth.js';
import type { CadastroActor } from './service.js';

/**
 * Who is performing this cadastro write, taken from the VERIFIED context and
 * never from the request body. `c.get('userId')` is the Hub account id
 * appAuthMiddleware set from the verified token; the display name is snapshotted
 * into the ledger entry because there is no Hub account directory to resolve it
 * from later. `/api/v1/sales-ops/*` is behind appAuthMiddleware, so both are
 * always populated.
 */
export function cadastroActor(c: Context): CadastroActor {
  return { userId: c.get('userId'), displayName: getHubActorDisplayName(c.get('hubAuth')) };
}
