import { describe, expect, it } from 'vitest';
import { isProducerFlowLive, registerProducerFlowGate } from '../producer-gate.js';

describe('producer gate', () => {
  it('is closed by default and follows the registered predicate', () => {
    expect(isProducerFlowLive('org-1')).toBe(false);
    registerProducerFlowGate((orgId) => orgId === 'org-1');
    expect(isProducerFlowLive('org-1')).toBe(true);
    expect(isProducerFlowLive('org-2')).toBe(false);
    registerProducerFlowGate(() => false);
    expect(isProducerFlowLive('org-1')).toBe(false);
  });
});
