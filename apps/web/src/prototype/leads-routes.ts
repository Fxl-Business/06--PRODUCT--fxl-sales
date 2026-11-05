import { stageActsAsOrcamento } from '@fxl-sales/shared-utils/crm-model';
import { saoPauloDayOf } from '@fxl-sales/shared-utils/sao-paulo-day';
import type {
  CrmPipeline,
  CrmPipelineStage,
  FieldDefinition,
  LeadFieldValue,
  LeadNextStage,
  LeadSummaryResponse,
  LeadTimelineItem,
} from '@/sales-ops/leads/crm-types';
import type { SalesOpsLead, SalesOpsLeadStage } from '@/sales-ops/leads/types';
import type { OrgFixture } from './fixtures';
import {
  asRecord,
  badRequest,
  forbiddenAdmin,
  json,
  noContent,
  notFound,
  notInFixtures,
  ok,
  str,
  uuid,
  type Reply,
  type RouteContext,
} from './http';

/** The stage a pipeline projects: with `orcamentos` off an orcamento etapa is an ordinary one. */
function projectStage(org: OrgFixture, stage: CrmPipelineStage): CrmPipelineStage {
  return stageActsAsOrcamento(stage, org.modules) ? stage : { ...stage, behavior: 'none' };
}

export function projectPipelines(org: OrgFixture): CrmPipeline[] {
  return org.pipelines.map((pipeline) => ({
    ...pipeline,
    stages: pipeline.stages.map((stage) => projectStage(org, stage)),
  }));
}

function defaultPipeline(org: OrgFixture): CrmPipeline {
  return org.pipelines.find((pipeline) => pipeline.isDefault) ?? org.pipelines[0]!;
}

function legacyStage(org: OrgFixture, pipeline: CrmPipeline, stage: CrmPipelineStage): SalesOpsLeadStage {
  const acts = stageActsAsOrcamento(stage, org.modules);
  const kind = acts ? 'conversion' : stage.exitKind === 'perdido' ? 'lost' : 'normal';
  return {
    id: stage.id,
    orgId: org.orgId,
    name: stage.name,
    position: stage.position,
    kind,
    isSystem: kind !== 'normal',
    status: stage.status,
    archivedAt: null,
    createdAt: '2026-01-01T15:00:00.000Z',
    updatedAt: null,
    pipelineId: pipeline.id,
    type: stage.type,
    behavior: acts ? stage.behavior : 'none',
    exitKind: stage.exitKind,
    requiresReason: stage.requiresReason,
  };
}

function findStage(org: OrgFixture, stageId: string) {
  for (const pipeline of org.pipelines) {
    const stage = pipeline.stages.find((candidate) => candidate.id === stageId);
    if (stage) return { pipeline, stage };
  }
  return null;
}

/** A vendedor sees own leads plus unassigned ones; an admin sees the whole org. */
function visibleTo(ctx: RouteContext, lead: SalesOpsLead): boolean {
  if (ctx.who.admin) return true;
  return lead.sellerPersonId === null || lead.sellerPersonId === ctx.who.personId;
}

function scoped(ctx: RouteContext): SalesOpsLead[] {
  return ctx.org.leads.filter((lead) => visibleTo(ctx, lead));
}

function leadById(ctx: RouteContext, id: string | undefined): SalesOpsLead | null {
  if (!id) return null;
  return ctx.org.leads.find((lead) => lead.id === id && visibleTo(ctx, lead)) ?? null;
}

const byPosition = (a: SalesOpsLead, b: SalesOpsLead) =>
  a.position - b.position || a.id.localeCompare(b.id);

function inPeriod(lead: SalesOpsLead, from: string | null, to: string | null): boolean {
  const day = saoPauloDayOf(new Date(lead.createdAt));
  return (!from || day >= from) && (!to || day <= to);
}

function sellerNameOf(org: OrgFixture, personId: string | null): string {
  if (!personId) return '';
  return org.bootstrap.people.find((person) => person.id === personId)?.displayName ?? '';
}

