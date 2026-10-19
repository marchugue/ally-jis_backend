// src/app/services/game.engine.ts
//
// PURE game rules for the 2-player duels (Tic-Tac-Toe, Secret Clue, 2048 Merge).
// No I/O, no sockets, no database — everything here takes a session snapshot
// and returns a patch, which makes it trivially unit-testable and keeps the
// server the single source of truth (clients only ever send *intents*).
//
// game.service.ts owns persistence, locking, timers and event fan-out.

import { SECRET_CLUE_DECK } from '../constants/secretClueDeck';
import { HttpError } from '../types/auth.types';

// ── Public constants ─────────────────────────────────────────────────────────

export const GAME_IDS = ['ttt', 'clue', 'merge'] as const;
export type GameId = (typeof GAME_IDS)[number];

export const GAME_NAMES: Record<GameId, string> = {
  ttt: 'Tic-Tac-Toe',
  clue: 'Secret Clue',
  merge: '2048 Merge',
};

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && (GAME_IDS as readonly string[]).includes(value);
}

/** Leaderboard points per result. */
export const POINTS_WIN = 3;
export const POINTS_DRAW = 1;
export const POINTS_LOSS = 0;

export const TTT_TURN_MS = 45_000;

export const MERGE_DURATION_MS = 180_000;
export const MERGE_GRACE_MS = 4_000;
/** Loose anti-cheat ceiling: a score can never grow faster than this. */
const MERGE_BASE_ALLOWANCE = 1_500;
const MERGE_MAX_SCORE_PER_SEC = 500;

export const CLUE_TOTAL_ROUNDS = 6;
export const CLUE_INTRO_MS = 3_000;
export const CLUE_ROUND_MS = 60_000;
export const CLUE_RESOLVE_MS = 3_500;
/** If the giver never answers a clue request, the server reveals one for them. */
export const CLUE_AUTO_REVEAL_MS = 12_000;
const CLUE_STUMP_BONUS = 50;
const CLUE_MAX_WRONG_GUESSES = 12;

// ── Types ────────────────────────────────────────────────────────────────────

export interface EngineSession {
  id: string;
  gameId: GameId;
  hostId: string;
  guestId: string;
  state: any;
  turnUserId: string | null;
  hostScore: number;
  guestScore: number;
}

export interface EngineOutcome {
  winnerId: string | null;
  isDraw: boolean;
  reason: 'win' | 'draw' | 'score' | 'timeout' | 'forfeit' | 'complete';
}

export interface EnginePatch {
  state: any;
  turnUserId: string | null;
  hostScore: number;
  guestScore: number;
  outcome?: EngineOutcome;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function other(session: EngineSession, userId: string): string {
  return userId === session.hostId ? session.guestId : session.hostId;
}

function assertPlayer(session: EngineSession, userId: string): void {
  if (userId !== session.hostId && userId !== session.guestId) {
    throw new HttpError('You are not a player in this game', 403);
  }
}

function patchFrom(session: EngineSession, state: any, extra: Partial<EnginePatch> = {}): EnginePatch {
  return {
    state,
    turnUserId: session.turnUserId,
    hostScore: session.hostScore,
    guestScore: session.guestScore,
    ...extra,
  };
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function scoreOf(session: EngineSession, userId: string): number {
  return userId === session.hostId ? session.hostScore : session.guestScore;
}

function withScore(session: EngineSession, userId: string, value: number): Pick<EnginePatch, 'hostScore' | 'guestScore'> {
  return userId === session.hostId
    ? { hostScore: value, guestScore: session.guestScore }
    : { hostScore: session.hostScore, guestScore: value };
}

function compareScores(session: EngineSession, hostScore: number, guestScore: number, reason: EngineOutcome['reason']): EngineOutcome {
  if (hostScore === guestScore) return { winnerId: null, isDraw: true, reason: 'draw' };
  return { winnerId: hostScore > guestScore ? session.hostId : session.guestId, isDraw: false, reason };
}

// ── Initial state ────────────────────────────────────────────────────────────

export function initState(
  gameId: GameId,
  hostId: string,
  guestId: string,
  now: number,
): Pick<EnginePatch, 'state' | 'turnUserId' | 'hostScore' | 'guestScore'> {
  switch (gameId) {
    case 'ttt':
      return {
        state: {
          board: Array<string | null>(9).fill(null),
          marks: { [hostId]: 'X', [guestId]: 'O' },
          winLine: null,
          turnEndsAt: now + TTT_TURN_MS,
        },
        turnUserId: hostId,
        hostScore: 0,
        guestScore: 0,
      };

    case 'merge':
      return {
        state: {
          seed: Math.floor(Math.random() * 2 ** 31),
          startsAt: now,
          endsAt: now + MERGE_DURATION_MS,
          done: { [hostId]: false, [guestId]: false },
        },
        turnUserId: null,
        hostScore: 0,
        guestScore: 0,
      };

    case 'clue': {
      const deckOrder = shuffle(SECRET_CLUE_DECK.map((_, i) => i)).slice(0, CLUE_TOTAL_ROUNDS);
      return {
        state: {
          deckOrder,
          round: 0,
          totalRounds: CLUE_TOTAL_ROUNDS,
          // Host guesses first, then roles alternate every round.
          guesserId: hostId,
          giverId: guestId,
          phase: 'playing',
          roundStartsAt: now + CLUE_INTRO_MS,
          roundEndsAt: now + CLUE_INTRO_MS + CLUE_ROUND_MS,
          revealed: [0],
          clueRequestedAt: null,
          wrongGuesses: [],
          result: null,
          nextRoundAt: null,
          history: [],
        },
        turnUserId: null,
        hostScore: 0,
        guestScore: 0,
      };
    }
  }
}

// ── Tic-Tac-Toe ──────────────────────────────────────────────────────────────

const TTT_LINES: number[][] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function tttWinner(board: (string | null)[]): { mark: string; line: number[] } | null {
  for (const line of TTT_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { mark: board[a] as string, line };
    }
  }
  return null;
}

function tttMove(session: EngineSession, userId: string, move: any, now: number): EnginePatch {
  if (move?.type !== 'place') throw new HttpError('Unknown Tic-Tac-Toe move', 400);
  if (session.turnUserId !== userId) throw new HttpError("It's not your turn", 409);

  const cell = Number(move.cell);
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) throw new HttpError('Invalid cell', 400);

