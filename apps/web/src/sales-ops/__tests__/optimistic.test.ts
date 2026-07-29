import { describe, expect, it } from 'vitest';
import {
  isOptimisticId,
  optimisticArea,
  optimisticClient,
  optimisticPerson,
  reconcileOptimisticRow,
} from '../optimistic';
import type {
  SalesOpsArea,
  SalesOpsBootstrap,
  SalesOpsClient,
  SalesOpsPerson,
} from '../types';

const orgId = '99999999-9999-4999-8999-999999999999';

function area(patch: Partial<SalesOpsArea> = {}): SalesOpsArea {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    orgId,
    name: 'Alfa',
    status: 'active',
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

function client(patch: Partial<SalesOpsClient> = {}): SalesOpsClient {
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    orgId,
    name: 'Alfa Cliente',
    contact: null,
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

function person(patch: Partial<SalesOpsPerson> = {}): SalesOpsPerson {
  return {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    orgId,
    displayName: 'Alfa Pessoa',
    contactEmail: null,
    status: 'active',
    isSeller: false,
    isFinder: false,
    isCollaborator: false,
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

function snapshot(patch: Partial<SalesOpsBootstrap> = {}): SalesOpsBootstrap {
  return {
    sales: [],
    products: [],
    clients: [],
    areas: [],
    people: [],
    payables: [],
    saleItems: [],
    receivables: [],
    saleProfessionals: [],
    settings: null,
    ...patch,
  };
}

const alfa = area({ name: 'Alfa' });
const zeta = area({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Zeta' });

describe('sales-ops optimistic snapshot patches', () => {
  it('inserts a new área into the snapshot ordered by name', () => {
    const previous = snapshot({ areas: [alfa, zeta] });

    const patch = optimisticArea(previous, { name: 'Meta', status: 'active' });

    expect(patch.next.areas.map((row) => row.name)).toEqual(['Alfa', 'Meta', 'Zeta']);
    const inserted = patch.next.areas.find((row) => row.name === 'Meta');
    expect(inserted?.id).toMatch(/^optimistic:/);
    expect(isOptimisticId(inserted!.id)).toBe(true);
    expect(patch.rowId).toBe(inserted?.id);
  });

  it('replaces the matching área when the payload carries an id', () => {
    const previous = snapshot({ areas: [alfa, zeta] });

    const patch = optimisticArea(previous, { id: zeta.id, name: 'Beta', status: 'active' });

    expect(patch.next.areas).toHaveLength(2);
    expect(patch.next.areas.map((row) => row.name)).toEqual(['Alfa', 'Beta']);
    expect(patch.next.areas.find((row) => row.name === 'Beta')?.id).toBe(zeta.id);
    expect(patch.rowId).toBe(zeta.id);
  });

  it('does not touch other collections', () => {
    const previous = snapshot({ areas: [alfa] });

    const patch = optimisticArea(previous, { name: 'Meta' });

    expect(patch.next.clients).toBe(previous.clients);
    expect(patch.next.products).toBe(previous.products);
    expect(patch.next.people).toBe(previous.people);
    expect(patch.next.sales).toBe(previous.sales);
    expect(patch.next.receivables).toBe(previous.receivables);
    expect(patch.next.payables).toBe(previous.payables);
  });

  it('reconciles the optimistic row with the persisted row', () => {
    const previous = snapshot({ areas: [alfa] });
    const patch = optimisticArea(previous, { name: 'Meta' });
    const persisted = area({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Meta' });

    const reconciled = reconcileOptimisticRow(
      patch.next,
      'areas',
      patch.rowId,
      persisted,
      (row) => row.name,
    );

    expect(reconciled.areas.map((row) => row.id)).toEqual([alfa.id, persisted.id]);
    expect(reconciled.areas.some((row) => isOptimisticId(row.id))).toBe(false);
  });

  it('rolls back an optimistic insert by dropping the optimistic row', () => {
    const previous = snapshot({ areas: [alfa] });

    const patch = optimisticArea(previous, { name: 'Meta' });

    expect(patch.previous).toBe(previous);
    expect(patch.previous.areas.map((row) => row.name)).toEqual(['Alfa']);
    expect(patch.previous.areas.some((row) => isOptimisticId(row.id))).toBe(false);
  });

  it('rolls back an optimistic edit by restoring the previous snapshot row', () => {
    const previous = snapshot({ areas: [alfa, zeta] });

    const patch = optimisticArea(previous, { id: zeta.id, name: 'Beta' });

    expect(patch.next.areas.map((row) => row.name)).toEqual(['Alfa', 'Beta']);
    expect(patch.previous).toBe(previous);
    expect(patch.previous.areas.map((row) => row.name)).toEqual(['Alfa', 'Zeta']);
  });

  it('inserts a new cliente ordered by name', () => {
    const alfaClient = client();
    const zetaClient = client({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'Zeta Cliente' });
    const previous = snapshot({ clients: [alfaClient, zetaClient] });

    const patch = optimisticClient(previous, { name: 'Meta Cliente' });

    expect(patch.next.clients.map((row) => row.name)).toEqual([
      'Alfa Cliente',
      'Meta Cliente',
      'Zeta Cliente',
    ]);
    expect(isOptimisticId(patch.rowId)).toBe(true);
    expect(patch.next.areas).toBe(previous.areas);
  });

  it('inserts a new pessoa ordered by displayName', () => {
    const alfaPerson = person();
    const zetaPerson = person({
      id: '77777777-7777-4777-8777-777777777777',
      displayName: 'Zeta Pessoa',
    });
    const previous = snapshot({ people: [alfaPerson, zetaPerson] });

    const patch = optimisticPerson(previous, { displayName: 'Meta Pessoa', isSeller: true });

    expect(patch.next.people.map((row) => row.displayName)).toEqual([
      'Alfa Pessoa',
      'Meta Pessoa',
      'Zeta Pessoa',
    ]);
    expect(patch.next.people.find((row) => row.displayName === 'Meta Pessoa')?.isSeller).toBe(true);
    expect(isOptimisticId(patch.rowId)).toBe(true);
    expect(patch.next.clients).toBe(previous.clients);
  });
});