/** Folds the dynamic `fields` of a write into the lead, and into the columns they back. */
function applyFields(org: OrgFixture, lead: SalesOpsLead, fields: unknown): void {
  if (!Array.isArray(fields)) return;
  const definitions = new Map<string, FieldDefinition>();
  for (const definition of org.fieldDefinitions) {
    definitions.set(definition.id, definition);
    definitions.set(definition.key, definition);
  }
  const values = new Map<string, LeadFieldValue>((lead.fields ?? []).map((value) => [value.key, value]));
  for (const raw of fields) {
    const entry = asRecord(raw);
    const definition = definitions.get(str(entry.fieldId) ?? str(entry.key) ?? '');
    if (!definition || definition.key === 'cliente') continue;
    const value = entry.value as LeadFieldValue['value'] | undefined;
    if (value === null || value === undefined || value === '') values.delete(definition.key);
    else values.set(definition.key, { fieldId: definition.id, key: definition.key, value });
  }
  lead.fields = [...values.values()];
  const descricao = values.get('descricao')?.value;
  lead.description = typeof descricao === 'string' ? descricao : null;
  const nascimento = values.get('nascimento')?.value;
  lead.contactBirthDate = typeof nascimento === 'string' ? nascimento : null;
  const produtos = values.get('produtos')?.value;
  lead.products = Array.isArray(produtos)
    ? produtos.map((item) => ({ productId: item.id, productNameSnapshot: item.name }))
    : [];
}

function applyClient(org: OrgFixture, lead: SalesOpsLead, body: Record<string, unknown>): void {
  if (!('clientId' in body) && !('clientName' in body)) return;
  const clientId = str(body.clientId) ?? null;
  const client = clientId ? org.bootstrap.clients.find((row) => row.id === clientId) : undefined;
  lead.clientId = client?.id ?? null;
  lead.clientNameSnapshot = client?.name ?? str(body.clientName) ?? '';
}

const nullable = (value: unknown): string | null => {
  const text = str(value)?.trim();
  return text ? text : null;
};

function pushTimeline(ctx: RouteContext, leadId: string, item: LeadTimelineItem): void {
  const list = ctx.org.timeline[leadId] ?? (ctx.org.timeline[leadId] = []);
  list.push(item);
}

function renumber(column: SalesOpsLead[]): void {
  column.forEach((lead, index) => {
    lead.position = index + 1;
  });
}

/** Puts `lead` in `stageId` at `index` of that column, closing the gap it left. */
function place(ctx: RouteContext, lead: SalesOpsLead, stageId: string, index: number): void {
  const found = findStage(ctx.org, stageId);
  if (!found) return;
  const previousStageId = lead.stageId;
  const column = ctx.org.leads
    .filter((other) => other.stageId === stageId && other.id !== lead.id)
    .sort(byPosition);
  column.splice(Math.max(0, Math.min(index, column.length)), 0, lead);
  lead.stageId = stageId;
  lead.stageType = found.stage.type;
  lead.stageExitKind = found.stage.exitKind;
  renumber(column);
  if (previousStageId !== stageId) {
    renumber(ctx.org.leads.filter((other) => other.stageId === previousStageId).sort(byPosition));
  }
}

type MoveGate = { reply: Reply } | { target: { pipeline: CrmPipeline; stage: CrmPipelineStage } };

/** The checks `moveLead` and `advanceLead` share: the graph, the reason and the conversion door. */
function gateMove(ctx: RouteContext, lead: SalesOpsLead, toStageId: string, reason: string | undefined): MoveGate {
  const target = findStage(ctx.org, toStageId);
  if (!target) return { reply: badRequest('stage_not_found') };
  const crossing = toStageId !== lead.stageId;
  if (crossing) {
    const edge = target.pipeline.transitions.some(
      (transition) => transition.fromStageId === lead.stageId && transition.toStageId === toStageId,
    );
    if (!edge) return { reply: json(409, { error: 'transition_not_allowed' }) };
    if (target.stage.requiresReason && !reason) return { reply: badRequest('lost_reason_required') };
  }
  return { target };
}

function moveLead(ctx: RouteContext, lead: SalesOpsLead, body: Record<string, unknown>): Reply {
  const toStageId = str(body.stageId) ?? '';
  const reason = nullable(body.reason) ?? undefined;
  const gate = gateMove(ctx, lead, toStageId, reason);
  if ('reply' in gate) return gate.reply;
  const { stage } = gate.target;
  const saleId = str(body.saleId);
  const crossing = toStageId !== lead.stageId;
  if (crossing && stageActsAsOrcamento(stage, ctx.org.modules) && !saleId) {
    return badRequest('sale_required_for_conversion');
  }
  if (saleId && !stageActsAsOrcamento(stage, ctx.org.modules)) return badRequest('sale_not_allowed');
  const fromName = findStage(ctx.org, lead.stageId)?.stage.name ?? null;
  const position = typeof body.position === 'number' ? body.position : Number.MAX_SAFE_INTEGER;
  place(ctx, lead, toStageId, position);
  if (crossing) {
    lead.stageChangedAt = ctx.world.tick();
    lead.lostReason = stage.requiresReason ? (reason ?? null) : null;
    pushTimeline(ctx, lead.id, {
      kind: 'stage_changed',
      at: lead.stageChangedAt,
      actorName: ctx.who.displayName,
      fromStageName: fromName,
      toStageName: stage.name,
      reason: reason ?? null,
    });
  }
  if (saleId) {
    const sale = ctx.org.bootstrap.sales.find((row) => row.id === saleId);
    lead.saleId = saleId;
    lead.saleStatus = sale?.status ?? null;
    lead.saleCode = sale?.code ?? null;
  }
  lead.updatedAt = ctx.world.tick();
  return ok({ lead });
}

