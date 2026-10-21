import { describe, expect, it } from 'vitest';
import {
  buildLeadStagePath,
  buildLeadSummaryPath,
  buildSaleDetailPath,
  buildSalesOpsPath,
  resolveSalesOpsRoute,
} from '../navigation';

describe('lead routes', () => {
  it('a lead id in the third segment resolves to leadId, not stageId', () => {
    const resolution = resolveSalesOpsRoute({ workspace: 'operacional', view: 'leads', saleId: 'L1' }, ['admin']);
    expect(resolution.route).toStrictEqual({ workspace: 'operacional', view: 'leads', leadId: 'L1' });
    expect(resolution.redirect).toBe(false);
    expect(resolution.path).toBe('/operacional/leads/L1');
  });

  it('the etapa query resolves to stageId without a redirect', () => {
    const resolution = resolveSalesOpsRoute({ workspace: 'operacional', view: 'leads', etapa: 'S1' }, ['admin']);
    expect(resolution.route).toStrictEqual({ workspace: 'operacional', view: 'leads', stageId: 'S1' });
    expect(resolution.path).toBe('/operacional/leads?etapa=S1');
    expect(resolution.redirect).toBe(false);
  });

  it('a bare leads URL still redirects to the Funil', () => {
    const resolution = resolveSalesOpsRoute({ workspace: 'operacional', view: 'leads' }, ['admin']);
    expect(resolution.route).toStrictEqual({ workspace: 'operacional', view: 'funil' });
    expect(resolution.path).toBe('/operacional/funil');
    expect(resolution.redirect).toBe(true);
  });

  it('a lead id wins over an etapa and the canonical URL drops the etapa', () => {
    const resolution = resolveSalesOpsRoute(
      { workspace: 'operacional', view: 'leads', saleId: 'L1', etapa: 'S1' },
      ['admin'],
    );
    expect(resolution.route).toStrictEqual({ workspace: 'operacional', view: 'leads', leadId: 'L1' });
    expect(resolution.path).toBe('/operacional/leads/L1');
    expect(resolution.redirect).toBe(true);
  });

  it('an etapa on any other view is dropped with a redirect', () => {
    const resolution = resolveSalesOpsRoute({ workspace: 'operacional', view: 'funil', etapa: 'S1' }, ['admin']);
    expect(resolution.route).toStrictEqual({ workspace: 'operacional', view: 'funil' });
    expect(resolution.redirect).toBe(true);
  });

  it('meus-dados accepts the lead summary for a seller and drops it for a finder-only operator', () => {
    const seller = resolveSalesOpsRoute({ workspace: 'meus-dados', view: 'leads', saleId: 'L9' }, ['seller']);
    expect(seller.route).toStrictEqual({ workspace: 'meus-dados', view: 'leads', leadId: 'L9' });
    expect(seller.path).toBe('/meus-dados/leads/L9');
    expect(seller.redirect).toBe(false);

    const finder = resolveSalesOpsRoute({ workspace: 'meus-dados', view: 'leads', saleId: 'L9' }, ['finder']);
    expect(finder.route.view).not.toBe('leads');
  });

  it('buildLeadSummaryPath and buildLeadStagePath encode their ids', () => {
    expect(buildLeadSummaryPath('operacional', 'a/b')).toBe('/operacional/leads/a%2Fb');
    expect(buildLeadStagePath('meus-dados', 'x y')).toBe('/meus-dados/leads?etapa=x%20y');
  });

  it('a saleId is honoured only on vendas and a leadId only on leads', () => {
    expect(resolveSalesOpsRoute({ workspace: 'operacional', view: 'vendas', saleId: 'V1' }, ['admin']).route).toStrictEqual({
      workspace: 'operacional',
      view: 'vendas',
      saleId: 'V1',
    });
    const dropped = resolveSalesOpsRoute({ workspace: 'operacional', view: 'comissoes', saleId: 'V1' }, ['admin']);
    expect(dropped.route).toStrictEqual({ workspace: 'operacional', view: 'comissoes' });
    expect(dropped.redirect).toBe(true);
  });

  it('the Finance deep link is unchanged', () => {
    expect(buildSaleDetailPath('abc')).toBe('/operacional/vendas/abc');
    expect(buildSalesOpsPath({ workspace: 'operacional', view: 'vendas', saleId: 'abc' })).toBe('/operacional/vendas/abc');
  });
});
