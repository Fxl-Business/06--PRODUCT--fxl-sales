import {
  DEFAULT_PIPELINE_NAME,
  DEFAULT_PIPELINE_STAGES,
} from '@fxl-sales/shared-utils/default-pipeline';
import {
  defaultStageBehavior,
  defaultStageRequiresReason,
  planPipelineTransitions,
} from '@fxl-sales/shared-utils/crm-model';
import type { CrmPipeline, FieldDefinition } from '@/sales-ops/leads/crm-types';
import { fid } from './support';

/** The seven etapas of the default CRM pipeline, with the graph the real seed derives from them. */
export function buildPipeline(orgNumber: number): CrmPipeline {
  const stages = DEFAULT_PIPELINE_STAGES.map((stage) => ({
    id: fid('stage', orgNumber * 100 + stage.order),
    name: stage.label,
    position: stage.order,
    type: stage.type,
    behavior: defaultStageBehavior(stage),
    exitKind: stage.exitKind,
    requiresReason: defaultStageRequiresReason(stage),
    status: 'active' as const,
  }));
  const transitions = planPipelineTransitions(
    stages.map((stage) => ({ ...stage })),
  ).map(([fromStageId, toStageId]) => ({ fromStageId, toStageId }));
  return {
    id: fid('pipeline', orgNumber),
    name: DEFAULT_PIPELINE_NAME,
    isDefault: true,
    position: 1,
    status: 'active',
    stages,
    transitions,
  };
}

/** The Cliente system field plus the org's free fields, as `GET /field-definitions` answers. */
export function buildFieldDefinitions(orgNumber: number): FieldDefinition[] {
  const base = orgNumber * 100;
  return [
    {
      id: fid('field', base + 1),
      key: 'cliente',
      label: 'Cliente',
      kind: 'reference',
      referenceTarget: 'cliente',
      multiple: false,
      options: null,
      filterable: true,
      isSystem: true,
      removable: false,
      position: 1,
    },
    {
      id: fid('field', base + 2),
      key: 'descricao',
      label: 'Descrição',
      kind: 'text',
      referenceTarget: null,
      multiple: false,
      options: null,
      filterable: false,
      isSystem: true,
      removable: true,
      position: 2,
    },
    {
      id: fid('field', base + 3),
      key: 'nascimento',
      label: 'Nascimento',
      kind: 'date',
      referenceTarget: null,
      multiple: false,
      options: null,
      filterable: false,
      isSystem: true,
      removable: true,
      position: 3,
    },
    {
      id: fid('field', base + 4),
      key: 'produtos',
      label: 'Produtos',
      kind: 'reference',
      referenceTarget: 'produto',
      multiple: true,
      options: null,
      filterable: false,
      isSystem: true,
      removable: true,
      position: 4,
    },
    {
      id: fid('field', base + 5),
      key: 'origem',
      label: 'Origem',
      kind: 'options',
      referenceTarget: null,
      multiple: false,
      options: [
        { key: 'indicacao', label: 'Indicação' },
        { key: 'site', label: 'Site' },
        { key: 'evento', label: 'Evento' },
      ],
      filterable: true,
      isSystem: false,
      removable: true,
      position: 5,
    },
  ];
}