function advanceLead(ctx: RouteContext, lead: SalesOpsLead, body: Record<string, unknown>): Reply {
  const toStageId = str(body.toStageId) ?? '';
  const reason = nullable(body.reason) ?? undefined;
  const gate = gateMove(ctx, lead, toStageId, reason);
  if ('reply' in gate) return gate.reply;
  const { stage } = gate.target;
  const nextStep = nullable(body.nextStep);
  const dueOn = nullable(body.dueOn);
  const isExit = stage.type === 'saida';
  if ((!isExit && !(nextStep && dueOn)) || Boolean(nextStep) !== Boolean(dueOn)) {
    return badRequest('followup_required');
  }
  if (stageActsAsOrcamento(stage, ctx.org.modules)) {
    return json(409, { error: 'sale_required_for_conversion' });
  }
  const fromName = findStage(ctx.org, lead.stageId)?.stage.name ?? null;
  const at = ctx.world.tick();
  place(ctx, lead, toStageId, Number.MAX_SAFE_INTEGER);
  lead.stageChangedAt = at;
  lead.lostReason = stage.requiresReason ? (reason ?? null) : null;
  pushTimeline(ctx, lead.id, {
    kind: 'stage_changed',
    at,
    actorName: ctx.who.displayName,
    fromStageName: fromName,
    toStageName: stage.name,
    reason: reason ?? null,
  });
  const note = nullable(body.note);
  if (note) pushTimeline(ctx, lead.id, { kind: 'note', at, actorName: ctx.who.displayName, body: note });
  if (nextStep && dueOn) addFollowup(ctx, lead, nextStep, dueOn, null);
  lead.updatedAt = at;
  return ok({ lead });
}

function addFollowup(
  ctx: RouteContext,
  lead: SalesOpsLead,
  nextStep: string,
  dueOn: string,
  ownerPersonId: string | null,
) {
  const owner = ownerPersonId ?? lead.sellerPersonId ?? ctx.who.personId;
  const at = ctx.world.tick();
  const followup = {
    id: uuid(ctx.world, 17),
    leadId: lead.id,
    nextStep,
    dueOn,
    ownerPersonId: owner,
    ownerName: sellerNameOf(ctx.org, owner) || null,
    doneAt: null,
  };
  ctx.org.followups.push(followup);
  pushTimeline(ctx, lead.id, {
    kind: 'followup',
    at,
    actorName: ctx.who.displayName,
    nextStep,
    dueOn,
    doneAt: null,
  });
  return followup;
}

function createLead(ctx: RouteContext, body: Record<string, unknown>): Reply {
  const contactName = nullable(body.contactName);
  const contactPhone = nullable(body.contactPhone);
  const contactEmail = nullable(body.contactEmail);
  if (!contactName || !(contactPhone || contactEmail)) return badRequest('contact_required');
  const pipeline = ctx.org.pipelines.find((row) => row.id === str(body.pipelineId)) ?? defaultPipeline(ctx.org);
  const stage = pipeline.stages
    .filter((row) => row.status === 'active' && row.type === 'normal')
    .sort((a, b) => a.position - b.position)[0];
  if (!stage) return badRequest('no_open_stage');
  const requested = str(body.sellerPersonId) ?? null;
  if (!ctx.who.admin && requested && requested !== ctx.who.personId) {
    return json(403, { error: 'forbidden', reason: 'seller_scope' });
  }
  const sellerPersonId = ctx.who.admin ? requested : ctx.who.personId;
  const at = ctx.world.tick();
  const lead: SalesOpsLead = {
    id: uuid(ctx.world, 15),
    stageId: stage.id,
    position: 0,
    contactName,
    clientId: null,
    clientNameSnapshot: '',
    estimatedValueBrl: typeof body.estimatedValueBrl === 'number' ? body.estimatedValueBrl : 0,
    description: null,
    contactPhone,
    contactEmail: contactEmail?.toLowerCase() ?? null,
    contactBirthDate: null,
    sellerPersonId,
    sellerNameSnapshot: sellerNameOf(ctx.org, sellerPersonId),
    lostReason: null,
    stageChangedAt: at,
    saleId: null,
    saleStatus: null,
    saleCode: null,
    products: [],
    createdAt: at,
    updatedAt: null,
    pipelineId: pipeline.id,
    stageType: stage.type,
    stageExitKind: stage.exitKind,
    fields: [],
  };
  applyClient(ctx.org, lead, body);
  applyFields(ctx.org, lead, body.fields);
  ctx.org.leads.push(lead);
  place(ctx, lead, stage.id, Number.MAX_SAFE_INTEGER);
  pushTimeline(ctx, lead.id, {
    kind: 'stage_changed',
    at,
    actorName: ctx.who.displayName,
    fromStageName: null,
    toStageName: stage.name,
    reason: null,
  });
  return json(201, { lead });
}

