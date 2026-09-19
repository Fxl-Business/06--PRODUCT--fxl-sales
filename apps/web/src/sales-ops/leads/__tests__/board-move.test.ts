import { describe, expect, it } from 'vitest';
import {
  buildMovePayload,
  describeDaysInStage,
  moveTargetsFor,
  movePositionOptions,
  stageOpensConversion,
  validateMove,
} from '../board-move';
import type { SalesOpsLead, SalesOpsLeadStage, LeadStageKind } from '../types';

/**
 * The pure move layer.
 *
 * The distinction these oracles exist to protect is that READ-ONLY IS A PROPERTY
 * OF THE CARD and never of a column: `leadIsConverted(lead)` is the whole of it.
 * The single `kind: 'conversion'` stage has two different roles depending on
 * direction - as a SOURCE it is unremarkable, because its cards are already
 * refused by the card rule, and as a DESTINATION it is a legitimate target that
 * hands back to the proposta wizard instead of moving the card. Oracles 1 and 2
 * are a pair precisely so a `moveTargetsFor` that keyed the refusal on the STAGE
 * cannot pass.
 */

const NOVO_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const NEGOCIACAO_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const CONVERSAO_ID = 'aaaaaaaa-0000-4000-8000-000000000003';
const PERDIDO_ID = 'aaaaaaaa-0000-4000-8000-000000000004';

function stage(
  id: string,
  name: string,
  kind: LeadStageKind,
  position: number,
): SalesOpsLeadStage {
  return {
    id,
    orgId: 'org-test',
    name,
    position,
    kind,
    isSystem: kind !== 'normal',
    status: 'active',
    archivedAt: null,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
  };
}

const NOVO = stage(NOVO_ID, 'Novo', 'normal', 1);
const NEGOCIACAO = stage(NEGOCIACAO_ID, 'Negociação', 'normal', 2);
const CONVERSAO = stage(CONVERSAO_ID, 'Proposta enviada', 'conversion', 3);
const PERDIDO = stage(PERDIDO_ID, 'Perdido', 'lost', 4);
const stages = [NOVO, NEGOCIACAO, CONVERSAO, PERDIDO];

