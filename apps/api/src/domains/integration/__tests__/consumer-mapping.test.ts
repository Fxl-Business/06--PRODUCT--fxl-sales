import {
  SETTLEMENT_RECORDED_V1_EXAMPLE_FINANCE,
  SETTLEMENT_REVERSED_V1_EXAMPLE,
} from '@fxl-business/fxl-contracts';
import { describe, expect, it } from 'vitest';
import {
  FINANCE_APP_ID,
  isSupportedFinanceVersion,
  mapFinanceRecorded,
  mapFinanceReversed,
  obligationRowId,
  refUuid,
} from '../consumer-mapping.js';

const U = '1d0a5c77-4b92-4f31-8e6a-30b8c1f24e09';

describe('consumer-mapping', () => {
  it('parses refs and rejects wrong prefix or non-uuid', () => {
    expect(refUuid(`fxl-finance:${U}`, 'fxl-finance')).toBe(U);
    expect(refUuid(`fxl-sales:${U}`, 'fxl-finance')).toBeNull();
    expect(refUuid('fxl-finance:nope', 'fxl-finance')).toBeNull();
    expect(obligationRowId(`fxl-sales:${U}`)).toBe(U);
    expect(obligationRowId('fxl-sales:cl9x7k2p00001')).toBeNull();
  });

  it('supports v1 only', () => {
    expect(isSupportedFinanceVersion(1)).toBe(true);
    expect(isSupportedFinanceVersion(0)).toBe(false);
    expect(isSupportedFinanceVersion(2)).toBe(false);
  });

  it('maps a valid recorded payload and types the rejections', () => {
    const golden = SETTLEMENT_RECORDED_V1_EXAMPLE_FINANCE as Record<string, unknown>;
    // The golden obligation id is not a uuid, so it is an invalid_ref here.
    expect(mapFinanceRecorded(golden)).toEqual({ reject: 'invalid_ref' });
    const ok = mapFinanceRecorded({ ...golden, obligationRef: `fxl-sales:${U}` });
    expect(ok).toMatchObject({ amountCents: 250000, obligationRowId: U });
    expect(mapFinanceRecorded({ nope: 1 })).toEqual({ reject: 'invalid_shape' });
    expect(
      mapFinanceRecorded({ ...golden, obligationRef: `fxl-sales:${U}`, recordedBy: { app: 'app.fxl-sales', displayName: 'x' } }),
    ).toEqual({ reject: 'not_finance_origin' });
    expect(FINANCE_APP_ID).toBe('app.fxl-finance');
  });

  it('maps a reversed payload from a finance-origin reversal and rejects the sales golden', () => {
    const golden = SETTLEMENT_REVERSED_V1_EXAMPLE as Record<string, unknown>;
    expect(mapFinanceReversed(golden)).toEqual({ reject: 'not_finance_origin' });
    const ok = mapFinanceReversed({
      ...golden,
      reversalRef: `fxl-finance:${U}`,
      reversesSettlementRef: `fxl-finance:${U.replace('1d', '2e')}`,
      recordedBy: { app: FINANCE_APP_ID, displayName: 'Tesouraria' },
    });
    expect(ok).toMatchObject({ amountCents: 250000, reason: 'deposito devolvido pelo banco' });
  });
});
