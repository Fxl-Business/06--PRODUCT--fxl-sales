import { describe, expect, it } from 'vitest';
import { i18n } from '../index';
import ptBR from '../pt-BR.json';
import en from '../en.json';

/**
 * i18n key-coverage test (Phase 03 T13b, D-R). Guarantees:
 *  (a) PT-BR and EN have an IDENTICAL key set (a key only in PT-BR renders the
 *      raw key string when locale=EN).
 *  (b) i18next resolves a representative sample to a non-empty value that is NOT
 *      equal to the key itself (proves no raw-key render).
 */

function flatKeys(obj: unknown, prefix = ''): string[] {
  if (Array.isArray(obj)) {
    return obj.flatMap((v, i) => flatKeys(v, `${prefix}[${i}]`));
  }
  if (obj && typeof obj === 'object') {
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      flatKeys(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [prefix];
}

const SAMPLE_KEYS = [
  'admin.finders.title',
  'admin.sellers.title',
  'finder.dashboard.title',
  'seller.deals.title',
  'errors.noRole.title',
  'nav.finders',
  'nav.sellers',
];

describe('i18n key coverage', () => {
  it('PT-BR and EN have identical key sets', () => {
    const pt = flatKeys(ptBR).sort();
    const enKeys = flatKeys(en).sort();
    const onlyInPt = pt.filter((k) => !enKeys.includes(k));
    const onlyInEn = enKeys.filter((k) => !pt.includes(k));
    expect(onlyInPt, `keys only in pt-BR: ${onlyInPt.join(', ')}`).toEqual([]);
    expect(onlyInEn, `keys only in en: ${onlyInEn.join(', ')}`).toEqual([]);
  });

  it.each(SAMPLE_KEYS)('resolves "%s" in both locales (no raw-key render)', async (key) => {
    for (const lng of ['pt-BR', 'en'] as const) {
      await i18n.changeLanguage(lng);
      const value = i18n.t(key);
      expect(value, `${key} @ ${lng}`).toBeTruthy();
      expect(value, `${key} @ ${lng} rendered raw key`).not.toBe(key);
    }
    await i18n.changeLanguage('pt-BR');
  });
});
