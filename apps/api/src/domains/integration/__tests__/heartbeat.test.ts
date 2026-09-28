import { describe, expect, it } from 'vitest';
import {
  buildSalesHeartbeatBody,
  collectHeartbeatInputs,
  createSalesHeartbeatReporter,
  HEARTBEAT_ERROR_CODES,
  HEARTBEAT_ERROR_DETAIL,
} from '../heartbeat.js';

const config = {
  hubApiUrl: 'http://hub.test',
  applicationId: 'app.fxl-sales',
  clientId: 'pk_x',
  clientSecret: 'sk_x',
  environment: 'development' as const,
};

describe('heartbeat', () => {
  it('collects metadata only, dropping unknown fields', () => {
    const inputs = collectHeartbeatInputs({
      pairs: [
        {
          organizationId: 'org-1',
          counterpartApplicationId: 'app.fxl-finance',
          role: 'producer',
          cursorPosition: 7,
          appliedCount: 3,
          amountCents: 999,
          counterpartName: 'ACME',
        } as never,
      ],
    });
    expect(inputs).toHaveLength(1);
    expect(Object.keys(inputs[0]!).sort()).toEqual(
      [
        'appliedCount', 'counterpartApplicationId', 'cursorLagEvents', 'cursorPosition',
        'eligibility', 'eligibilityCode', 'heldCount', 'lastEventAt', 'organizationId',
        'rejectedCount', 'role',
      ].sort(),
    );
    expect(inputs[0]!.eligibility).toBe('eligible');
  });

  it('body error detail comes from the closed enum', () => {
    const [input] = collectHeartbeatInputs({
      pairs: [
        {
          organizationId: 'o',
          counterpartApplicationId: 'app.fxl-finance',
          role: 'consumer',
          lastError: { code: 'feed_unreachable', at: '2026-01-01T00:00:00.000Z' },
        },
      ],
    });
    const body = buildSalesHeartbeatBody(input!);
    expect(body.lastErrorCode).toBe('feed_unreachable');
    expect(body.lastErrorDetail).toBe(HEARTBEAT_ERROR_DETAIL.feed_unreachable);
    expect(HEARTBEAT_ERROR_CODES).toContain('feed_unreachable');
  });

  it('reporter constructs with no network', () => {
    const fetchImpl = (() => {
      throw new Error('network touched');
    }) as unknown as typeof fetch;
    expect(createSalesHeartbeatReporter(config, { fetchImpl }).report).toBeTypeOf('function');
  });
});
