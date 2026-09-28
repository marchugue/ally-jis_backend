// src/app/utils/pht.ts
//
// Philippine Standard Time helpers (UTC+8).
// All streak logic must use these instead of new Date().toISOString()
// so that a "day" always matches midnight–midnight PHT regardless of
// what timezone the Node process or Postgres server is configured with.

/** Offset of PHT from UTC in milliseconds (+8 hours). */
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Returns today's date string in Philippine Standard Time (YYYY-MM-DD).
 * Safe to call as often as needed — just arithmetic, no I/O.
 */
export function phtDateStr(now: Date = new Date()): string {
  const pht = new Date(now.getTime() + PHT_OFFSET_MS);
  return pht.toISOString().slice(0, 10);
}

/**
 * Returns a PHT date string offset by `deltaDays` from `now`.
 * deltaDays = -1 → yesterday PHT, +1 → tomorrow PHT.
 */
export function phtDateStrOffset(deltaDays: number, now: Date = new Date()): string {
  const pht = new Date(now.getTime() + PHT_OFFSET_MS + deltaDays * 86_400_000);
  return pht.toISOString().slice(0, 10);
}

/**
 * Returns the start of `dateStr` (YYYY-MM-DD) in UTC — i.e. midnight PHT
 * expressed as a UTC timestamptz string suitable for Supabase `.gte()`.
 * Example: '2026-08-29' → '2026-08-28T16:00:00.000Z'
 */
export function phtMidnightUtc(dateStr: string): string {
  // dateStr is already PHT local; PHT midnight = UTC (dateStr - 8h)
  return new Date(`${dateStr}T00:00:00.000+08:00`).toISOString();
}

/**
 * Safe calendar date offset calculation on date strings (YYYY-MM-DD).
 * Offset by deltaDays (e.g. -1 for previous calendar day, +1 for next).
 * Uses UTC date components so it is immune to local time, DST, and timezone jumping.
 */
export function getCalendarDateOffset(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return date.toISOString().slice(0, 10);
}

/**
 * Returns the end of `dateStr` (YYYY-MM-DD) in UTC — i.e. 23:59:59.999 PHT
 * expressed as a UTC ISO string.
 */
export function phtEndOfDayUtc(dateStr: string): string {
  return new Date(`${dateStr}T23:59:59.999+08:00`).toISOString();
}

/**
 * Returns the start of `dateStr` (YYYY-MM-DD) in UTC — i.e. 00:00:00.000 PHT
 * expressed as a UTC ISO string.
 */
export function phtStartOfDayUtc(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00.000+08:00`).toISOString();
}

/**
 * Returns the current hours (0-23) and minutes (0-59) in Philippine Standard Time.
 */
export function getPhtHoursAndMinutes(now: Date = new Date()): { hours: number; minutes: number; dateStr: string } {
  const pht = new Date(now.getTime() + PHT_OFFSET_MS);
  return {
    hours: pht.getUTCHours(),
    minutes: pht.getUTCMinutes(),
    dateStr: pht.toISOString().slice(0, 10),
  };
}