function lead(
  id: string,
  contactName: string,
  stageId: string,
  patch: Partial<SalesOpsLead> = {},
): SalesOpsLead {
  return {
    id,
    stageId,
    position: 1,
    contactName,
    clientId: null,
    clientNameSnapshot: 'Empresa livre',
    estimatedValueBrl: 250_000,
    description: null,
    sellerPersonId: null,
    sellerNameSnapshot: '',
    lostReason: null,
    stageChangedAt: '2026-09-15T12:00:00.000Z',
    saleId: null,
    saleStatus: null,
    products: [],
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

const LEAD_A = 'bbbbbbbb-0000-4000-8000-00000000000a';
const LEAD_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const LEAD_C = 'bbbbbbbb-0000-4000-8000-00000000000c';

describe('moveTargetsFor', () => {
  it('offers no move target at all for a converted lead', () => {
    const converted = lead(LEAD_A, 'Ana', CONVERSAO_ID, {
      saleId: 'cccccccc-0000-4000-8000-00000000000f',
      saleStatus: 'won',
    });

    expect(moveTargetsFor(converted, stages, true)).toEqual([]);
    expect(moveTargetsFor(converted, stages, false)).toEqual([]);
  });

  it('still offers every target for a NON-converted lead sitting in the conversion stage', () => {
    // The pair to the oracle above. A refusal keyed on the STAGE would return []
    // here too, and this is the only thing that catches it.
    const parked = lead(LEAD_B, 'Bruno', CONVERSAO_ID);

    expect(moveTargetsFor(parked, stages, true).map((row) => row.id)).toEqual([
      NOVO_ID,
      NEGOCIACAO_ID,
      CONVERSAO_ID,
      PERDIDO_ID,
    ]);
  });

  it('hides the conversion door when no conversion handler is attached', () => {
    const open = lead(LEAD_A, 'Ana', NOVO_ID);

    expect(moveTargetsFor(open, stages, false).map((row) => row.id)).toEqual([
      NOVO_ID,
      NEGOCIACAO_ID,
      PERDIDO_ID,
    ]);
  });

  it('offers the conversion door as an ordinary target when a conversion handler is attached', () => {
    const open = lead(LEAD_A, 'Ana', NOVO_ID);

    expect(moveTargetsFor(open, stages, true).map((row) => row.id)).toContain(CONVERSAO_ID);
  });
});

describe('stageOpensConversion', () => {
  it('is true only for the conversion stage, and false for undefined', () => {
    expect(stageOpensConversion(CONVERSAO)).toBe(true);
    expect(stageOpensConversion(NOVO)).toBe(false);
    expect(stageOpensConversion(PERDIDO)).toBe(false);
    expect(stageOpensConversion(undefined)).toBe(false);
  });
});

describe('movePositionOptions', () => {
  const CARD_A = lead(LEAD_A, 'Ana', NOVO_ID, { position: 1 });
  const CARD_B = lead(LEAD_B, 'Bruno', NOVO_ID, { position: 2 });
  const CARD_C = lead(LEAD_C, 'Carla', NOVO_ID, { position: 3 });
  const column = [CARD_A, CARD_B, CARD_C];

  it("offers the lead's own column as a target, without its own current slot", () => {
    const options = movePositionOptions(CARD_B, NOVO_ID, column);

    // Three cards in the column, so exactly two reachable slots: the lead's own
    // post-removal insertion index is where it already is, and is not a move.
    expect(options).toHaveLength(column.length - 1);
    expect(options.map((option) => option.label)).toEqual([
      'Início da coluna',
      'Depois de Carla',
    ]);
    expect(options.map((option) => option.index)).toEqual([0, 2]);
  });

  it('offers one more slot than the column holds when the destination is another column', () => {
    const moving = lead(LEAD_A, 'Ana', NEGOCIACAO_ID);
    const options = movePositionOptions(moving, NOVO_ID, column);

    expect(options).toHaveLength(column.length + 1);
    expect(options.map((option) => option.label)).toEqual([
      'Início da coluna',
      'Depois de Ana',
      'Depois de Bruno',
      'Depois de Carla',
    ]);
  });

  it('labels positions by contact name and never by id', () => {
    const options = movePositionOptions(CARD_A, NEGOCIACAO_ID, column);
    const rendered = options.map((option) => option.label).join(' | ');

    for (const id of [LEAD_A, LEAD_B, LEAD_C, NOVO_ID, NEGOCIACAO_ID]) {
      expect(rendered).not.toContain(id);
    }
  });
});

describe('validateMove', () => {
  it('asks for a destination, then for a position, in that order', () => {
    expect(validateMove({ targetStage: null, targetIndex: null, reason: '' })).toBe(
      'Escolha a etapa de destino.',
    );
    expect(validateMove({ targetStage: NOVO, targetIndex: null, reason: '' })).toBe(
      'Escolha a posição na coluna.',
    );
    expect(validateMove({ targetStage: NOVO, targetIndex: 0, reason: '' })).toBeNull();
  });

  it('refuses a move into a lost stage with a blank or whitespace-only reason', () => {
    expect(validateMove({ targetStage: PERDIDO, targetIndex: 0, reason: '' })).toBe(
      'Informe o motivo da perda.',
    );
    expect(validateMove({ targetStage: PERDIDO, targetIndex: 0, reason: '   ' })).toBe(
      'Informe o motivo da perda.',
    );
    expect(
      validateMove({ targetStage: PERDIDO, targetIndex: 0, reason: 'sem verba' }),
    ).toBeNull();
  });

  it('keys the reason requirement on the stage kind and not on its name', () => {
    const namedPerdido = stage(NOVO_ID, 'Perdido', 'normal', 1);
    const namedArquivado = stage(PERDIDO_ID, 'Arquivado', 'lost', 4);

    expect(validateMove({ targetStage: namedPerdido, targetIndex: 0, reason: '' })).toBeNull();
    expect(validateMove({ targetStage: namedArquivado, targetIndex: 0, reason: '' })).toBe(
      'Informe o motivo da perda.',
    );
  });
});

describe('buildMovePayload', () => {
  it('sends the trimmed reason into a lost stage', () => {
    const payload = buildMovePayload({
      lead: lead(LEAD_A, 'Ana', NOVO_ID),
      targetStage: PERDIDO,
      targetIndex: 2,
      reason: '  orçamento apertado  ',
    });

    expect(payload).toEqual({
      leadId: LEAD_A,
      toStageId: PERDIDO_ID,
      toIndex: 2,
      reason: 'orçamento apertado',
    });
  });

  it('drops the reason when the destination is not a lost stage', () => {
    const payload = buildMovePayload({
      lead: lead(LEAD_A, 'Ana', NOVO_ID),
      targetStage: NEGOCIACAO,
      targetIndex: 0,
      reason: 'digitado e depois re-mirado',
    });

    expect(payload.reason).toBeNull();
    expect(payload.toStageId).toBe(NEGOCIACAO_ID);
  });

  it('throws rather than building a payload the gate would have refused', () => {
    expect(() =>
      buildMovePayload({
        lead: lead(LEAD_A, 'Ana', NOVO_ID),
        targetStage: PERDIDO,
        targetIndex: 0,
        reason: '   ',
      }),
    ).toThrow('Informe o motivo da perda.');
  });
});

describe('describeDaysInStage', () => {
  it('describes zero, one and many days in pt-BR', () => {
    expect(describeDaysInStage(0)).toBe('hoje');
    expect(describeDaysInStage(1)).toBe('há 1 dia');
    expect(describeDaysInStage(2)).toBe('há 2 dias');
    expect(describeDaysInStage(31)).toBe('há 31 dias');
  });
});
