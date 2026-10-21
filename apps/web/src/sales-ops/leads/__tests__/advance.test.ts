import { describe, expect, it } from 'vitest';
import type { LeadNextStage } from '../crm-types';
import {
  ADVANCE_COPY,
  advanceErrorCopy,
  advanceNeeds,
  buildAdvancePayload,
  validateAdvance,
  type AdvanceDraft,
} from '../advance';

const TODAY = '2026-10-20';
const stage = (overrides: Partial<LeadNextStage>): LeadNextStage => ({
  id: 'stage-x', name: 'Etapa', type: 'normal', exitKind: null, requiresReason: false, ...overrides,
});
const draft = (overrides: Partial<AdvanceDraft> = {}): AdvanceDraft => ({
  toStageId: 'stage-x', nextStep: '', dueOn: '', note: '', reason: '', ...overrides,
});

describe('advanceNeeds', () => {
  it('a normal stage needs a follow-up', () => {
    expect(advanceNeeds(stage({ type: 'normal' }), false)).toEqual({ followup: true, reason: false, conversion: false });
  });

  it('an orcamento stage that opens the conversion needs no follow-up, only the conversion', () => {
    expect(advanceNeeds(stage({ type: 'orcamento' }), true)).toEqual({ followup: false, reason: false, conversion: true });
  });

  it('a ganho exit needs nothing', () => {
    expect(advanceNeeds(stage({ type: 'saida', exitKind: 'ganho' }), false)).toEqual({ followup: false, reason: false, conversion: false });
  });

  it('a perdido exit with requiresReason needs only the reason', () => {
    expect(advanceNeeds(stage({ type: 'saida', exitKind: 'perdido', requiresReason: true }), false))
      .toEqual({ followup: false, reason: true, conversion: false });
  });

  it('no destination needs nothing', () => {
    expect(advanceNeeds(undefined, false)).toEqual({ followup: false, reason: false, conversion: false });
  });
});

describe('validateAdvance', () => {
  const normal = stage({ type: 'normal' });

  it('asks for a destination first', () => {
    expect(validateAdvance(undefined, false, draft({ toStageId: null }), TODAY)).toBe(ADVANCE_COPY.noDestination);
  });

  it('asks for the next step, then the date', () => {
    expect(validateAdvance(normal, false, draft(), TODAY)).toBe(ADVANCE_COPY.nextStepRequired);
    expect(validateAdvance(normal, false, draft({ nextStep: 'Ligar' }), TODAY)).toBe(ADVANCE_COPY.dueOnRequired);
    expect(validateAdvance(normal, false, draft({ nextStep: 'Ligar', dueOn: '2026-02-30' }), TODAY)).toBe(ADVANCE_COPY.dueOnRequired);
  });

  it('refuses a date before today', () => {
    expect(validateAdvance(normal, false, draft({ nextStep: 'Ligar', dueOn: '2026-10-19' }), TODAY)).toBe(ADVANCE_COPY.dueOnPast);
    expect(validateAdvance(normal, false, draft({ nextStep: 'Ligar', dueOn: TODAY }), TODAY)).toBeNull();
  });

  it('asks for the reason when the destination requires one', () => {
    const lost = stage({ type: 'saida', exitKind: 'perdido', requiresReason: true });
    expect(validateAdvance(lost, false, draft(), TODAY)).toBe(ADVANCE_COPY.reasonRequired);
    expect(validateAdvance(lost, false, draft({ reason: 'Preço' }), TODAY)).toBeNull();
  });

  it('an exit with nothing typed is valid, and a conversion is never validated here', () => {
    expect(validateAdvance(stage({ type: 'saida', exitKind: 'ganho' }), false, draft(), TODAY)).toBeNull();
    expect(validateAdvance(stage({ type: 'orcamento' }), true, draft(), TODAY)).toBeNull();
  });
});

describe('buildAdvancePayload', () => {
  it('omits nextStep and dueOn for an exit and carries the trimmed note', () => {
    const needs = advanceNeeds(stage({ type: 'saida', exitKind: 'ganho' }), false);
    expect(buildAdvancePayload('stage-x', draft({ nextStep: 'ignored', dueOn: TODAY, note: '  Fechou  ' }), needs))
      .toEqual({ toStageId: 'stage-x', note: 'Fechou' });
  });

  it('sends the next step, the date and no note when the note is blank', () => {
    const needs = advanceNeeds(stage({ type: 'normal' }), false);
    expect(buildAdvancePayload('stage-x', draft({ nextStep: '  Ligar  ', dueOn: TODAY }), needs))
      .toEqual({ toStageId: 'stage-x', nextStep: 'Ligar', dueOn: TODAY });
  });
});

describe('advanceErrorCopy', () => {
  it('maps the five refusals and falls back', () => {
    expect(advanceErrorCopy({ status: 409, error: 'transition_not_allowed' })).toBe(ADVANCE_COPY.notAllowed);
    expect(advanceErrorCopy({ status: 409, error: 'sale_required_for_conversion' })).toBe(ADVANCE_COPY.conversionNeeded);
    expect(advanceErrorCopy({ status: 400, error: 'validation_error', reason: 'followup_required' })).toBe(ADVANCE_COPY.nextStepRequired);
    expect(advanceErrorCopy({ status: 400, error: 'validation_error', reason: 'reason_required' })).toBe(ADVANCE_COPY.reasonRequired);
    expect(advanceErrorCopy({ status: 500 })).toBe(ADVANCE_COPY.failed);
    expect(advanceErrorCopy(new Error('network'))).toBe(ADVANCE_COPY.failed);
  });
});