  const board: (string | null)[] = [...session.state.board];
  if (board[cell]) throw new HttpError('That cell is already taken', 409);

  const mark = session.state.marks[userId] as string;
  board[cell] = mark;

  const win = tttWinner(board);
  if (win) {
    const winScores = withScore(session, userId, 1);
    return patchFrom(session, { ...session.state, board, winLine: win.line, turnEndsAt: null }, {
      ...winScores,
      turnUserId: null,
      outcome: { winnerId: userId, isDraw: false, reason: 'win' },
    });
  }

  if (board.every(Boolean)) {
    return patchFrom(session, { ...session.state, board, winLine: null, turnEndsAt: null }, {
      turnUserId: null,
      outcome: { winnerId: null, isDraw: true, reason: 'draw' },
    });
  }

  return patchFrom(session, { ...session.state, board, turnEndsAt: now + TTT_TURN_MS }, {
    turnUserId: other(session, userId),
  });
}

// ── 2048 Merge ───────────────────────────────────────────────────────────────

function mergeMove(session: EngineSession, userId: string, move: any, now: number): EnginePatch {
  if (move?.type !== 'score') throw new HttpError('Unknown Merge move', 400);
  if (session.state.done?.[userId]) {
    // Already finished — silently ignore late packets.
    return patchFrom(session, session.state);
  }

  const raw = Number(move.score);
  if (!Number.isFinite(raw) || raw < 0) throw new HttpError('Invalid score', 400);

  const elapsedSec = Math.max(0, (now - session.state.startsAt) / 1000);
  const ceiling = MERGE_BASE_ALLOWANCE + elapsedSec * MERGE_MAX_SCORE_PER_SEC;
  // Scores only ever go up, and never faster than a human could plausibly play.
  const score = Math.min(Math.floor(raw), Math.floor(ceiling));
  const previous = scoreOf(session, userId);
  const nextScore = Math.max(previous, score);

  const done = { ...session.state.done, [userId]: session.state.done[userId] || Boolean(move.over) };
  const state = { ...session.state, done };
  const scores = withScore(session, userId, nextScore);

  if (done[session.hostId] && done[session.guestId]) {
    return patchFrom(session, state, {
      ...scores,
      outcome: compareScores(session, scores.hostScore, scores.guestScore, 'score'),
    });
  }
  return patchFrom(session, state, scores);
}

// ── Secret Clue ──────────────────────────────────────────────────────────────

export function normalizeWord(input: unknown): string {
  return String(input ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 40);
}

function clueItem(state: any) {
  return SECRET_CLUE_DECK[state.deckOrder[state.round]];
}

function clueBonusFor(revealedCount: number): number {
  return revealedCount <= 1 ? 60 : revealedCount === 2 ? 40 : revealedCount === 3 ? 20 : 10;
}

