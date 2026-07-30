import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  FuncaoSchema,
  UpdatePersonSchema,
  createFuncao,
  createPerson,
  getFuncao,
  getSalesOpsSnapshot,
  listFuncoes,
  listPeople,
  updateFuncao,
  updatePerson,
} from '../../src/domains/sales-ops/service.js';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

/**
 * Builds a connection string for a different role against the same host/port/db as
 * APP_DB_URL, so the raw-RLS test below can exercise policies through a real
 * non-superuser role instead of a role that bypasses row security.
 */
function withRole(url: string, username: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = username;
  parsed.password = password;
  return parsed.toString();
}

describe('sales operations funções persistence and RLS', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  /**
   * The same service functions driven over a connection that carries
   * `app.fxl_admin`, which satisfies the `*_admin_context` policy and therefore
   * makes every org's rows visible at the database level. On this connection the
   * ONLY thing scoping a read is the service layer's explicit
   * `eq(table.orgId, orgId)` filter, so it isolates that filter from RLS instead
   * of letting one hide a missing other.
   */
  let adminDb: ReturnType<typeof drizzle<typeof schema>>;
  let adminDbClient: postgres.Sql;
  const orgIds: string[] = [];

  function newOrgPair(label: string): [string, string] {
    const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const orgA = `org_func_${label}_a_${suffix}`;
    const orgB = `org_func_${label}_b_${suffix}`;
    orgIds.push(orgA, orgB);
    return [orgA, orgB];
  }

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: 2 });
    adminClient = postgres(ADMIN_DB_URL, { max: 1, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
    adminDbClient = postgres(ADMIN_DB_URL, { max: 2, ...ADMIN_CONNECTION_OPTIONS });
    adminDb = drizzle(adminDbClient, { schema });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      await adminClient`DELETE FROM sales_ops_person_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_people WHERE org_id = ${orgId}`;
    }
    await appClient.end();
    await adminDbClient.end();
    await adminClient.end();
  });

  it('função CRUD stays tenant-scoped through the service layer', async () => {
    const [orgA, orgB] = newOrgPair('crud');

    const funcaoA = await createFuncao(db, orgA, FuncaoSchema.parse({ name: 'Desenvolvedor' }));
    if (typeof funcaoA === 'string') throw new Error(`unexpected sentinel: ${funcaoA}`);
    expect(funcaoA.status).toBe('active');
    expect(funcaoA.slug).toBe('desenvolvedor');
    expect(funcaoA.isSystem).toBe(false);

    // Positive control: org A can read and write its own função.
    expect(await listFuncoes(db, orgA)).toEqual([expect.objectContaining({ id: funcaoA.id })]);
    expect(await getFuncao(db, orgA, funcaoA.id)).toEqual(
      expect.objectContaining({ id: funcaoA.id }),
    );

    // Negative: org B sees nothing and cannot hijack the row.
    expect(await listFuncoes(db, orgB)).toEqual([]);
    expect(await getFuncao(db, orgB, funcaoA.id)).toBeNull();
    expect(await updateFuncao(db, orgB, funcaoA.id, { name: 'hijack' })).toBeNull();

    const [unchanged] = await adminClient<
      { name: string }[]
    >`SELECT name FROM sales_ops_funcoes WHERE id = ${funcaoA.id}`;
    expect(unchanged.name).toBe('Desenvolvedor');

    const archived = await updateFuncao(db, orgA, funcaoA.id, { status: 'archived' });
    if (typeof archived === 'string') throw new Error(`unexpected sentinel: ${archived}`);
    expect(archived?.status).toBe('archived');
    expect(archived?.updatedAt).not.toBeNull();
  });

  it('createFuncao reports duplicates per org but allows the same name in another org', async () => {
    const [orgA, orgB] = newOrgPair('dup');

    const first = await createFuncao(db, orgA, { name: 'Designer', status: 'active' });
    if (typeof first === 'string') throw new Error(`unexpected sentinel: ${first}`);

    expect(await createFuncao(db, orgA, { name: 'Designer', status: 'active' })).toBe('duplicate');
    // A distinct display name that slugifies onto the same machine key is a slug
    // clash, reported separately so the API can explain which rule was hit.
    expect(await createFuncao(db, orgA, { name: 'DESIGNER', status: 'active' })).toBe(
      'duplicate_slug',
    );
    expect(await createFuncao(db, orgA, { name: 'Designer.', status: 'active' })).toBe(
      'duplicate_slug',
    );

    // Positive control: the same name is free in another org.
    expect(await createFuncao(db, orgB, { name: 'Designer', status: 'active' })).not.toBe(
      'duplicate',
    );
  });

  it('createFuncao refuses the reserved vendedor and finder slugs', async () => {
    const [orgA] = newOrgPair('reserved');

    expect(await createFuncao(db, orgA, { name: 'Vendedor', status: 'active' })).toBe(
      'reserved_slug',
    );
    expect(await createFuncao(db, orgA, { name: 'Finder', status: 'active' })).toBe(
      'reserved_slug',
    );
    // Even a decorated spelling that slugifies onto a reserved key is refused.
    expect(await createFuncao(db, orgA, { name: 'vendedor', status: 'active' })).toBe(
      'reserved_slug',
    );

    // Positive control: a non-reserved name still lands, and nothing was written
    // for the three refusals.
    const ok = await createFuncao(db, orgA, { name: 'Tester', status: 'active' });
    if (typeof ok === 'string') throw new Error(`unexpected sentinel: ${ok}`);
    expect(await listFuncoes(db, orgA)).toEqual([expect.objectContaining({ slug: 'tester' })]);
  });

  it('updateFuncao refuses to rename or archive a system função', async () => {
    const [orgA] = newOrgPair('system');

    const [seeded] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_funcoes (org_id, name, slug, is_system)
      VALUES (${orgA}, 'Vendedor', 'vendedor', true)
      RETURNING id
    `;

    expect(await updateFuncao(db, orgA, seeded.id, { name: 'Outro' })).toBe('is_system');
    expect(await updateFuncao(db, orgA, seeded.id, { status: 'archived' })).toBe('is_system');

    const [row] = await adminClient<{ name: string; status: string; updated_at: Date | null }[]>`
      SELECT name, status, updated_at FROM sales_ops_funcoes WHERE id = ${seeded.id}
    `;
    expect(row.name).toBe('Vendedor');
    expect(row.status).toBe('active');
    expect(row.updated_at).toBeNull();

    // Positive control: an org-created função in the same org IS renameable and
    // archivable, so the guard keys on is_system and not on something incidental.
    const dynamic = await createFuncao(db, orgA, { name: 'Tester', status: 'active' });
    if (typeof dynamic === 'string') throw new Error(`unexpected sentinel: ${dynamic}`);
    const renamed = await updateFuncao(db, orgA, dynamic.id, {
      name: 'QA',
      status: 'archived',
    });
    if (typeof renamed === 'string') throw new Error(`unexpected sentinel: ${renamed}`);
    expect(renamed?.name).toBe('QA');
    expect(renamed?.status).toBe('archived');
  });

  it('the is_system check constraint rejects a non-reserved slug flagged as system', async () => {
    const [orgA] = newOrgPair('check');

    await expect(
      adminClient`
        INSERT INTO sales_ops_funcoes (org_id, name, slug, is_system)
        VALUES (${orgA}, 'Desenvolvedor', 'desenvolvedor', true)
      `,
    ).rejects.toThrow(/sales_ops_funcoes_system_slug_check/);

    // Positive controls: the same row is fine when not flagged system, and a
    // reserved slug is fine when flagged system.
    await expect(
      adminClient`
        INSERT INTO sales_ops_funcoes (org_id, name, slug, is_system)
        VALUES (${orgA}, 'Desenvolvedor', 'desenvolvedor', false)
      `,
    ).resolves.toBeDefined();
    await expect(
      adminClient`
        INSERT INTO sales_ops_funcoes (org_id, name, slug, is_system)
        VALUES (${orgA}, 'Finder', 'finder', true)
      `,
    ).resolves.toBeDefined();
  });

  it('org A cannot read org B pessoas or funções', async () => {
    const [orgA, orgB] = newOrgPair('isolation');

    const personA = await createPerson(db, orgA, {
      displayName: 'Sig',
      status: 'active',
      isSeller: true,
    });
    if (typeof personA === 'string') throw new Error(`unexpected sentinel: ${personA}`);
    const personB = await createPerson(db, orgB, {
      displayName: 'Halland',
      status: 'active',
      isFinder: true,
    });
    if (typeof personB === 'string') throw new Error(`unexpected sentinel: ${personB}`);

    const peopleA = await listPeople(db, orgA);
    const peopleB = await listPeople(db, orgB);
    expect(peopleA.map((person) => person.id)).toEqual([personA.id]);
    expect(peopleB.map((person) => person.id)).toEqual([personB.id]);

    const funcoesA = await listFuncoes(db, orgA);
    const funcoesB = await listFuncoes(db, orgB);
    expect(funcoesA.every((funcao) => funcao.orgId === orgA)).toBe(true);
    expect(funcoesB.every((funcao) => funcao.orgId === orgB)).toBe(true);
    expect(funcoesA.map((funcao) => funcao.id)).not.toContain(funcoesB[0]?.id);
    expect(funcoesB.map((funcao) => funcao.id)).not.toContain(funcoesA[0]?.id);

    // The bootstrap snapshot must be scoped identically.
    const snapshotA = await getSalesOpsSnapshot(db, orgA);
    expect(snapshotA.people.map((person) => person.id)).toEqual([personA.id]);
    expect(snapshotA.funcoes.every((funcao) => funcao.orgId === orgA)).toBe(true);
    expect(snapshotA.personFuncoes.every((row) => row.orgId === orgA)).toBe(true);
    expect(snapshotA.personFuncoes.map((row) => row.personId)).toEqual([personA.id]);
  });

  it('scopes every funções and pessoas read by orgId even when RLS is not doing the scoping', async () => {
    // Defence in depth, verified independently: on a connection carrying
    // app.fxl_admin the *_admin_context policy makes every org's rows visible, so
    // if the service layer ever dropped its explicit eq(table.orgId, orgId) the
    // reads below would leak the other org. RLS cannot cover for it here.
    const [orgA, orgB] = newOrgPair('servicefilter');

    const personA = await createPerson(adminDb, orgA, {
      displayName: 'Sig',
      status: 'active',
      isSeller: true,
    });
    if (typeof personA === 'string') throw new Error(`unexpected sentinel: ${personA}`);
    const personB = await createPerson(adminDb, orgB, {
      displayName: 'Halland',
      status: 'active',
      isFinder: true,
    });
    if (typeof personB === 'string') throw new Error(`unexpected sentinel: ${personB}`);
    const devA = await createFuncao(adminDb, orgA, { name: 'Desenvolvedor', status: 'active' });
    if (typeof devA === 'string') throw new Error(`unexpected sentinel: ${devA}`);
    const devB = await createFuncao(adminDb, orgB, { name: 'Designer', status: 'active' });
    if (typeof devB === 'string') throw new Error(`unexpected sentinel: ${devB}`);

    const funcoesA = await listFuncoes(adminDb, orgA);
    expect(funcoesA.every((funcao) => funcao.orgId === orgA)).toBe(true);
    expect(funcoesA.map((funcao) => funcao.id)).toContain(devA.id);
    expect(funcoesA.map((funcao) => funcao.id)).not.toContain(devB.id);

    expect(await getFuncao(adminDb, orgA, devB.id)).toBeNull();
    expect(await getFuncao(adminDb, orgA, devA.id)).not.toBeNull();
    expect(await updateFuncao(adminDb, orgA, devB.id, { name: 'hijack' })).toBeNull();

    const peopleA = await listPeople(adminDb, orgA);
    expect(peopleA.map((person) => person.id)).toEqual([personA.id]);
    // The attached função set must be org-scoped too, not just the person rows.
    expect(peopleA[0].funcoes.map((funcao) => funcao.slug)).toEqual(['vendedor']);
    expect(await updatePerson(adminDb, orgA, personB.id, { displayName: 'hijack' })).toBeNull();

    // A cross-org funcaoId is still refused when the database would have allowed
    // the read, so the guard is the service filter and not the policy.
    expect(
      await updatePerson(adminDb, orgA, personA.id, { funcaoIds: [devB.id] }),
    ).toBe('unknown_funcao');
    expect(
      await updatePerson(adminDb, orgA, personA.id, { funcaoIds: [devA.id] }),
    ).not.toBe('unknown_funcao');

    const snapshotA = await getSalesOpsSnapshot(adminDb, orgA);
    expect(snapshotA.funcoes.every((funcao) => funcao.orgId === orgA)).toBe(true);
    expect(snapshotA.people.every((person) => person.orgId === orgA)).toBe(true);
    expect(snapshotA.personFuncoes.every((row) => row.orgId === orgA)).toBe(true);
  });

  it('createPerson refuses a funcao id belonging to another org and writes nothing', async () => {
    const [orgA, orgB] = newOrgPair('foreign');

    const funcaoB = await createFuncao(db, orgB, { name: 'Desenvolvedor', status: 'active' });
    if (typeof funcaoB === 'string') throw new Error(`unexpected sentinel: ${funcaoB}`);

    expect(
      await createPerson(db, orgA, {
        displayName: 'Kayke',
        status: 'active',
        funcaoIds: [funcaoB.id],
      }),
    ).toBe('unknown_funcao');
    expect(await createPerson(db, orgA, {
      displayName: 'Kayke',
      status: 'active',
      funcaoIds: [randomUUID()],
    })).toBe('unknown_funcao');

    expect(await listPeople(db, orgA)).toEqual([]);
    const assignments = await adminClient<{ count: string }[]>`
      SELECT count(*)::text AS count FROM sales_ops_person_funcoes WHERE org_id = ${orgA}
    `;
    expect(assignments[0].count).toBe('0');

    // Positive control: org A's own função is accepted on the very same payload.
    const funcaoA = await createFuncao(db, orgA, { name: 'Desenvolvedor', status: 'active' });
    if (typeof funcaoA === 'string') throw new Error(`unexpected sentinel: ${funcaoA}`);
    const person = await createPerson(db, orgA, {
      displayName: 'Kayke',
      status: 'active',
      funcaoIds: [funcaoA.id],
    });
    if (typeof person === 'string') throw new Error(`unexpected sentinel: ${person}`);
    expect(person.funcaoIds).toEqual([funcaoA.id]);
  });

  it('a person create with no função at all is rejected', async () => {
    const [orgA] = newOrgPair('required');

    expect(await createPerson(db, orgA, { displayName: 'Joao Boldo', status: 'active' })).toBe(
      'funcao_required',
    );
    expect(await listPeople(db, orgA)).toEqual([]);

    // Positive control.
    const person = await createPerson(db, orgA, {
      displayName: 'Joao Boldo',
      status: 'active',
      isCollaborator: true,
    });
    if (typeof person === 'string') throw new Error(`unexpected sentinel: ${person}`);
    expect(person.funcoes.map((funcao) => funcao.slug)).toEqual(['prestador']);
    expect(person.funcoes[0].isSystem).toBe(false);
  });

  it('listPeople returns each pessoa with its funções attached and the derived boolean mirrors', async () => {
    const [orgA] = newOrgPair('mirrors');

    const seeded = await createPerson(db, orgA, {
      displayName: 'Sig',
      status: 'active',
      isSeller: true,
    });
    if (typeof seeded === 'string') throw new Error(`unexpected sentinel: ${seeded}`);
    expect(seeded.isSeller).toBe(true);
    expect(seeded.isCollaborator).toBe(false);

    const vendedor = (await listFuncoes(db, orgA)).find((funcao) => funcao.slug === 'vendedor');
    expect(vendedor?.isSystem).toBe(true);

    const dev = await createFuncao(db, orgA, { name: 'Desenvolvedor', status: 'active' });
    if (typeof dev === 'string') throw new Error(`unexpected sentinel: ${dev}`);

    const updated = await updatePerson(db, orgA, seeded.id, {
      funcaoIds: [dev.id, vendedor!.id],
    });
    if (typeof updated === 'string') throw new Error(`unexpected sentinel: ${updated}`);

    const [listed] = await listPeople(db, orgA);
    expect(listed.funcoes).toHaveLength(2);
    // System funções lead, then alphabetical by name.
    expect(listed.funcoes.map((funcao) => funcao.slug)).toEqual(['vendedor', 'desenvolvedor']);
    expect(listed.isSeller).toBe(true);
    expect(listed.isFinder).toBe(false);
    // A non-system função makes the pessoa selectable as a prestador.
    expect(listed.isCollaborator).toBe(true);

    // The mirrors are recomputed, not merged: dropping vendedor clears isSeller.
    const narrowed = await updatePerson(db, orgA, seeded.id, { funcaoIds: [dev.id] });
    if (typeof narrowed === 'string') throw new Error(`unexpected sentinel: ${narrowed}`);
    expect(narrowed?.isSeller).toBe(false);
    expect(narrowed?.isCollaborator).toBe(true);
    expect(narrowed?.funcaoIds).toEqual([dev.id]);

    const rows = await adminClient<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM sales_ops_person_funcoes
      WHERE org_id = ${orgA} AND person_id = ${seeded.id}
    `;
    expect(rows[0].count).toBe('1');
  });

  it('updatePerson leaves the assignment set alone when funcaoIds is omitted', async () => {
    const [orgA] = newOrgPair('untouched');

    const person = await createPerson(db, orgA, {
      displayName: 'Cauet',
      status: 'active',
      isSeller: true,
      isFinder: true,
    });
    if (typeof person === 'string') throw new Error(`unexpected sentinel: ${person}`);
    expect(person.funcoes.map((funcao) => funcao.slug).sort()).toEqual(['finder', 'vendedor']);

    const renamed = await updatePerson(db, orgA, person.id, { displayName: 'Cauet Pinciara' });
    if (typeof renamed === 'string') throw new Error(`unexpected sentinel: ${renamed}`);
    expect(renamed?.displayName).toBe('Cauet Pinciara');
    expect(renamed?.funcaoIds.sort()).toEqual(person.funcaoIds.sort());
    expect(renamed?.isSeller).toBe(true);
    expect(renamed?.isFinder).toBe(true);

    // Negative control: an explicitly empty set is a rejection, not a no-op.
    expect(await updatePerson(db, orgA, person.id, { funcaoIds: [] })).toBe('funcao_required');
    const stillThere = await listPeople(db, orgA);
    expect(stillThere[0].funcaoIds).toHaveLength(2);

    // A patch against another org still cannot resolve the row.
    const [, orgB] = newOrgPair('untouched_other');
    expect(await updatePerson(db, orgB, person.id, { displayName: 'hijack' })).toBeNull();
  });

  it('clears contactEmail when the Pessoa dialog omits the key, and keeps it when a value is sent', async () => {
    // Regression: PATCH /people/:id must keep treating contactEmail as a
    // full-replace field. The shipped dialog builds
    // `contactEmail: contactEmail.trim() || undefined` and JSON.stringify drops an
    // undefined key, so an ABSENT key is the only way the UI can blank an e-mail.
    // The body below is round-tripped through JSON.stringify/parse so the test
    // exercises the real wire shape instead of a hand-built object.
    const [orgA] = newOrgPair('emailclear');

    const person = await createPerson(db, orgA, {
      displayName: 'Sig',
      contactEmail: 'sig@example.com',
      status: 'active',
      isSeller: true,
    });
    if (typeof person === 'string') throw new Error(`unexpected sentinel: ${person}`);
    expect(person.contactEmail).toBe('sig@example.com');

    // Exactly what SalesOpsApp's PersonDialog submits after the user blanks the
    // e-mail field: contactEmail collapses to undefined and JSON drops it.
    const blankedWire = JSON.parse(
      JSON.stringify({
        displayName: 'Sig',
        contactEmail: ''.trim() || undefined,
        status: 'active',
        isSeller: true,
        isFinder: false,
        isCollaborator: false,
      }),
    ) as Partial<Parameters<typeof updatePerson>[3]>;
    expect('contactEmail' in blankedWire).toBe(false);

    const cleared = await updatePerson(db, orgA, person.id, UpdatePersonSchema.parse(blankedWire));
    if (typeof cleared === 'string') throw new Error(`unexpected sentinel: ${cleared}`);
    expect(cleared?.contactEmail).toBeNull();
    const [stored] = await adminClient<{ contact_email: string | null }[]>`
      SELECT contact_email FROM sales_ops_people WHERE id = ${person.id}
    `;
    expect(stored.contact_email).toBeNull();

    // Positive control: a real address still round-trips, and an explicit empty
    // string clears just as an absent key does.
    const reset = await updatePerson(db, orgA, person.id, { contactEmail: 'sig@fxl.example' });
    if (typeof reset === 'string') throw new Error(`unexpected sentinel: ${reset}`);
    expect(reset?.contactEmail).toBe('sig@fxl.example');
    const emptied = await updatePerson(db, orgA, person.id, { contactEmail: '' });
    if (typeof emptied === 'string') throw new Error(`unexpected sentinel: ${emptied}`);
    expect(emptied?.contactEmail).toBeNull();

    // The e-mail write must not disturb the função set.
    expect(emptied?.funcoes.map((funcao) => funcao.slug)).toEqual(['vendedor']);
  });

  it('a cross-org assignment is rejected by the composite foreign key even in the admin context', async () => {
    const [orgA, orgB] = newOrgPair('compositefk');

    const [personA] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_people (org_id, display_name) VALUES (${orgA}, 'Sig') RETURNING id
    `;
    const [funcaoA] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_funcoes (org_id, name, slug) VALUES (${orgA}, 'Designer', 'designer')
      RETURNING id
    `;
    const [funcaoB] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_funcoes (org_id, name, slug) VALUES (${orgB}, 'Designer', 'designer')
      RETURNING id
    `;

    // Org A's person paired with org B's função: the (org_id, funcao_id) FK has
    // no matching (orgA, funcaoB) target row, so the database refuses it. A plain
    // single-column funcao_id FK would have accepted this.
    await expect(
      adminClient`
        INSERT INTO sales_ops_person_funcoes (org_id, person_id, funcao_id)
        VALUES (${orgA}, ${personA.id}, ${funcaoB.id})
      `,
    ).rejects.toThrow(/sales_ops_person_funcoes_org_funcao_fk/);

    // ... and org B's org_id paired with org A's person is refused by the other FK.
    await expect(
      adminClient`
        INSERT INTO sales_ops_person_funcoes (org_id, person_id, funcao_id)
        VALUES (${orgB}, ${personA.id}, ${funcaoB.id})
      `,
    ).rejects.toThrow(/sales_ops_person_funcoes_org_person_fk/);

    // Positive control: the same-org pairing is accepted.
    await expect(
      adminClient`
        INSERT INTO sales_ops_person_funcoes (org_id, person_id, funcao_id)
        VALUES (${orgA}, ${personA.id}, ${funcaoA.id})
      `,
    ).resolves.toBeDefined();

    // And an assigned função cannot be deleted out from under the assignment.
    await expect(
      adminClient`DELETE FROM sales_ops_funcoes WHERE id = ${funcaoA.id}`,
    ).rejects.toThrow(/sales_ops_person_funcoes_org_funcao_fk/);
  });

  it('raw RLS blocks cross-org reads of funcoes and person_funcoes and WITH CHECK blocks smuggled inserts', async () => {
    // The migrate/admin connection is a cluster superuser and therefore always
    // bypasses row security, FORCE ROW LEVEL SECURITY included. To prove the
    // policies themselves are correct (not just the service layer's explicit
    // orgId filters), provision a scoped, non-superuser role for this test.
    const roleName = `rls_probe_${randomUUID().replace(/-/g, '_')}`;
    const rolePassword = randomUUID();

    await adminClient.unsafe(
      `CREATE ROLE ${roleName} LOGIN PASSWORD '${rolePassword}' NOSUPERUSER NOBYPASSRLS`,
    );
    await adminClient.unsafe(`GRANT USAGE ON SCHEMA public TO ${roleName}`);
    await adminClient.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON sales_ops_funcoes, sales_ops_person_funcoes, sales_ops_people TO ${roleName}`,
    );

    const roleClient = postgres(withRole(APP_DB_URL, roleName, rolePassword), { max: 1 });

    try {
      const [ORG_A, ORG_B] = newOrgPair('rawrls');

      const { personId, funcaoId, assignmentId } = await roleClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
        const [person] = await tx`
          INSERT INTO sales_ops_people (org_id, display_name)
          VALUES (${ORG_A}, 'RLS Probe Person') RETURNING id
        `;
        const [funcao] = await tx`
          INSERT INTO sales_ops_funcoes (org_id, name, slug)
          VALUES (${ORG_A}, 'RLS Probe Função', 'rls-probe-funcao') RETURNING id
        `;
        const [assignment] = await tx`
          INSERT INTO sales_ops_person_funcoes (org_id, person_id, funcao_id)
          VALUES (${ORG_A}, ${(person as { id: string }).id}, ${(funcao as { id: string }).id})
          RETURNING id
        `;
        return {
          personId: (person as { id: string }).id,
          funcaoId: (funcao as { id: string }).id,
          assignmentId: (assignment as { id: string }).id,
        };
      });

      // Positive control: visible under its own org context.
      const own = await roleClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
        return [
          await tx`SELECT id FROM sales_ops_funcoes WHERE id = ${funcaoId}`,
          await tx`SELECT id FROM sales_ops_person_funcoes WHERE id = ${assignmentId}`,
        ];
      });
      expect(own[0]).toHaveLength(1);
      expect(own[1]).toHaveLength(1);

      // Negative: invisible under another org context.
      const other = await roleClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${ORG_B}, true)`;
        return [
          await tx`SELECT id FROM sales_ops_funcoes WHERE id = ${funcaoId}`,
          await tx`SELECT id FROM sales_ops_person_funcoes WHERE id = ${assignmentId}`,
        ];
      });
      expect(other[0]).toHaveLength(0);
      expect(other[1]).toHaveLength(0);

      // WITH CHECK refuses writing a foreign org_id from inside org A's context.
      await expect(
        roleClient.begin(async (tx) => {
          await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
          return tx`
            INSERT INTO sales_ops_funcoes (org_id, name, slug)
            VALUES (${ORG_B}, 'Smuggled Função', 'smuggled-funcao') RETURNING id
          `;
        }),
      ).rejects.toThrow();

      await expect(
        roleClient.begin(async (tx) => {
          await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
          return tx`
            INSERT INTO sales_ops_person_funcoes (org_id, person_id, funcao_id)
            VALUES (${ORG_B}, ${personId}, ${funcaoId}) RETURNING id
          `;
        }),
      ).rejects.toThrow();

      // With no org context set at all, nothing is readable.
      const noContext = await roleClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', '', true)`;
        return tx`SELECT id FROM sales_ops_person_funcoes WHERE id = ${assignmentId}`;
      });
      expect(noContext).toHaveLength(0);
    } finally {
      await roleClient.end();
      await adminClient.unsafe(`DROP OWNED BY ${roleName}`);
      await adminClient.unsafe(`DROP ROLE ${roleName}`);
    }
  });
});