function updateLead(ctx: RouteContext, lead: SalesOpsLead, body: Record<string, unknown>): Reply {
  if ('contactName' in body) {
    const name = nullable(body.contactName);
    if (!name) return badRequest('contact_required');
    lead.contactName = name;
  }
  if ('contactPhone' in body) lead.contactPhone = nullable(body.contactPhone);
  if ('contactEmail' in body) lead.contactEmail = nullable(body.contactEmail)?.toLowerCase() ?? null;
  if (typeof body.estimatedValueBrl === 'number') lead.estimatedValueBrl = body.estimatedValueBrl;
  if ('sellerPersonId' in body) {
    if (!ctx.who.admin) return json(403, { error: 'forbidden', reason: 'seller_scope' });
    lead.sellerPersonId = str(body.sellerPersonId) ?? null;
    lead.sellerNameSnapshot = sellerNameOf(ctx.org, lead.sellerPersonId);
  }
  applyClient(ctx.org, lead, body);
  applyFields(ctx.org, lead, body.fields);
  lead.updatedAt = ctx.world.tick();
  return ok({ lead });
}

function summaryOf(ctx: RouteContext, lead: SalesOpsLead): Reply {
  const found = findStage(ctx.org, lead.stageId);
  if (!found) return notFound();
  const { pipeline, stage } = found;
  const nextStages: LeadNextStage[] = pipeline.transitions
    .filter((transition) => transition.fromStageId === stage.id)
    .map((transition) => pipeline.stages.find((candidate) => candidate.id === transition.toStageId))
    .filter((target): target is CrmPipelineStage => target !== undefined && target.status === 'active')
    .map((target) => projectStage(ctx.org, target))
    .map((target) => ({
      id: target.id,
      name: target.name,
      type: target.type,
      exitKind: target.exitKind,
      requiresReason: target.requiresReason,
    }));
  const body: LeadSummaryResponse = {
    lead,
    pipeline: { id: pipeline.id, name: pipeline.name },
    stage: { id: stage.id, name: stage.name, type: stage.type, exitKind: stage.exitKind },
    nextStages,
    timeline: [...(ctx.org.timeline[lead.id] ?? [])].sort((a, b) => b.at.localeCompare(a.at)),
    followups: ctx.org.followups
      .filter((followup) => followup.leadId === lead.id)
      .map(({ id, nextStep, dueOn, ownerName, doneAt }) => ({ id, nextStep, dueOn, ownerName, doneAt })),
  };
  return ok(body);
}

function listLeads(ctx: RouteContext): Reply {
  const { query } = ctx.req;
  for (const key of query.keys()) {
    if (key.startsWith('f.')) {
      return notInFixtures(ctx.req, ctx.caller, `the dynamic filter "${key}" is not seeded`);
    }
  }
  const stageId = query.get('stageId');
  if (!stageId) return badRequest('stage_required');
  const limit = Number(query.get('limit') ?? 50);
  const seller = query.get('sellerPersonId');
  const cursor = query.get('cursor');
  let rows = scoped(ctx)
    .filter((lead) => lead.stageId === stageId)
    .filter((lead) => !seller || lead.sellerPersonId === seller)
    .filter((lead) => inPeriod(lead, query.get('from'), query.get('to')))
    .sort(byPosition);
  if (cursor) {
    const [position, id] = cursor.split(':');
    rows = rows.filter(
      (lead) => lead.position > Number(position) || (lead.position === Number(position) && lead.id > (id ?? '')),
    );
  }
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last ? `${last.position}:${last.id}` : null;
  return ok({ leads: page, nextCursor });
}

