/**
 * Read-only. Turns the live, unconverted leads of ONE organization (and the clientes they point at) into rows
 * keyed by the column keys of workbook-schema.ts, so `createTemplateWorkbook` writes them under the import's own
 * headers. The export never emits a row the import would refuse: when that cannot be guaranteed it throws a
 * LeadsExportError the route answers as a 409 with a sentence for the operator.
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import {
  salesOpsClients,
  salesOpsCrmLeadFieldValues,
  salesOpsCrmLeads,
  salesOpsFieldDefinitions,
  salesOpsPeople,
  salesOpsPipelineStages,
} from '../../db/schema.js';
import { liveLeadCondition } from '../sales-ops/leads/lead-service.js';
import type { Db } from '../sales-ops/service.js';
import type { ExampleRow } from './template.js';
import { MAX_TOTAL_ROWS, getSheetDef } from './workbook-schema.js';

export type LeadsExportRows = { leads: ExampleRow[]; clientes: ExampleRow[] };

export type LeadsExportErrorReason = 'export_too_large' | 'lead_without_company';

export class LeadsExportError extends Error {
  constructor(
    readonly reason: LeadsExportErrorReason,
    message: string,
  ) {
    super(message);
  }
}

function tooLarge(total: number): LeadsExportError {
  return new LeadsExportError(
    'export_too_large',
    `A organização tem ${total} linhas entre leads e clientes, e a importação aceita no máximo ${MAX_TOTAL_ROWS}; exporte em partes excluindo leads antes, pois um arquivo maior seria recusado.`,
  );
}

function overSheetLimit(count: number, sheet: 'leads' | 'clientes'): boolean {
  return count > getSheetDef(sheet).maxRows;
}

export async function readLeadsExport(tx: Db, orgId: string): Promise<LeadsExportRows> {
  const leads = await tx
    .select({
      id: salesOpsCrmLeads.id,
      contactName: salesOpsCrmLeads.contactName,
      clientId: salesOpsCrmLeads.clientId,
      clientName: salesOpsClients.name,
      clientNameSnapshot: salesOpsCrmLeads.clientNameSnapshot,
      estimatedValueBrl: salesOpsCrmLeads.estimatedValueBrl,
      lostReason: salesOpsCrmLeads.lostReason,
      sellerName: salesOpsPeople.displayName,
      stageName: salesOpsPipelineStages.name,
      stageType: salesOpsPipelineStages.type,
      stageExitKind: salesOpsPipelineStages.exitKind,
      stageStatus: salesOpsPipelineStages.status,
    })
    .from(salesOpsCrmLeads)
    .leftJoin(
      salesOpsClients,
      and(eq(salesOpsClients.orgId, salesOpsCrmLeads.orgId), eq(salesOpsClients.id, salesOpsCrmLeads.clientId)),
    )
    .leftJoin(
      salesOpsPeople,
      and(eq(salesOpsPeople.orgId, salesOpsCrmLeads.orgId), eq(salesOpsPeople.id, salesOpsCrmLeads.sellerPersonId)),
    )
    .innerJoin(
      salesOpsPipelineStages,
      and(
        eq(salesOpsPipelineStages.orgId, salesOpsCrmLeads.orgId),
        eq(salesOpsPipelineStages.id, salesOpsCrmLeads.stageId),
      ),
    )
    .where(and(eq(salesOpsCrmLeads.orgId, orgId), liveLeadCondition(), isNull(salesOpsCrmLeads.saleId)))
    .orderBy(asc(salesOpsCrmLeads.createdAt), asc(salesOpsCrmLeads.id));

  const clientIds = [...new Set(leads.flatMap((l) => (l.clientId === null ? [] : [l.clientId])))];
  if (overSheetLimit(leads.length, 'leads') || leads.length + clientIds.length > MAX_TOTAL_ROWS) {
    throw tooLarge(leads.length + clientIds.length);
  }

  const unnamed = leads.filter((l) => (l.clientName ?? l.clientNameSnapshot).trim() === '');
  if (unnamed.length > 0) {
    throw new LeadsExportError(
      'lead_without_company',
      `${unnamed.length} lead(s) não têm empresa, e a coluna Empresa é obrigatória na importação; preencha a empresa desses leads antes de exportar.`,
    );
  }

  const clientes = clientIds.length === 0 ? [] : await readClientes(tx, orgId, clientIds);
  if (overSheetLimit(clientes.length, 'clientes')) throw tooLarge(leads.length + clientes.length);

  const values = await readFieldValues(
    tx,
    orgId,
    leads.map((l) => l.id),
  );

  const rows = leads.map((lead): ExampleRow => {
    // Etapas the import refuses (the conversion etapa, an archived one) are left blank: the lead enters the first etapa.
    const stageImportable = lead.stageType !== 'orcamento' && lead.stageStatus === 'active';
    const lost = stageImportable && lead.stageExitKind === 'perdido';
    const fields = values.get(lead.id);
    return {
      contato: lead.contactName,
      empresa: (lead.clientName ?? lead.clientNameSnapshot).trim(),
      valorEstimado: lead.estimatedValueBrl > 0 ? lead.estimatedValueBrl : null,
      descricao: fields?.descricao ?? null,
      vendedor: lead.sellerName ?? null,
      produtos: fields !== undefined && fields.produtos.length > 0 ? fields.produtos : null,
      etapa: stageImportable ? lead.stageName : null,
      motivoPerda: lost ? (lead.lostReason ?? null) : null,
    };
  });
  return { leads: rows, clientes };
}

async function readClientes(tx: Db, orgId: string, clientIds: string[]): Promise<ExampleRow[]> {
  const rows = await tx
    .select()
    .from(salesOpsClients)
    .where(and(eq(salesOpsClients.orgId, orgId), inArray(salesOpsClients.id, clientIds)))
    .orderBy(asc(salesOpsClients.name), asc(salesOpsClients.id));
  return rows.map(
    (c): ExampleRow => ({
      nome: c.name,
      contato: c.contact,
      razaoSocial: c.legalName,
      documento: c.document,
      endereco: c.address,
      representante: c.legalRepName,
      documentoRepresentante: c.legalRepDocument,
    }),
  );
}

type LeadFields = { descricao: string | null; produtos: string[] };

/** The `descricao` and `produtos` field values of the given leads; a product reads by its snapshot name, a free item by its text. */
async function readFieldValues(tx: Db, orgId: string, leadIds: string[]): Promise<Map<string, LeadFields>> {
  const out = new Map<string, LeadFields>();
  if (leadIds.length === 0) return out;
  const rows = await tx
    .select({
      leadId: salesOpsCrmLeadFieldValues.leadId,
      key: salesOpsFieldDefinitions.key,
      valueText: salesOpsCrmLeadFieldValues.valueText,
      snapshot: salesOpsCrmLeadFieldValues.refNameSnapshot,
    })
    .from(salesOpsCrmLeadFieldValues)
    .innerJoin(
      salesOpsFieldDefinitions,
      and(
        eq(salesOpsFieldDefinitions.orgId, salesOpsCrmLeadFieldValues.orgId),
        eq(salesOpsFieldDefinitions.id, salesOpsCrmLeadFieldValues.fieldId),
      ),
    )
    .where(
      and(
        eq(salesOpsCrmLeadFieldValues.orgId, orgId),
        inArray(salesOpsCrmLeadFieldValues.leadId, leadIds),
        inArray(salesOpsFieldDefinitions.key, ['descricao', 'produtos']),
      ),
    )
    .orderBy(asc(salesOpsCrmLeadFieldValues.leadId), asc(salesOpsCrmLeadFieldValues.position));
  for (const row of rows) {
    const entry = out.get(row.leadId) ?? { descricao: null, produtos: [] };
    if (row.key === 'descricao') {
      const text = row.valueText?.trim() ?? '';
      entry.descricao = text === '' ? null : text;
    } else {
      const name = (row.snapshot ?? row.valueText ?? '').trim();
      if (name !== '') entry.produtos.push(name);
    }
    out.set(row.leadId, entry);
  }
  return out;
}
