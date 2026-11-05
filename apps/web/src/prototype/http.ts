import { buildFixtures, type FixtureSet, type IdentityFixture, type OrgFixture } from './fixtures';

/**
 * The prototype's in-memory world and the vocabulary its fake routes speak.
 * A route handler gets a `RouteContext`, mutates `ctx.org` for a write, and answers a
 * `Reply`. Nothing here touches the network, `process.env` or the real clock: the day
 * the fixtures hang from and the time of a write are both handed in by `createWorld`.
 */

export type Reply = { status: number; body?: unknown };

export type World = {
  fixtures: FixtureSet;
  /** The fake clock: one second per call from the load instant, so a write stamps a stable time. */
  tick: () => string;
  /** Next sequence for an id the prototype mints (`fid`-shaped). */
  nextId: () => number;
};

export type Caller = {
  accountId: string;
  organizationId: string | null;
  /** What the token says, for the error text only. */
  label: string;
};

export type RouteRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
};

export type RouteContext = {
  world: World;
  req: RouteRequest;
  caller: Caller;
  who: IdentityFixture;
  org: OrgFixture;
  /** The path under `/api/v1/sales-ops/`, split on `/`. */
  segments: string[];
};

export function createWorld(today: string, loadedAtMs: number): World {
  let ticks = 0;
  let ids = 1000;
  return {
    fixtures: buildFixtures(today),
    tick: () => new Date(loadedAtMs + (ticks += 1) * 1000).toISOString(),
    nextId: () => (ids += 1),
  };
}

export const json = (status: number, body?: unknown): Reply => ({ status, body });
export const ok = (body: unknown): Reply => json(200, body);
export const noContent = (): Reply => json(204);
export const notFound = (): Reply => json(404, { error: 'not_found' });
export const badRequest = (reason: string, extra: Record<string, unknown> = {}): Reply =>
  json(400, { error: 'validation_error', reason, ...extra });
export const forbiddenAdmin = (): Reply =>
  json(403, { error: 'forbidden', reason: 'admin_role_required' });

/**
 * The one answer for anything the fixtures do not cover. It names the method, the path,
 * the query and the identity (and the reason), so the missing combination can be read off
 * the screen and added to the fixtures.
 */
export function notInFixtures(req: RouteRequest, caller: Caller | null, reason: string): Reply {
  const query = req.query.toString();
  const where = caller ? ` as ${caller.label}` : '';
  return json(404, {
    error: 'not_in_prototype',
    code: 'not_in_prototype',
    message: `Prototype fixtures have no answer for ${req.method} ${req.path}${query ? `?${query}` : ''}${where}: ${reason}.`,
  });
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export function uuid(world: World, kind: number): string {
  const head = kind.toString(16).padStart(8, '0');
  return `${head}-0000-4000-8000-${String(world.nextId()).padStart(12, '0')}`;
}
