/**
 * Pure oracle for migration 0026 (slice 06): no database connection, just the
 * journal, the shipped SQL bytes and the Drizzle mirror. Applying the migration
 * to the local test DB is proven by `test:integration`, which migrates from
 * scratch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { sellers } from '../../../db/schema.js';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const drizzleDir = path.join(apiRoot, 'drizzle');

function journal(): { idx: number; tag: string; when: number }[] {
  const raw = fs.readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf8');
  return JSON.parse(raw).entries;
}

function migrationStatements(): string[] {
  const sql = fs.readFileSync(path.join(drizzleDir, '0026_seller_invitation_state.sql'), 'utf8');
  return sql
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('--'))
    .join('\n')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
}

const INVITATION_COLUMNS = ['invitation_id', 'invitation_status', 'invited_org_id'] as const;

describe('seller invitation schema (migration 0026)', () => {
  it('journals 0026_seller_invitation_state immediately after 0025_integration_transport', () => {
    const entries = journal();
    const at = entries.findIndex((entry) => entry.tag === '0026_seller_invitation_state');
    expect(at).toBeGreaterThan(0);
    const entry = entries[at];
    const previous = entries[at - 1];
    expect(entry).toMatchObject({ idx: 26, tag: '0026_seller_invitation_state' });
    expect(previous).toMatchObject({ idx: 25, tag: '0025_integration_transport' });
    expect(entry!.when).toBeGreaterThan(previous!.when);
  });

  it('ships exactly three additive nullable sellers columns', () => {
    expect(migrationStatements()).toEqual([
      'ALTER TABLE "sellers" ADD COLUMN "invitation_id" text;',
      'ALTER TABLE "sellers" ADD COLUMN "invitation_status" text;',
      'ALTER TABLE "sellers" ADD COLUMN "invited_org_id" text;',
    ]);
  });

  it('exposes the invitation fields on the Drizzle sellers table', () => {
    expect(sellers.invitationId.name).toBe('invitation_id');
    expect(sellers.invitationStatus.name).toBe('invitation_status');
    expect(sellers.invitedOrgId.name).toBe('invited_org_id');
  });

  it('declares the invitation columns as nullable text with no default', () => {
    const config = getTableConfig(sellers);
    for (const name of INVITATION_COLUMNS) {
      const column = config.columns.find((candidate) => candidate.name === name);
      expect(column, name).toBeDefined();
      expect(column!.getSQLType()).toBe('text');
      expect(column!.notNull).toBe(false);
      expect(column!.hasDefault).toBe(false);
    }
  });

  it('keeps sellers cross-org: no org_id column and no RLS', () => {
    const config = getTableConfig(sellers);
    expect(config.columns.map((column) => column.name)).not.toContain('org_id');
    expect(config.enableRLS).toBe(false);
    expect(config.policies).toEqual([]);
  });
});
