import ptBR from './pt-BR.json';

/**
 * Minimal typed i18n for apps/site (autopilot A1 — no next-intl package).
 *
 * apps/site is PT-BR only in v1.0. `getT()` returns the full, fully-typed
 * translation object; server components call it directly (no provider/hook).
 */
export type Translations = typeof ptBR;

export function getT(): Translations {
  return ptBR;
}
