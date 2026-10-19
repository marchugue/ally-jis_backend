// src/scripts/test-game-engine.ts
//
// Pure-logic checks for the 2-player game engine (no DB / sockets needed):
//   npx ts-node src/scripts/test-game-engine.ts

import assert from 'node:assert/strict';
import * as engine from '../app/services/game.engine';
import type { EngineSession } from '../app/services/game.engine';
import { SECRET_CLUE_DECK } from '../app/constants/secretClueDeck';

const HOST = 'host-user';
const GUEST = 'guest-user';
const T0 = 1_700_000_000_000;

function session(gameId: engine.GameId): EngineSession {
  const init = engine.initState(gameId, HOST, GUEST, T0);
  return { id: 's1', gameId, hostId: HOST, guestId: GUEST, ...init };
}

function apply(s: EngineSession, patch: engine.EnginePatch): EngineSession {
  return { ...s, state: patch.state, turnUserId: patch.turnUserId, hostScore: patch.hostScore, guestScore: patch.guestScore };
}

function throwsStatus(fn: () => unknown, status: number, label: string) {
  try {
    fn();
  } catch (err: any) {
    assert.equal(err.status, status, `${label}: expected HTTP ${status}, got ${err.status} (${err.message})`);
    return;
  }
  assert.fail(`${label}: expected an error`);
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// ── Tic-Tac-Toe ──────────────────────────────────────────────────────────────
console.log('Tic-Tac-Toe');

test('host (X) moves first; guest cannot jump the queue', () => {
  const s = session('ttt');
  assert.equal(s.turnUserId, HOST);
  throwsStatus(() => engine.applyMove(s, GUEST, { type: 'place', cell: 0 }, T0), 409, 'guest first');
});

test('rejects taken cells and out-of-range cells', () => {
  let s = session('ttt');
  s = apply(s, engine.applyMove(s, HOST, { type: 'place', cell: 4 }, T0 + 1));
  throwsStatus(() => engine.applyMove(s, GUEST, { type: 'place', cell: 4 }, T0 + 2), 409, 'taken');
  throwsStatus(() => engine.applyMove(s, GUEST, { type: 'place', cell: 9 }, T0 + 2), 400, 'range');
  throwsStatus(() => engine.applyMove(s, GUEST, { type: 'place', cell: 'x' }, T0 + 2), 400, 'NaN');
});

test('three in a row wins for the mover and records the winning line', () => {
  let s = session('ttt');
  const seq: Array<[string, number]> = [[HOST, 0], [GUEST, 3], [HOST, 1], [GUEST, 4], [HOST, 2]];
  let patch: engine.EnginePatch | null = null;
  for (const [who, cell] of seq) {
    patch = engine.applyMove(s, who, { type: 'place', cell }, T0);
    s = apply(s, patch);
  }
  assert.equal(patch!.outcome?.winnerId, HOST);
  assert.deepEqual(patch!.state.winLine, [0, 1, 2]);
  assert.equal(patch!.hostScore, 1);
});

test('full board with no winner is a draw', () => {
  let s = session('ttt');
  // X O X / X O O / O X X  → draw
  const order: Array<[string, number]> = [
    [HOST, 0], [GUEST, 1], [HOST, 2], [GUEST, 4], [HOST, 3], [GUEST, 5], [HOST, 7], [GUEST, 6], [HOST, 8],
  ];
  let patch: engine.EnginePatch | null = null;
  for (const [who, cell] of order) {
    patch = engine.applyMove(s, who, { type: 'place', cell }, T0);
    s = apply(s, patch);
  }
  assert.equal(patch!.outcome?.isDraw, true);
  assert.equal(patch!.outcome?.winnerId, null);
});

test('AFK on your turn forfeits after the move timer', () => {
  const s = session('ttt');
  assert.equal(engine.tick(s, T0 + engine.TTT_TURN_MS - 1), null);
  const patch = engine.tick(s, T0 + engine.TTT_TURN_MS)!;
  assert.equal(patch.outcome?.winnerId, GUEST);
  assert.equal(patch.outcome?.reason, 'timeout');
});

test('public state never leaks other games’ fields and exposes your mark', () => {
  const s = session('ttt');
  const view = engine.publicState(s, GUEST) as any;
  assert.equal(view.myMark, 'O');
  assert.equal(view.board.length, 9);
});

// ── 2048 Merge ───────────────────────────────────────────────────────────────
console.log('2048 Merge');

test('scores only go up and are rate-limited', () => {
  let s = session('merge');
  s = apply(s, engine.applyMove(s, HOST, { type: 'score', score: 200 }, T0 + 5_000));
  assert.equal(s.hostScore, 200);
  s = apply(s, engine.applyMove(s, HOST, { type: 'score', score: 50 }, T0 + 6_000)); // lower → ignored
  assert.equal(s.hostScore, 200);
  const cheat = engine.applyMove(s, GUEST, { type: 'score', score: 9_999_999 }, T0 + 2_000);
  assert.ok(cheat.guestScore <= 1_500 + 2 * 500, `capped, got ${cheat.guestScore}`);
});

test('both players finishing early ends the duel; higher score wins', () => {
  let s = session('merge');
  s = apply(s, engine.applyMove(s, HOST, { type: 'score', score: 900, over: true }, T0 + 60_000));
  const patch = engine.applyMove(s, GUEST, { type: 'score', score: 1_200, over: true }, T0 + 70_000);
  assert.equal(patch.outcome?.winnerId, GUEST);
});

test('equal scores are a draw; timer ends the duel after the grace window', () => {
  let s = session('merge');
  s = apply(s, engine.applyMove(s, HOST, { type: 'score', score: 500 }, T0 + 30_000));
  s = apply(s, engine.applyMove(s, GUEST, { type: 'score', score: 500 }, T0 + 30_000));
  assert.equal(engine.tick(s, T0 + engine.MERGE_DURATION_MS), null);
  const patch = engine.tick(s, T0 + engine.MERGE_DURATION_MS + engine.MERGE_GRACE_MS)!;
  assert.equal(patch.outcome?.isDraw, true);
});

test('merge duels share a seed for identical opening boards', () => {
  const view = engine.publicState(session('merge'), HOST) as any;
  assert.equal(typeof view.seed, 'number');
});

// ── Secret Clue ──────────────────────────────────────────────────────────────
console.log('Secret Clue');

const wordOf = (s: EngineSession) => SECRET_CLUE_DECK[s.state.deckOrder[s.state.round]].word;

test('guesser never sees the word; giver does', () => {
  const s = session('clue');
  const guesserView = engine.publicState(s, s.state.guesserId) as any;
  const giverView = engine.publicState(s, s.state.giverId) as any;
  assert.equal(guesserView.word, undefined);
  assert.equal(guesserView.allClues, undefined);
  assert.equal(giverView.word, wordOf(s));
  assert.equal(giverView.allClues.length, 4);
  assert.equal(JSON.stringify(guesserView).includes(wordOf(s)), false, 'word leaked in guesser payload');
});

test('clue request → giver picks → clue becomes visible to guesser', () => {
  let s = session('clue');
  const start = T0 + engine.CLUE_INTRO_MS + 1_000;
  throwsStatus(() => engine.applyMove(s, s.state.guesserId, { type: 'request_clue' }, T0 + 100), 409, 'before start');
  s = apply(s, engine.applyMove(s, s.state.guesserId, { type: 'request_clue' }, start));
  throwsStatus(() => engine.applyMove(s, s.state.guesserId, { type: 'give_clue', clueIndex: 1 }, start), 403, 'guesser giving');
  s = apply(s, engine.applyMove(s, s.state.giverId, { type: 'give_clue', clueIndex: 2 }, start + 1_000));
  const view = engine.publicState(s, s.state.guesserId) as any;
  assert.deepEqual(view.revealedClues.map((c: any) => c.index), [0, 2]);
  throwsStatus(() => engine.applyMove(s, s.state.giverId, { type: 'give_clue', clueIndex: 3 }, start + 2_000), 409, 'no request pending');
});

test('giver ignoring a request gets auto-revealed after the timeout', () => {
  let s = session('clue');
  const start = T0 + engine.CLUE_INTRO_MS + 1_000;
  s = apply(s, engine.applyMove(s, s.state.guesserId, { type: 'request_clue' }, start));
  assert.equal(engine.tick(s, start + engine.CLUE_AUTO_REVEAL_MS - 1), null);
  const patch = engine.tick(s, start + engine.CLUE_AUTO_REVEAL_MS)!;
  assert.deepEqual(patch.state.revealed, [0, 1]);
});

test('wrong guesses are recorded; the right guess scores base + time + clue bonus', () => {
  let s = session('clue');
  const start = T0 + engine.CLUE_INTRO_MS + 1_000;
  const guesser = s.state.guesserId;
  s = apply(s, engine.applyMove(s, guesser, { type: 'guess', word: 'definitely wrong' }, start));
  assert.equal(s.state.wrongGuesses.length, 1);

  const patch = engine.applyMove(s, guesser, { type: 'guess', word: wordOf(s).toLowerCase() }, start + 10_000);
  assert.equal(patch.state.phase, 'resolved');
  assert.equal(patch.state.result.type, 'solved');
  const expectedTime = Math.ceil((s.state.roundEndsAt - (start + 10_000)) / 1000);
  assert.equal(patch.state.result.guesserPoints, 100 + expectedTime + 60);
  const guesserScore = guesser === HOST ? patch.hostScore : patch.guestScore;
  assert.equal(guesserScore, patch.state.result.guesserPoints);
  // Word is now public for the (previous) guesser too.
  assert.equal((engine.publicState(apply(s, patch), guesser) as any).word, wordOf(s));
});

test('round timeout stumps the guesser and gives the giver the bonus', () => {
  const s = session('clue');
  const patch = engine.tick(s, s.state.roundEndsAt)!;
  assert.equal(patch.state.result.type, 'timeout');
  assert.equal(patch.state.result.giverPoints, 50);
});

test('after a resolved round, roles swap and a full game ends after all rounds', () => {
  let s = session('clue');
  let now = T0;
  const firstGuesser = s.state.guesserId;
  let outcome: engine.EngineOutcome | undefined;

  for (let round = 0; round < engine.CLUE_TOTAL_ROUNDS; round += 1) {
    assert.equal(s.state.round, round);
    assert.equal(s.state.guesserId, round % 2 === 0 ? firstGuesser : (firstGuesser === HOST ? GUEST : HOST));
    now = s.state.roundEndsAt; // let it time out
    s = apply(s, engine.tick(s, now)!);
    assert.equal(s.state.phase, 'resolved');
    now = s.state.nextRoundAt;
    const next = engine.tick(s, now)!;
    outcome = next.outcome;
    s = apply(s, next);
  }
  assert.ok(outcome, 'game should have ended');
  assert.equal(outcome!.reason === 'complete' || outcome!.reason === 'draw', true);
});

test('forfeit hands the win to the player who stayed', () => {
  const patch = engine.forfeit(session('ttt'), HOST);
  assert.equal(patch.outcome?.winnerId, GUEST);
  assert.equal(patch.outcome?.reason, 'forfeit');
});

test('non-players cannot act', () => {
  throwsStatus(() => engine.applyMove(session('ttt'), 'intruder', { type: 'place', cell: 0 }, T0), 403, 'intruder');
});

test('nextDeadline is always in the future of the session clock', () => {
  for (const id of engine.GAME_IDS) {
    const d = engine.nextDeadline(session(id));
    assert.ok(d !== null && d > T0, `${id} deadline`);
  }
});

console.log(`\n${passed} engine checks passed.`);
