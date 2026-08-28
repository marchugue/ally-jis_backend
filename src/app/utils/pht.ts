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
