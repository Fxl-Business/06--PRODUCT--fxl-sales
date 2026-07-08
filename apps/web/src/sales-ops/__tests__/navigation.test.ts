import { describe, expect, it } from 'vitest';
import {
  getSalesOpsNavigation,
  getSalesOpsRoleViews,
  resolveInitialSalesOpsView,
} from '../navigation';

describe('sales operations navigation', () => {
  it('shows tactical dashboard only to the team role', () => {
    expect(getSalesOpsNavigation('tatico', 'equipe').map((item) => item.id)).toEqual([
      'dashboard',
      'vendedores',
      'finders',
    ]);
    expect(getSalesOpsNavigation('tatico', 'vendedor').map((item) => item.id)).toEqual([
      'vendedores',
    ]);
    expect(getSalesOpsNavigation('tatico', 'finder').map((item) => item.id)).toEqual(['finders']);
  });

  it('keeps operational sales and commissions available for every role', () => {
    expect(getSalesOpsNavigation('operacional', 'equipe').map((item) => item.id)).toEqual([
      'vendas',
      'comissoes',
    ]);
    expect(getSalesOpsNavigation('operacional', 'vendedor').map((item) => item.id)).toEqual([
      'vendas',
      'comissoes',
    ]);
    expect(getSalesOpsNavigation('operacional', 'finder').map((item) => item.id)).toEqual([
      'vendas',
      'comissoes',
    ]);
  });

  it('redirects invalid active views to the first available prototype view', () => {
    expect(resolveInitialSalesOpsView('config', 'equipe', 'vendas')).toBe('produtos');
    expect(resolveInitialSalesOpsView('tatico', 'finder', 'dashboard')).toBe('finders');
    expect(resolveInitialSalesOpsView('operacional', 'vendedor', 'comissoes')).toBe('comissoes');
  });

  it('limits the visual role switcher to Hub-granted app roles', () => {
    expect(getSalesOpsRoleViews(['admin', 'seller', 'finder'])).toEqual([
      'equipe',
      'vendedor',
      'finder',
    ]);
    expect(getSalesOpsRoleViews(['seller', 'finder'])).toEqual(['vendedor', 'finder']);
    expect(getSalesOpsRoleViews(['seller'])).toEqual(['vendedor']);
    expect(getSalesOpsRoleViews([])).toEqual([]);
  });
});