function stageSummary(ctx: RouteContext): Reply {
  const { query } = ctx.req;
  const seller = query.get('sellerPersonId');
  const totals = new Map<string, { count: number; estimatedValueBrl: number }>();
  for (const lead of scoped(ctx)) {
    if (seller && lead.sellerPersonId !== seller) continue;
    if (query.get('pipelineId') && lead.pipelineId !== query.get('pipelineId')) continue;
    if (!inPeriod(lead, query.get('from'), query.get('to'))) continue;
    const row = totals.get(lead.stageId) ?? { count: 0, estimatedValueBrl: 0 };
    row.count += 1;
    row.estimatedValueBrl += lead.estimatedValueBrl;
    totals.set(lead.stageId, row);
  }
  return ok({ stages: [...totals].map(([stageId, row]) => ({ stageId, ...row })) });
}

function deleteLead(ctx: RouteContext, lead: SalesOpsLead): Reply {
  if (lead.saleId) return json(409, { error: 'lead_already_converted' });
  ctx.org.leads = ctx.org.leads.filter((other) => other.id !== lead.id);
  renumber(ctx.org.leads.filter((other) => other.stageId === lead.stageId).sort(byPosition));
  ctx.org.deletedLeads.unshift({ lead, deletedAt: ctx.world.tick(), deletedByName: ctx.who.displayName });
  return noContent();
}

function restoreLead(ctx: RouteContext, id: string | undefined): Reply {
  if (!ctx.who.admin) return forbiddenAdmin();
  const entry = ctx.org.deletedLeads.find((row) => row.lead.id === id);
  if (!entry) return notFound();
  const found = findStage(ctx.org, entry.lead.stageId);
  if (!found || found.stage.status === 'archived') return badRequest('no_open_stage');
  ctx.org.deletedLeads = ctx.org.deletedLeads.filter((row) => row !== entry);
  ctx.org.leads.push(entry.lead);
  place(ctx, entry.lead, entry.lead.stageId, Number.MAX_SAFE_INTEGER);
  return ok({ lead: entry.lead });
}

function deletedLeads(ctx: RouteContext): Reply {
  if (!ctx.who.admin) return forbiddenAdmin();
  const items = ctx.org.deletedLeads.map(({ lead, deletedAt, deletedByName }) => ({
    id: lead.id,
    contactName: lead.contactName,
    clientName: lead.clientNameSnapshot,
    stageName: findStage(ctx.org, lead.stageId)?.stage.name ?? '',
    sellerName: lead.sellerNameSnapshot,
    estimatedValueBrl: lead.estimatedValueBrl,
    deletedAt,
    deletedByName,
  }));
  return ok({ items, nextCursor: null });
}

function listFollowups(ctx: RouteContext): Reply {
  const { query } = ctx.req;
  const scope = query.get('scope') ?? 'mine';
  const status = query.get('status') ?? 'open';
  if (scope === 'team' && !ctx.who.admin) return forbiddenAdmin();
  const from = query.get('from');
  const to = query.get('to');
  const rows = ctx.org.followups
    .filter((followup) => scope === 'team' || followup.ownerPersonId === ctx.who.personId)
    .filter((followup) => status === 'all' || (status === 'done') === (followup.doneAt !== null))
    .filter((followup) => (!from || followup.dueOn >= from) && (!to || followup.dueOn <= to))
    .map((followup) => {
      const lead = ctx.org.leads.find((row) => row.id === followup.leadId);
      return lead && visibleTo(ctx, lead)
        ? {
            id: followup.id,
            leadId: followup.leadId,
            leadContactName: lead.contactName,
            nextStep: followup.nextStep,
            dueOn: followup.dueOn,
            ownerName: followup.ownerName,
            doneAt: followup.doneAt,
          }
        : null;
    })
    .filter((row) => row !== null)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  return ok({ followups: rows });
}

