/**
 * Pure, environment-free tests for the two flag readers in
 * `apps/api/src/auth/select.ts`. Neither function does any I/O and neither
 * touches the module graph, so these run with no env stubbing and no reset.
 */
import { describe, expect, it } from 'vitest';
import { isFakeAuthRequested, isProductionEnv } from '../select.js';

describe('isFakeAuthRequested', () => {
  it('accepts exactly 1, true, yes and on, case-insensitively and after trimming', () => {
    for (const value of ['1', 'true', 'yes', 'on']) {
      expect(isFakeAuthRequested({ SALES_AUTH_FAKE: value })).toBe(true);
      expect(isFakeAuthRequested({ SALES_AUTH_FAKE: value.toUpperCase() })).toBe(true);
      expect(isFakeAuthRequested({ SALES_AUTH_FAKE: `  ${value}  ` })).toBe(true);
    }
  });

  it('treats absent, blank, 0 and false as off', () => {
    expect(isFakeAuthRequested({})).toBe(false);
    expect(isFakeAuthRequested({ SALES_AUTH_FAKE: undefined })).toBe(false);
    expect(isFakeAuthRequested({ SALES_AUTH_FAKE: '' })).toBe(false);
    expect(isFakeAuthRequested({ SALES_AUTH_FAKE: '0' })).toBe(false);
    expect(isFakeAuthRequested({ SALES_AUTH_FAKE: 'false' })).toBe(false);
  });

  it('treats any other spelling as off', () => {
    expect(isFakeAuthRequested({ SALES_AUTH_FAKE: 'yeah' })).toBe(false);
    expect(isFakeAuthRequested({ SALES_AUTH_FAKE: '2' })).toBe(false);
    expect(isFakeAuthRequested({ SALES_AUTH_FAKE: 'enabled' })).toBe(false);
  });
});

describe('isProductionEnv', () => {
  it('recognizes production only as the exact NODE_ENV value, trimmed and lowercased', () => {
    expect(isProductionEnv({ NODE_ENV: 'production' })).toBe(true);
    expect(isProductionEnv({ NODE_ENV: 'PRODUCTION' })).toBe(true);
    expect(isProductionEnv({ NODE_ENV: '  production  ' })).toBe(true);
  });

  it('treats development, test, absent and near-miss spellings as not production', () => {
    expect(isProductionEnv({ NODE_ENV: 'development' })).toBe(false);
    expect(isProductionEnv({ NODE_ENV: 'test' })).toBe(false);
    expect(isProductionEnv({})).toBe(false);
    expect(isProductionEnv({ NODE_ENV: undefined })).toBe(false);
    expect(isProductionEnv({ NODE_ENV: 'production-like' })).toBe(false);
    expect(isProductionEnv({ NODE_ENV: 'prod' })).toBe(false);
  });
});
