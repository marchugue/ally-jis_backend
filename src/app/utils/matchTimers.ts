// src/services/matchTimers.ts
//
// In-memory timer registry for matchmaking deadlines (accept-timeout,
// chat-first-message-timeout). Deliberately simple per the single-instance
// decision — no Redis. This means:
//   1. Timers don't survive a process restart. matchmaking.service.ts's
//      reconcileStaleMatches() sweeps for anything past its deadline on
//      boot as a safety net.
//   2. This only works correctly with ONE running server instance. If you
//      ever scale horizontally, this needs to move to a durable scheduler
//      (Redis + bull/bullmq, pg_cron, etc.) or only one instance should
//      own timer duties.

type TimerKind = 'accept' | 'chat';

const timers = new Map<string, NodeJS.Timeout>();

function key(matchId: string, kind: TimerKind): string {
  return `${kind}:${matchId}`;
}

export function scheduleTimer(matchId: string, kind: TimerKind, ms: number, callback: () => void): void {
  clearTimer(matchId, kind);
  const handle = setTimeout(() => {
    timers.delete(key(matchId, kind));
    callback();
  }, ms);
  timers.set(key(matchId, kind), handle);
}

export function clearTimer(matchId: string, kind: TimerKind): void {
  const existing = timers.get(key(matchId, kind));
  if (existing) {
    clearTimeout(existing);
    timers.delete(key(matchId, kind));
  }
}

export function clearAllTimersForMatch(matchId: string): void {
  clearTimer(matchId, 'accept');
  clearTimer(matchId, 'chat');
}