/** `leads`, `lead-stages`, `pipelines`, `field-definitions` and `followups`. Null when the route is not one of these. */
export function leadsRoute(ctx: RouteContext): Reply | null {
  const { segments, req } = ctx;
  const [head, second, third] = segments;
  const body = asRecord(req.body);
  const method = req.method;

  if (head === 'pipelines' && method === 'GET' && !second) return ok({ pipelines: projectPipelines(ctx.org) });
  if (head === 'field-definitions' && method === 'GET' && !second) {
    return ok({ fields: ctx.org.fieldDefinitions });
  }
  if (head === 'lead-stages') return stagesRoute(ctx, segments.slice(1), body);
  if (head === 'followups') {
    if (method === 'GET' && !second) return listFollowups(ctx);
    if (method === 'POST' && second && third === 'done') {
      const followup = ctx.org.followups.find((row) => row.id === second);
      if (!followup) return notFound();
      followup.doneAt ??= ctx.world.tick();
      return ok({ followup });
    }
    return null;
  }
  if (head !== 'leads') return null;

  if (!second) {
    if (method === 'GET') return listLeads(ctx);
    if (method === 'POST') return createLead(ctx, body);
    return null;
  }
  if (second === 'summary' && method === 'GET') return stageSummary(ctx);
  if (second === 'deleted' && method === 'GET') return deletedLeads(ctx);
  if (third === 'restore' && method === 'POST') return restoreLead(ctx, second);

  const lead = leadById(ctx, second);
  if (!third) {
    if (method === 'PATCH') return lead ? updateLead(ctx, lead, body) : notFound();
    return null;
  }
  if (method === 'GET' && third === 'summary') return lead ? summaryOf(ctx, lead) : notFound();
  if (method !== 'POST') return null;
  if (!lead) return notFound();
  if (third === 'move') return moveLead(ctx, lead, body);
  if (third === 'advance') return advanceLead(ctx, lead, body);
  if (third === 'delete') return deleteLead(ctx, lead);
  if (third === 'notes') {
    const text = nullable(body.body);
    if (!text) return badRequest('body_required');
    pushTimeline(ctx, lead.id, { kind: 'note', at: ctx.world.tick(), actorName: ctx.who.displayName, body: text });
    return json(201, { ok: true });
  }
  if (third === 'followups') {
    const nextStep = nullable(body.nextStep);
    const dueOn = nullable(body.dueOn);
    if (!nextStep || !dueOn) return badRequest('followup_required');
    return json(201, { followup: addFollowup(ctx, lead, nextStep, dueOn, str(body.ownerPersonId) ?? null) });
  }
  return null;
}

function stagesRoute(ctx: RouteContext, rest: string[], body: Record<string, unknown>): Reply | null {
  const { method } = ctx.req;
  const pipeline = defaultPipeline(ctx.org);
  const legacy = () => pipeline.stages.map((stage) => legacyStage(ctx.org, pipeline, stage));
  const [id] = rest;
  if (!id && method === 'GET') return ok({ stages: legacy() });
  if (!ctx.who.admin) return forbiddenAdmin();
  if (id === 'reorder' && method === 'POST') {
    const ids = Array.isArray(body.stageIds) ? body.stageIds.filter((x): x is string => typeof x === 'string') : [];
    ids.forEach((stageId, index) => {
      const stage = pipeline.stages.find((row) => row.id === stageId);
      if (stage) stage.position = index + 1;
    });
    pipeline.stages.sort((a, b) => a.position - b.position);
    return ok({ stages: legacy() });
  }
  if (!id && method === 'POST') {
    const name = nullable(body.name);
    if (!name) return badRequest('name_required');
    const stage: CrmPipelineStage = {
      id: uuid(ctx.world, 14),
      name,
      position: pipeline.stages.length + 1,
      type: 'normal',
      behavior: 'none',
      exitKind: null,
      requiresReason: false,
      status: 'active',
    };
    pipeline.stages.push(stage);
    const open = pipeline.stages.filter((row) => row.type !== 'saida' && row.id !== stage.id);
    const previous = open[open.length - 1];
    if (previous) {
      pipeline.transitions.push({ fromStageId: previous.id, toStageId: stage.id });
      pipeline.transitions.push({ fromStageId: stage.id, toStageId: previous.id });
    }
    for (const exit of pipeline.stages.filter((row) => row.type === 'saida')) {
      pipeline.transitions.push({ fromStageId: stage.id, toStageId: exit.id });
    }
    return json(201, { stage: legacyStage(ctx.org, pipeline, stage) });
  }
  if (id && method === 'PATCH') {
    const stage = pipeline.stages.find((row) => row.id === id);
    if (!stage) return notFound();
    const name = nullable(body.name);
    if (name) stage.name = name;
    if (body.status === 'active' || body.status === 'archived') stage.status = body.status;
    return ok({ stage: legacyStage(ctx.org, pipeline, stage) });
  }
  return null;
}