function resolveClueRound(
  session: EngineSession,
  state: any,
  type: 'solved' | 'timeout',
  now: number,
): EnginePatch {
  const item = clueItem(state);
  let guesserPoints = 0;
  let giverPoints = 0;
  let breakdown = { base: 0, time: 0, clueBonus: 0 };

  if (type === 'solved') {
    const timeLeft = Math.max(0, Math.ceil((state.roundEndsAt - now) / 1000));
    const clueBonus = clueBonusFor(state.revealed.length);
    breakdown = { base: 100, time: timeLeft, clueBonus };
    guesserPoints = breakdown.base + breakdown.time + breakdown.clueBonus;
  } else {
    // The guesser ran out of time — the giver stumped them.
    giverPoints = CLUE_STUMP_BONUS;
    breakdown = { base: 0, time: 0, clueBonus: CLUE_STUMP_BONUS };
  }

  const guesserScore = scoreOf(session, state.guesserId) + guesserPoints;
  const giverScore = scoreOf(session, state.giverId) + giverPoints;
  const hostScore = state.guesserId === session.hostId ? guesserScore : giverScore;
  const guestScore = state.guesserId === session.hostId ? giverScore : guesserScore;

  const result = {
    type,
    word: item.word,
    funFact: item.funFact ?? null,
    guesserPoints,
    giverPoints,
    breakdown,
  };

  return patchFrom(
    session,
    {
      ...state,
      phase: 'resolved',
      clueRequestedAt: null,
      result,
      nextRoundAt: now + CLUE_RESOLVE_MS,
      history: [...(state.history ?? []), { round: state.round, word: item.word, type, guesserId: state.guesserId }],
    },
    { hostScore, guestScore },
  );
}

function clueMove(session: EngineSession, userId: string, move: any, now: number): EnginePatch {
  const state = session.state;
  if (state.phase !== 'playing') throw new HttpError('This round is over', 409);
  if (now < state.roundStartsAt) throw new HttpError('The round has not started yet', 409);
  if (now >= state.roundEndsAt) {
    return resolveClueRound(session, state, 'timeout', now);
  }

  switch (move?.type) {
    case 'request_clue': {
      if (userId !== state.guesserId) throw new HttpError('Only the guesser can request a clue', 403);
      if (state.revealed.length >= 4) throw new HttpError('All clues are already revealed', 409);
      if (state.clueRequestedAt) return patchFrom(session, state); // already waiting
      return patchFrom(session, { ...state, clueRequestedAt: now });
    }

    case 'give_clue': {
      if (userId !== state.giverId) throw new HttpError('Only the clue giver can reveal a clue', 403);
      if (!state.clueRequestedAt) throw new HttpError('The guesser has not asked for a clue', 409);
      const idx = Number(move.clueIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx > 3 || state.revealed.includes(idx)) {
        throw new HttpError('Invalid clue', 400);
      }
      return patchFrom(session, { ...state, revealed: [...state.revealed, idx], clueRequestedAt: null });
    }

    case 'guess': {
      if (userId !== state.guesserId) throw new HttpError('Only the guesser can guess', 403);
      const guess = normalizeWord(move.word);
      if (!guess) throw new HttpError('Enter a guess', 400);
      if (guess === normalizeWord(clueItem(state).word)) {
        return resolveClueRound(session, state, 'solved', now);
      }
      const wrongGuesses = [...state.wrongGuesses, guess].slice(-CLUE_MAX_WRONG_GUESSES);
      return patchFrom(session, { ...state, wrongGuesses });
    }

    default:
      throw new HttpError('Unknown Secret Clue move', 400);
  }
}

function startNextClueRound(session: EngineSession, state: any, now: number): EnginePatch {
  const round = state.round + 1;
  return patchFrom(session, {
    ...state,
    round,
    guesserId: state.giverId,
    giverId: state.guesserId,
    phase: 'playing',
    roundStartsAt: now + CLUE_INTRO_MS,
    roundEndsAt: now + CLUE_INTRO_MS + CLUE_ROUND_MS,
    revealed: [0],
    clueRequestedAt: null,
    wrongGuesses: [],
    result: null,
    nextRoundAt: null,
  });
}

// ── Public engine API ────────────────────────────────────────────────────────

export function applyMove(session: EngineSession, userId: string, move: any, now: number): EnginePatch {
  assertPlayer(session, userId);
  switch (session.gameId) {
    case 'ttt':
      return tttMove(session, userId, move, now);
    case 'merge':
      return mergeMove(session, userId, move, now);
    case 'clue':
      return clueMove(session, userId, move, now);
  }
}

/**
 * Advances any time-based rule that has elapsed. Returns null when there is
 * nothing to do. Safe to call at any time and as often as you like.
 */
