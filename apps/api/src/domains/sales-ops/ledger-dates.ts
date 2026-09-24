/** STORED civil day of a due_date/base_date value (UTC slice, the storage convention). Never pass the clock: "today" is saoPauloDayOf / todayInSaoPaulo. */
export function asDateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

export function dateFromIsoDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
