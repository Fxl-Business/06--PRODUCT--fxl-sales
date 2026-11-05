import { cadastroRoute } from './cadastro-routes';
import { leadsRoute } from './leads-routes';
import { callerFromAuthorization } from './caller';
import {
  json,
  notInFixtures,
  type Reply,
  type RouteContext,
  type RouteRequest,
  type World,
} from './http';

const SALES_OPS = '/api/v1/sales-ops/';

/** The marker `assert-web-bundle-clean.mjs` and the isolation test look for. */
export const PROTOTYPE_LAYER_SENTINEL = 'FXL_SALES_PROTOTYPE_FAKE_NETWORK_SENTINEL';

/**
 * Answers one request from the world. A bearer token is required (`401` without it, as the
 * real API does), the identity and organization must be in the fixtures, and the route must
 * be one the screens use; anything else is `notInFixtures`, which names the combination.
 */
export function route(world: World, req: RouteRequest, authorization: string | null): Reply {
  const caller = callerFromAuthorization(authorization);
  if (!caller) return json(401, { error: 'unauthorized' });
  const who = world.fixtures.identities[caller.accountId];
  if (!who) return notInFixtures(req, caller, 'this identity has no fixtures (seeded: team-owner, leads-owner, leads-seller)');
  const org = world.fixtures.orgs[who.orgId];
  if (!org || caller.organizationId !== who.orgId) {
    return notInFixtures(req, caller, `the active organization is not the one seeded for this identity (${who.orgId})`);
  }
  if (!req.path.startsWith(SALES_OPS)) {
    return notInFixtures(req, caller, 'only /api/v1/sales-ops routes are seeded');
  }
  const ctx: RouteContext = {
    world,
    req,
    caller,
    who,
    org,
    segments: req.path.slice(SALES_OPS.length).split('/').filter(Boolean),
  };
  const reply = leadsRoute(ctx) ?? cadastroRoute(ctx);
  return reply ?? notInFixtures(req, caller, 'no fixture route matches');
}
