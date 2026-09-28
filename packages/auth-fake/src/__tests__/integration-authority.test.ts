import { FIXTURE_INTEGRATED_ORGANIZATION_ID } from '@fxl-business/fxl-contracts/testing';
import { describe, expect, it } from 'vitest';
import {
  FAKE_INTEGRATION_ACTIVATIONS,
  FINANCE_APPLICATION,
  SALES_APPLICATION,
  getFakeIntegrationAuthority,
} from '../index.js';

describe('getFakeIntegrationAuthority', () => {
  it('builds under development and exposes the three authority parts plus discovery', () => {
    const authority = getFakeIntegrationAuthority();
    expect(authority.ticketClient).toBeDefined();
    expect(authority.verifier).toBeDefined();
    expect(authority.reporter).toBeDefined();
    expect(authority.discovery).toBeDefined();
  });

  it('is a memoized singleton, never rebuilt per call', () => {
    expect(getFakeIntegrationAuthority()).toBe(getFakeIntegrationAuthority());
  });

  it('activates BOTH directions over the fixture org with v1 event names', () => {
    expect(FAKE_INTEGRATION_ACTIVATIONS.every((a) => a.organizationId === FIXTURE_INTEGRATED_ORGANIZATION_ID)).toBe(true);
    const pairs = FAKE_INTEGRATION_ACTIVATIONS.map((a) => `${a.producerApplicationId}>${a.consumerApplicationId}`);
    expect(pairs).toEqual([
      `${SALES_APPLICATION}>${FINANCE_APPLICATION}`,
      `${FINANCE_APPLICATION}>${SALES_APPLICATION}`,
    ]);
    expect(FAKE_INTEGRATION_ACTIVATIONS[0]!.eventNames).toContain('fxl-sales.settlement.recorded');
    expect(FAKE_INTEGRATION_ACTIVATIONS[1]!.eventNames).toEqual([
      'fxl-finance.settlement.recorded',
      'fxl-finance.settlement.reversed',
    ]);
  });

  it('derives discovery from the activations', async () => {
    const { discovery } = getFakeIntegrationAuthority();
    expect(await discovery.activations()).toEqual([
      { producerApplicationId: FINANCE_APPLICATION, organizationId: FIXTURE_INTEGRATED_ORGANIZATION_ID },
    ]);
    const roles = (await discovery.producerActivations()).map((a) => a.role).sort();
    expect(roles).toEqual(['consumer', 'producer']);
    const contracts = await discovery.contracts();
    expect(contracts.filter((c) => c.role === 'producer')).toHaveLength(3);
    expect(contracts.filter((c) => c.role === 'consumer')).toHaveLength(2);
  });
});
