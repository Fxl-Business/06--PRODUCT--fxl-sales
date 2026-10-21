import { describe, expect, it } from 'vitest';
import type { LeadStageKind } from '../types';
import { avatarInitials, dayBadgeTone, stageColors, stageIsNormal } from '../board-ui';

const stage = (id: string, kind: LeadStageKind) => ({ id, kind });

describe('stageColors', () => {
  it('cycles the normal palette by order and pins conversion/lost by kind', () => {
    const map = stageColors([
      stage('a', 'normal'),
      stage('b', 'normal'),
      stage('c', 'normal'),
      stage('d', 'normal'),
      stage('e', 'conversion'),
      stage('f', 'lost'),
    ]);
    expect(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => map.get(id)?.dot)).toEqual([
      '#4f63d8',
      '#8656d0',
      '#d07a1f',
      '#22928f',
      '#2f9155',
      '#c2413b',
    ]);
  });

  it('wraps after four normal stages', () => {
    const map = stageColors(['a', 'b', 'c', 'd', 'e'].map((id) => stage(id, 'normal')));
    expect(map.get('e')?.dot).toBe('#4f63d8');
  });

  it('does not let conversion or lost consume a cycle index', () => {
    const map = stageColors([stage('a', 'normal'), stage('b', 'conversion'), stage('c', 'normal')]);
    expect(['a', 'b', 'c'].map((id) => map.get(id)?.dot)).toEqual([
      '#4f63d8',
      '#2f9155',
      '#8656d0',
    ]);
  });
});

describe('stageIsNormal', () => {
  it('is true only for the normal kind', () => {
    expect(stageIsNormal({ kind: 'normal' })).toBe(true);
    expect(stageIsNormal({ kind: 'conversion' })).toBe(false);
    expect(stageIsNormal({ kind: 'lost' })).toBe(false);
  });
});

describe('dayBadgeTone', () => {
  it('is neutral up to 7 days', () => {
    for (const d of [0, 7]) {
      expect(dayBadgeTone(d)).toContain('bg-[#f1f1f4]');
      expect(dayBadgeTone(d)).toContain('text-[#6a6a72]');
    }
  });
  it('is amber for 8 to 14 days', () => {
    for (const d of [8, 14]) {
      expect(dayBadgeTone(d)).toContain('bg-[#fbf1d9]');
      expect(dayBadgeTone(d)).toContain('text-[#8a6210]');
    }
  });
  it('is red beyond 14 days', () => {
    expect(dayBadgeTone(15)).toContain('bg-[#fcf1f0]');
    expect(dayBadgeTone(15)).toContain('text-[#9b2f2a]');
  });
});

describe('avatarInitials', () => {
  it('uses first and last token initials', () => {
    expect(avatarInitials('Ana Paula Souza')).toBe('AS');
    expect(avatarInitials('Ana Souza')).toBe('AS');
  });
  it('handles one name and empty input', () => {
    expect(avatarInitials('Carlos')).toBe('C');
    expect(avatarInitials('')).toBe('?');
    expect(avatarInitials('   ')).toBe('?');
  });
});

describe('stageColors by pipeline type and exit', () => {
  it('gives orcamento, ganho, perdido and pausado four distinct colours', () => {
    const map = stageColors([
      { id: 'o', kind: 'conversion', type: 'orcamento' },
      { id: 'g', kind: 'normal', type: 'saida', exitKind: 'ganho' },
      { id: 'p', kind: 'lost', type: 'saida', exitKind: 'perdido' },
      { id: 'z', kind: 'normal', type: 'saida', exitKind: 'pausado' },
    ]);
    const dots = ['o', 'g', 'p', 'z'].map((id) => map.get(id)?.dot);
    expect(dots).toEqual(['#b7791f', '#2f9155', '#c2413b', '#8b8b92']);
    expect(new Set(dots).size).toBe(4);
  });

  it('keeps the legacy conversion and lost colours for stages without a type', () => {
    const map = stageColors([stage('c', 'conversion'), stage('l', 'lost')]);
    expect(map.get('c')?.dot).toBe('#2f9155');
    expect(map.get('l')?.dot).toBe('#c2413b');
  });

  it('is not normal for a pipeline special stage, and is normal for a plain normal stage', () => {
    expect(stageIsNormal({ kind: 'conversion', type: 'orcamento' })).toBe(false);
    expect(stageIsNormal({ kind: 'normal', type: 'saida', exitKind: 'pausado' })).toBe(false);
    expect(stageIsNormal({ kind: 'normal', type: 'normal' })).toBe(true);
  });
});