export function tick(session: EngineSession, now: number): EnginePatch | null {
  const state = session.state;

  switch (session.gameId) {
    case 'ttt': {
      if (!session.turnUserId || !state.turnEndsAt || now < state.turnEndsAt) return null;
      // AFK on their turn → they forfeit.
      const winnerId = other(session, session.turnUserId);
      const winScores = withScore(session, winnerId, 1);
      return patchFrom(session, { ...state, turnEndsAt: null }, {
        ...winScores,
        turnUserId: null,
        outcome: { winnerId, isDraw: false, reason: 'timeout' },
      });
    }

    case 'merge': {
      if (now < state.endsAt + MERGE_GRACE_MS) return null;
      return patchFrom(session, state, {
        outcome: compareScores(session, session.hostScore, session.guestScore, 'timeout'),
      });
    }

    case 'clue': {
      if (state.phase === 'playing') {
        if (now >= state.roundEndsAt) return resolveClueRound(session, state, 'timeout', now);
        if (state.clueRequestedAt && now >= state.clueRequestedAt + CLUE_AUTO_REVEAL_MS) {
          const next = [0, 1, 2, 3].find((i) => !state.revealed.includes(i));
          if (next === undefined) return patchFrom(session, { ...state, clueRequestedAt: null });
          return patchFrom(session, { ...state, revealed: [...state.revealed, next], clueRequestedAt: null });
        }
        return null;
      }
      if (state.phase === 'resolved' && state.nextRoundAt && now >= state.nextRoundAt) {
        if (state.round + 1 >= state.totalRounds) {
          return patchFrom(session, { ...state, nextRoundAt: null }, {
            outcome: compareScores(session, session.hostScore, session.guestScore, 'complete'),
          });
        }
        return startNextClueRound(session, state, now);
      }
      return null;
    }
  }
}

/** Earliest wall-clock moment (epoch ms) at which `tick` will have work to do. */
export function nextDeadline(session: EngineSession): number | null {
  const state = session.state;
  switch (session.gameId) {
    case 'ttt':
      return session.turnUserId && state.turnEndsAt ? state.turnEndsAt : null;
    case 'merge':
      return state.endsAt + MERGE_GRACE_MS;
    case 'clue': {
      if (state.phase === 'resolved') return state.nextRoundAt ?? null;
      const candidates = [state.roundEndsAt];
      if (state.clueRequestedAt) candidates.push(state.clueRequestedAt + CLUE_AUTO_REVEAL_MS);
      return Math.min(...candidates);
    }
  }
}

/** A player left (or dropped and never came back): the other player wins. */
export function forfeit(session: EngineSession, leaverId: string): EnginePatch {
  assertPlayer(session, leaverId);
  const winnerId = other(session, leaverId);
  const scores = withScore(session, winnerId, Math.max(scoreOf(session, winnerId), session.gameId === 'ttt' ? 1 : 0));
  return patchFrom(session, session.state, {
    ...scores,
    turnUserId: null,
    outcome: { winnerId, isDraw: false, reason: 'forfeit' },
  });
}

/** Points awarded to a player for a finished duel (feeds game_results). */
export function pointsFor(result: 'win' | 'loss' | 'draw'): number {
  return result === 'win' ? POINTS_WIN : result === 'draw' ? POINTS_DRAW : POINTS_LOSS;
}

// ── Per-viewer projection (what a player is allowed to see) ──────────────────

export function publicState(session: EngineSession, viewerId: string): Record<string, unknown> {
  const state = session.state;

  switch (session.gameId) {
    case 'ttt':
      return {
        board: state.board,
        marks: state.marks,
        myMark: state.marks[viewerId] ?? null,
        winLine: state.winLine ?? null,
        turnEndsAt: state.turnEndsAt ?? null,
      };

    case 'merge':
      return {
        seed: state.seed,
        startsAt: state.startsAt,
        endsAt: state.endsAt,
        myDone: Boolean(state.done?.[viewerId]),
        opponentDone: Boolean(state.done?.[other(session, viewerId)]),
      };

    case 'clue': {
      const item = clueItem(state);
      const isGiver = viewerId === state.giverId;
      const resolved = state.phase === 'resolved';

      const view: Record<string, unknown> = {
        round: state.round,
        totalRounds: state.totalRounds,
        role: isGiver ? 'giver' : 'guesser',
        phase: state.phase,
        roundStartsAt: state.roundStartsAt,
        roundEndsAt: state.roundEndsAt,
        nextRoundAt: state.nextRoundAt ?? null,
        category: item.category,
        revealedClues: [...state.revealed]
          .sort((a: number, b: number) => a - b)
          .map((index: number) => ({ index, text: item.clues[index] })),
        clueRequested: Boolean(state.clueRequestedAt),
        clueRequestedAt: state.clueRequestedAt ?? null,
        wrongGuesses: state.wrongGuesses,
        result: resolved ? state.result : null,
      };

      // ONLY the giver (or anybody, once the round is over) may see the word.
      if (isGiver || resolved) {
        view.word = item.word;
      }
      if (isGiver) {
        view.allClues = item.clues.map((text, index) => ({
          index,
          text,
          revealed: state.revealed.includes(index),
        }));
      }
      return view;
    }
  }
}
