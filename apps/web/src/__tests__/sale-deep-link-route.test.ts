// @vitest-environment happy-dom
import { matchRoutes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SALES_OPS_ROUTE_PATTERN } from '@/sales-ops/navigation';
import { routes } from '../router';

const SALE_ID = '5b0e7c1e-3f4a-4c2d-9e8b-1a2b3c4d5e6f';

function lastMatch(pathname: string) {
  const matches = matchRoutes(routes, pathname);
  const last = matches?.at(-1);
  if (!last) throw new Error(`no route matched ${pathname}`);
  return last;
}

describe('proposta deep link route', () => {
  it('serves a proposta deep link from the protected Sales Ops route, not the catch-all', () => {
    const match = lastMatch(`/operacional/vendas/${SALE_ID}`);
    expect(match.route.path).toBe(SALES_OPS_ROUTE_PATTERN);
    expect(match.params.saleId).toBe(SALE_ID);
  });

  it('serves the list from the same route object as the detail', () => {
    const detail = lastMatch(`/operacional/vendas/${SALE_ID}`);
    const list = lastMatch('/operacional/vendas');
    expect(list.route).toBe(detail.route);
    expect(list.params.saleId).toBeUndefined();
  });

  it('still sends a four-segment path to the catch-all', () => {
    expect(lastMatch('/a/b/c/d').route.path).toBe('*');
  });
});
