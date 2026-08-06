import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wiring contract for the nightly scheduler.
 *
 * Every dependency is mocked, deliberately: this file asserts only what
 * setupNightlyJob REGISTERS and what stopNightlyJob STOPS. What the three tasks
 * actually do is proven against a real database elsewhere (the purge's oracle is
 * test/rls/cadastro-purge.test.ts). Mocking `../../db/client.js` also means no
 * connection factory is ever constructed here - the purge is destructive and the
 * configured DATABASE_URL is not the test database.
 */

const cronMock = vi.hoisted(() => {
  const stops: Array<ReturnType<typeof vi.fn>> = [];
  const handlers: Array<() => Promise<void>> = [];
  const schedule = vi.fn((expression: string, handler: () => Promise<void>) => {
    void expression;
    handlers.push(handler);
    const stop = vi.fn();
    stops.push(stop);
    return { stop };
  });
  return { handlers, schedule, stops };
});

vi.mock('node-cron', () => ({ default: { schedule: cronMock.schedule } }));
vi.mock('../../db/client.js', () => ({ getAdminDb: () => ({}) }));
vi.mock('../../domains/commissions/service.js', () => ({
  promoteHoldExpired: vi.fn(async () => 0),
}));
vi.mock('../../auth/hub-session-store.js', () => ({
  deleteExpiredHubBffSessions: vi.fn(async () => ({ sessions: 0, loginTxns: 0 })),
}));
vi.mock('../../domains/sales-ops/purge-service.js', () => ({
  // The purge blows up, so the assertion below is about isolation and nothing else.
  purgeArchivedCadastros: vi.fn(async () => {
    throw new Error('purge_exploded');
  }),
  formatCadastroPurgeReport: () => '',
}));

const { setupNightlyJob, stopNightlyJob } = await import('../nightly-job.js');

describe('nightly scheduler wiring', () => {
  beforeEach(() => {
    // The module holds its tasks in module-level singletons, so the reset has to
    // release those FIRST - clearing the spies while a task is still registered
    // would make the next setupNightlyJob() a silent no-op.
    stopNightlyJob();
    cronMock.schedule.mockClear();
    cronMock.stops.length = 0;
    cronMock.handlers.length = 0;
  });

  afterEach(() => {
    stopNightlyJob();
    vi.restoreAllMocks();
  });

  it('registers the three nightly tasks on ONE scheduler and stops every one of them', () => {
    setupNightlyJob();

    expect(cronMock.schedule.mock.calls.map((call) => call[0])).toEqual([
      '0 3 * * *',
      '15 3 * * *',
      // The archived-cadastro purge runs last, after the two non-destructive tasks.
      '30 3 * * *',
    ]);

    stopNightlyJob();
    // A task left running after shutdown keeps a timer - and, for the purge, a
    // destructive one - alive in a process that is supposed to be gone.
    expect(cronMock.stops).toHaveLength(3);
    for (const stop of cronMock.stops) expect(stop).toHaveBeenCalledTimes(1);
  });

  it('contains a failing task inside its own try/catch', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupNightlyJob();

    const purgeHandler = cronMock.handlers.at(-1)!;
    // node-cron does not await this callback, so an escaping rejection is an
    // unhandled one - and the other two tasks are scheduled independently, so the
    // real cost is a nightly log that goes silent rather than a visible crash.
    await expect(purgeHandler()).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledWith(
      '[nightly-job] archived cadastro purge failed:',
      expect.any(Error),
    );
  });
});
