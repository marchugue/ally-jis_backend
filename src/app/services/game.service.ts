// src/app/services/game.service.ts
//
// SERVICE LAYER — 2-player game sessions.
//
// Responsibilities (rules themselves live in game.engine.ts):
//   • invites: validate the two users may play, create the session, drop an
//     Accept/Play card into their chat thread, notify + push the guest
//   • lifecycle: accept / decline / cancel / start / finish / rematch
//   • realtime: per-user projected state fan-out over `user:<id>` rooms
//   • timers: per-session deadline timers + a sweeper safety net
//   • disconnects: 30 s grace, then the remaining player wins
//   • persistence: results → game_results (leaderboard), and the match
//     system's `play_game` daily task once a matched pair has played ≥ 5 min

import * as gameModel from '../models/game.model';
import type { GameSessionRow } from '../models/game.model';
import * as conversationModel from '../models/conversation.model';
import * as moderationModel from '../models/moderation.model';
import * as matchModel from '../models/matchmaking.model';
import * as interactionModel from '../models/interaction.model';
import * as matchTasksService from './matchTasks.service';
import { findAcceptedConnectionIds } from '../models/feed.model';
import { getDeterministicAnonymousAvatar } from '../constants/anonymousIdentity';
import { emitToUser } from './realtime.service';
import { HttpError } from '../types/auth.types';
import * as engine from './game.engine';
import type { EnginePatch, EngineSession, GameId } from './game.engine';

// ── Tunables ─────────────────────────────────────────────────────────────────

const INVITE_TTL_MS = 5 * 60_000;
const DISCONNECT_GRACE_MS = 30_000;
const INITIAL_JOIN_GRACE_MS = 45_000;
const STALE_ACTIVE_MS = 30 * 60_000;
const SWEEP_INTERVAL_MS = 15_000;
const REMATCH_WINDOW_MS = 2 * 60_000;
/** A matched pair must have played this long (same PHT day) to earn `play_game`. */
const PLAY_GAME_MIN_SECONDS = 5 * 60;
/** One duel never counts for more than this towards that threshold. */
const PER_GAME_COUNTED_CAP_SECONDS = 10 * 60;
const INVITES_PER_MINUTE = 10;

// ── Public shapes ────────────────────────────────────────────────────────────

export interface GameIdentity {
  id: string;
  name: string;
  isAnonymous: boolean;
  /** Only ever set for allies — masked identities use `avatarKey` instead. */
  avatar_url?: string | null;
  avatarKey?: string;
}

export interface PublicGameSession {
  id: string;
  gameId: GameId;
  gameName: string;
  status: string;
  conversationId: string | null;
  matchId: string | null;
  hostId: string;
  guestId: string;
  youAre: 'host' | 'guest';
  turnUserId: string | null;
  scores: { you: number; opponent: number };
  winnerId: string | null;
  isDraw: boolean;
  endReason: string | null;
  opponent: GameIdentity;
  state: Record<string, unknown> | null;
  startedAt: string | null;
  endedAt: string | null;
  inviteExpiresAt: string | null;
  /** Server clock so clients can correct for local clock skew. */
  serverNow: number;
}

// ── In-process coordination ──────────────────────────────────────────────────

const locks = new Map<string, Promise<unknown>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const presence = new Map<string, Map<string, Set<string>>>(); // sessionId → userId → socketIds
const graceTimers = new Map<string, ReturnType<typeof setTimeout>>(); // `${sessionId}:${userId}`
const rematchVotes = new Map<string, { voters: Set<string>; expiresAt: number }>();
const inviteRate = new Map<string, number[]>();
const identityCache = new Map<string, { value: GameIdentity; at: number }>();
const IDENTITY_TTL_MS = 5 * 60_000;

function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(fn);
  const tail = result.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return result;
}

function toEngine(row: GameSessionRow): EngineSession {
  return {
    id: row.id,
    gameId: row.game_id,
    hostId: row.host_id,
    guestId: row.guest_id,
    state: row.state ?? {},
    turnUserId: row.turn_user_id,
    hostScore: row.host_score ?? 0,
    guestScore: row.guest_score ?? 0,
  };
}

function otherPlayer(row: GameSessionRow, userId: string): string {
  return userId === row.host_id ? row.guest_id : row.host_id;
}

function assertParticipant(row: GameSessionRow, userId: string): void {
  if (row.host_id !== userId && row.guest_id !== userId) {
    throw new HttpError('You are not part of this game', 403);
  }
}

// ── Identity (anonymity-safe opponent info) ──────────────────────────────────

/**
 * How `viewerId` is allowed to see `otherId`. Allies get real names/avatars;
 * everyone else (anonymous matches) only ever gets the match alias + avatar key.
 */
async function resolveIdentity(viewerId: string, otherId: string, matchId: string | null): Promise<GameIdentity> {
  const cacheKey = `${viewerId}:${otherId}`;
  const cached = identityCache.get(cacheKey);
  if (cached && Date.now() - cached.at < IDENTITY_TTL_MS) return cached.value;

  const allies = await interactionModel.isAllies(viewerId, otherId).catch(() => false);
  let identity: GameIdentity;

  if (allies) {
    const [profile] = await gameModel.findProfilesByIds([otherId]);
    identity = {
      id: otherId,
      name: profile?.full_name?.trim() || profile?.username?.trim() || 'Ally',
      avatar_url: profile?.avatar_url ?? null,
      isAnonymous: false,
    };
  } else {
    const match = matchId
      ? await matchModel.getMatchById(matchId)
      : await matchModel.findActiveMatchBetweenUsers(viewerId, otherId);
    const otherIsA = match?.user_a_id === otherId;
    const alias = (otherIsA ? match?.user_a_alias : match?.user_b_alias) || null;
    const avatarKey = (otherIsA ? match?.user_a_avatar : match?.user_b_avatar) || getDeterministicAnonymousAvatar(otherId);
    identity = {
      id: otherId,
      name: alias || 'Anonymous Peer',
      avatarKey,
      isAnonymous: true,
    };
  }

  identityCache.set(cacheKey, { value: identity, at: Date.now() });
  return identity;
}

async function buildPublicSession(row: GameSessionRow, viewerId: string): Promise<PublicGameSession> {
  const opponentId = otherPlayer(row, viewerId);
  const opponent = await resolveIdentity(viewerId, opponentId, row.match_id);
  const isHost = viewerId === row.host_id;
  const showState = row.status === 'active' || row.status === 'finished' || row.status === 'abandoned';

  return {
    id: row.id,
    gameId: row.game_id,
    gameName: engine.GAME_NAMES[row.game_id],
    status: gameModel.effectiveStatus(row),
    conversationId: row.conversation_id,
    matchId: row.match_id,
    hostId: row.host_id,
    guestId: row.guest_id,
    youAre: isHost ? 'host' : 'guest',
    turnUserId: row.turn_user_id,
    scores: {
      you: isHost ? row.host_score : row.guest_score,
      opponent: isHost ? row.guest_score : row.host_score,
    },
    winnerId: row.winner_id,
    isDraw: row.is_draw,
    endReason: row.end_reason,
    opponent,
    state: showState && row.started_at ? engine.publicState(toEngine(row), viewerId) : null,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    inviteExpiresAt: row.invite_expires_at,
    serverNow: Date.now(),
  };
}

async function emitSession(row: GameSessionRow, event: string, extra: Record<string, unknown> = {}): Promise<void> {
  await Promise.all(
    [row.host_id, row.guest_id].map(async (userId) => {
      try {
        const session = await buildPublicSession(row, userId);
        emitToUser(userId, event, { session, ...extra });
      } catch (err) {
        console.error('[game] emitSession failed:', err);
      }
    }),
  );
}

/** Tells both players' chat clients to refresh the invite card's status. */
function emitInviteUpdated(row: GameSessionRow): void {
  if (!row.invite_message_id) return;
  const payload = {
    sessionId: row.id,
    messageId: row.invite_message_id,
    conversationId: row.conversation_id,
    gameId: row.game_id,
    status: gameModel.effectiveStatus(row),
    game_invite: gameModel.toInviteInfo(row),
  };
  emitToUser(row.host_id, 'game:invite_updated', payload);
  emitToUser(row.guest_id, 'game:invite_updated', payload);
}

// ── Timers ───────────────────────────────────────────────────────────────────

function clearTimer(sessionId: string): void {
  const timer = timers.get(sessionId);
  if (timer) clearTimeout(timer);
  timers.delete(sessionId);
}

function armTimer(row: GameSessionRow): void {
  clearTimer(row.id);
  if (row.status !== 'active') return;

  const deadline = engine.nextDeadline(toEngine(row));
  if (deadline === null) return;

  const delay = Math.min(Math.max(deadline - Date.now() + 25, 250), 2_000_000_000);
  timers.set(
    row.id,
    setTimeout(() => {
      timers.delete(row.id);
      void tickSession(row.id).catch((err) => console.error('[game] tick failed:', err));
    }, delay),
  );
}

async function tickSession(sessionId: string): Promise<void> {
  await runExclusive(sessionId, async () => {
    const row = await gameModel.findSessionById(sessionId);
    if (!row || row.status !== 'active') return;
    const patch = engine.tick(toEngine(row), Date.now());
    if (patch) {
      await commit(row, patch);
    } else {
      armTimer(row);
    }
  });
}

// ── Commit / finish ──────────────────────────────────────────────────────────

async function commit(row: GameSessionRow, patch: EnginePatch): Promise<GameSessionRow> {
  const now = new Date();
  const dbPatch: Record<string, unknown> = {
    state: patch.state,
    turn_user_id: patch.turnUserId,
    host_score: patch.hostScore,
    guest_score: patch.guestScore,
  };

  if (patch.outcome) {
    dbPatch.status = 'finished';
    dbPatch.winner_id = patch.outcome.winnerId;
    dbPatch.is_draw = patch.outcome.isDraw;
    dbPatch.end_reason = patch.outcome.reason;
    dbPatch.ended_at = now.toISOString();
  }

  const updated = await gameModel.updateSession(row.id, row.updated_at, dbPatch);
  if (!updated) throw new HttpError('The game changed while you were moving — please retry', 409);

  if (patch.outcome) {
    await onFinished(updated);
  } else {
    await emitSession(updated, 'game:state');
    armTimer(updated);
  }
  return updated;
}

async function onFinished(row: GameSessionRow): Promise<void> {
  clearTimer(row.id);
  clearGraceTimers(row.id);

  const durationSec = row.started_at && row.ended_at
    ? Math.max(0, Math.round((Date.parse(row.ended_at) - Date.parse(row.started_at)) / 1000))
    : 0;

  const resultFor = (userId: string): 'win' | 'loss' | 'draw' =>
    row.is_draw ? 'draw' : row.winner_id === userId ? 'win' : 'loss';

  try {
    await gameModel.insertResults(
      [row.host_id, row.guest_id].map((userId) => {
        const result = resultFor(userId);
        return {
          session_id: row.id,
          user_id: userId,
          opponent_id: otherPlayer(row, userId),
          game_id: row.game_id,
          result,
          points: engine.pointsFor(result),
          score: userId === row.host_id ? row.host_score : row.guest_score,
          duration_sec: durationSec,
        };
      }),
    );
  } catch (err) {
    console.error('[game] Failed to record results:', err);
  }

  await emitSession(row, 'game:state');
  await emitSession(row, 'game:ended', { reason: row.end_reason });
  emitInviteUpdated(row);

  rematchVotes.set(row.id, { voters: new Set(), expiresAt: Date.now() + REMATCH_WINDOW_MS });
  void awardMatchTask(row).catch((err) => console.error('[game] play_game award failed:', err));
}

/**
 * Matched pairs earn the `play_game` daily task after ≥ 5 minutes of real
 * play together on the same PHT day (summed across duels + rematches, since a
 * single Tic-Tac-Toe round is far shorter than that). Idempotent per day —
 * matchTasks.completeTask only ever awards once.
 */
async function awardMatchTask(row: GameSessionRow): Promise<void> {
  if (!row.match_id || !row.started_at) return;

  const phtNow = new Date(Date.now() + 8 * 3_600_000);
  const dayStartIso = new Date(`${phtNow.toISOString().slice(0, 10)}T00:00:00+08:00`).toISOString();

  const seconds = await gameModel.sumPlayedSecondsForMatch(row.match_id, dayStartIso, PER_GAME_COUNTED_CAP_SECONDS);
  if (seconds < PLAY_GAME_MIN_SECONDS) return;

  await Promise.all([
    matchTasksService.onGameSessionCompleted(row.match_id, row.host_id),
    matchTasksService.onGameSessionCompleted(row.match_id, row.guest_id),
  ]);
}

// ── Relationship / invite ────────────────────────────────────────────────────

async function resolveRelationship(hostId: string, guestId: string) {
  const [allies, match] = await Promise.all([
    interactionModel.isAllies(hostId, guestId),
    matchModel.findActiveMatchBetweenUsers(hostId, guestId),
  ]);

  const usableMatch =
    match && (match.status === 'chatting' || match.status === 'confirmed') && match.conversation_id ? match : null;

  if (!allies && !usableMatch) {
    throw new HttpError('You can only invite your allies or your matched partner to a game', 403);
  }

  let conversationId: string | null = usableMatch?.conversation_id ?? null;
  if (!conversationId) {
    conversationId =
      (await conversationModel.findAlliedConversationId(hostId, guestId)) ??
      (await conversationModel.findSharedConversationId(hostId, guestId));
  }
  if (!conversationId && allies) {
    conversationId = await conversationModel.createConversation('allied');
    await conversationModel.addMembers(conversationId, [hostId, guestId]);
  }
  if (!conversationId) throw new HttpError('No conversation found for these players', 404);

  return { conversationId, matchId: usableMatch?.id ?? null };
}

function enforceInviteRate(userId: string): void {
  const now = Date.now();
  const recent = (inviteRate.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= INVITES_PER_MINUTE) {
    throw new HttpError('You are sending invites too quickly — slow down a little', 429);
  }
  recent.push(now);
  inviteRate.set(userId, recent);
}

export async function createInvite(hostId: string, friendId: string, gameId: unknown): Promise<PublicGameSession> {
  if (!engine.isGameId(gameId)) throw new HttpError('Unknown game', 400);
  if (!friendId || typeof friendId !== 'string') throw new HttpError('friendId is required', 400);
  if (friendId === hostId) throw new HttpError('You cannot invite yourself', 400);

  enforceInviteRate(hostId);

  if (await moderationModel.isBlocked(hostId, friendId)) {
    throw new HttpError('You cannot invite this user', 403);
  }

  const busy = await gameModel.findActiveSessionForUser(hostId);
  if (busy) throw new HttpError('Finish or leave your current game before starting another', 409);

  const { conversationId, matchId } = await resolveRelationship(hostId, friendId);

  // Supersede any older still-open invite to the same person.
  const stale = await gameModel.listOpenInvitesBetween(hostId, friendId);
  for (const old of stale) {
    const cancelled = await gameModel.updateSession(old.id, old.updated_at, { status: 'cancelled', ended_at: new Date().toISOString() });
    if (cancelled) {
      await emitSession(cancelled, 'game:invite_cancelled');
      emitInviteUpdated(cancelled);
    }
  }

  let row = await gameModel.insertSession({
    gameId,
    hostId,
    guestId: friendId,
    conversationId,
    matchId,
    status: 'invited',
    inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
  });

  // Drop the invite into the chat thread. Deliberately NOT routed through
  // conversation.sendMessage: an invite shouldn't count as a streak /
  // `send_message` task message.
  const content = `🎮 Game invite: ${engine.GAME_NAMES[gameId]}`;
  try {
    const message = await conversationModel.insertMessage({ conversationId, senderId: hostId, content });
    await gameModel.setInviteMessageId(row.id, message.id);
    row = { ...row, invite_message_id: message.id };
    await conversationModel.touchConversation(conversationId);
    await conversationModel.unhideForUser(conversationId, friendId);

    const [decorated] = await conversationModel.attachGameInvites([message]);
    const payload = { conversationId, message: { ...decorated, status: 'sent' } };
    emitToUser(friendId, 'conversation:message_new', payload);
    emitToUser(hostId, 'conversation:message_new', payload);
  } catch (err) {
    console.error('[game] Failed to post invite message:', err);
  }

  // Push + in-app notification (anonymity-aware sender name).
  void (async () => {
    try {
      const hostIdentity = await resolveIdentity(friendId, hostId, matchId);
      const { dispatchMessageNotification } = await import('./notificationEngine.service');
      await dispatchMessageNotification({
        recipientId: friendId,
        senderId: hostId,
        senderName: hostIdentity.name,
        conversationId,
        content,
        isAnonymous: hostIdentity.isAnonymous,
      });
    } catch (err) {
      console.error('[game] Invite notification failed:', err);
    }
  })();

  // Live popup for a guest who currently has the game portal open.
  const hostIdentityForGuest = await resolveIdentity(friendId, hostId, matchId);
  const guestView = await buildPublicSession(row, friendId);
  emitToUser(friendId, 'game:invite', { session: guestView, from: hostIdentityForGuest });

  return buildPublicSession(row, hostId);
}

// ── Invite responses ─────────────────────────────────────────────────────────

export function acceptInvite(sessionId: string, userId: string): Promise<PublicGameSession> {
  return runExclusive(sessionId, async () => {
    const row = await gameModel.findSessionById(sessionId);
    if (!row) throw new HttpError('Game not found', 404);
    if (row.guest_id !== userId) throw new HttpError('Only the invited player can accept', 403);

    const status = gameModel.effectiveStatus(row);
    if (status === 'active') return buildPublicSession(row, userId); // idempotent
    if (status !== 'invited') throw new HttpError(`This invite is no longer available (${status})`, 409);

    const [guestBusy, hostBusy] = await Promise.all([
      gameModel.findActiveSessionForUser(row.guest_id),
      gameModel.findActiveSessionForUser(row.host_id),
    ]);
    if (guestBusy) throw new HttpError('You are already in a game', 409);
    if (hostBusy) throw new HttpError('Your friend is already in another game', 409);

    const started = await activate(row);
    return buildPublicSession(started, userId);
  });
}

async function activate(row: GameSessionRow): Promise<GameSessionRow> {
  const now = Date.now();
  const initial = engine.initState(row.game_id, row.host_id, row.guest_id, now);
  const updated = await gameModel.updateSession(row.id, row.updated_at, {
    status: 'active',
    state: initial.state,
    turn_user_id: initial.turnUserId,
    host_score: initial.hostScore,
    guest_score: initial.guestScore,
    started_at: new Date(now).toISOString(),
    winner_id: null,
    is_draw: false,
    end_reason: null,
  });
  if (!updated) throw new HttpError('The invite changed — please try again', 409);

  await emitSession(updated, 'game:accepted');
  await emitSession(updated, 'game:state');
  emitInviteUpdated(updated);
  armTimer(updated);

  // If a player never actually shows up, don't leave the other one hanging.
  setTimeout(() => {
    void enforceInitialJoin(updated.id).catch((err) => console.error('[game] join check failed:', err));
  }, INITIAL_JOIN_GRACE_MS);

  return updated;
}

async function enforceInitialJoin(sessionId: string): Promise<void> {
  await runExclusive(sessionId, async () => {
    const row = await gameModel.findSessionById(sessionId);
    if (!row || row.status !== 'active') return;

    const here = presence.get(sessionId);
    const hostHere = Boolean(here?.get(row.host_id)?.size);
    const guestHere = Boolean(here?.get(row.guest_id)?.size);
    if (hostHere && guestHere) return;

    if (!hostHere && !guestHere) {
      await closeWithoutResult(row, 'abandoned');
      return;
    }
    await commit(row, engine.forfeit(toEngine(row), hostHere ? row.guest_id : row.host_id));
  });
}

export function declineInvite(sessionId: string, userId: string): Promise<PublicGameSession> {
  return runExclusive(sessionId, async () => {
    const row = await gameModel.findSessionById(sessionId);
    if (!row) throw new HttpError('Game not found', 404);
    if (row.guest_id !== userId) throw new HttpError('Only the invited player can decline', 403);
    if (gameModel.effectiveStatus(row) !== 'invited') {
      throw new HttpError('This invite is no longer pending', 409);
    }
    const updated = await gameModel.updateSession(row.id, row.updated_at, {
      status: 'declined',
      ended_at: new Date().toISOString(),
    });
    if (!updated) throw new HttpError('The invite changed — please try again', 409);
    await emitSession(updated, 'game:declined');
    emitInviteUpdated(updated);
    return buildPublicSession(updated, userId);
  });
}

export function cancelInvite(sessionId: string, userId: string): Promise<PublicGameSession> {
  return runExclusive(sessionId, async () => {
    const row = await gameModel.findSessionById(sessionId);
    if (!row) throw new HttpError('Game not found', 404);
    if (row.host_id !== userId) throw new HttpError('Only the inviter can cancel', 403);
    if (gameModel.effectiveStatus(row) !== 'invited') {
      throw new HttpError('This invite is no longer pending', 409);
    }
    const updated = await gameModel.updateSession(row.id, row.updated_at, {
      status: 'cancelled',
      ended_at: new Date().toISOString(),
    });
    if (!updated) throw new HttpError('The invite changed — please try again', 409);
    await emitSession(updated, 'game:invite_cancelled');
    emitInviteUpdated(updated);
    return buildPublicSession(updated, userId);
  });
}

async function closeWithoutResult(row: GameSessionRow, status: 'abandoned' | 'expired'): Promise<void> {
  const updated = await gameModel.updateSession(row.id, row.updated_at, {
    status,
    ended_at: new Date().toISOString(),
    end_reason: status,
  });
  if (!updated) return;
  clearTimer(row.id);
  clearGraceTimers(row.id);
  await emitSession(updated, 'game:ended', { reason: status });
  emitInviteUpdated(updated);
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getSession(sessionId: string, userId: string): Promise<PublicGameSession> {
  const row = await gameModel.findSessionById(sessionId);
  if (!row) throw new HttpError('Game not found', 404);
  assertParticipant(row, userId);
  return buildPublicSession(row, userId);
}

/** Resume support: the player's live game (if any) plus invites waiting for them. */
export async function getMyOpenState(userId: string) {
  const [active, invites] = await Promise.all([
    gameModel.findActiveSessionForUser(userId),
    gameModel.listPendingInvitesForUser(userId),
  ]);
  return {
    active: active ? await buildPublicSession(active, userId) : null,
    invites: await Promise.all(
      invites.map(async (row) => ({
        session: await buildPublicSession(row, userId),
        from: await resolveIdentity(userId, row.host_id, row.match_id),
      })),
    ),
  };
}

// ── Gameplay ─────────────────────────────────────────────────────────────────

/** Socket `game:join` — (re)attach a socket to a session and return its fresh state. */
export function joinSession(sessionId: string, userId: string, socketId: string): Promise<PublicGameSession> {
  return runExclusive(sessionId, async () => {
    let row = await gameModel.findSessionById(sessionId);
    if (!row) throw new HttpError('Game not found', 404);
    assertParticipant(row, userId);

    if (row.status === 'active') {
      // Catch up on any deadline that elapsed while nobody was looking.
      const patch = engine.tick(toEngine(row), Date.now());
      if (patch) row = await commit(row, patch);
    }

    let sessionPresence = presence.get(sessionId);
    if (!sessionPresence) {
      sessionPresence = new Map();
      presence.set(sessionId, sessionPresence);
    }
    const sockets = sessionPresence.get(userId) ?? new Set<string>();
    sockets.add(socketId);
    sessionPresence.set(userId, sockets);

    const graceKey = `${sessionId}:${userId}`;
    const grace = graceTimers.get(graceKey);
    if (grace) {
      clearTimeout(grace);
      graceTimers.delete(graceKey);
      emitToUser(otherPlayer(row, userId), 'game:opponent_back', { sessionId });
    }

    if (row.status === 'active' && !timers.has(sessionId)) armTimer(row);
    return buildPublicSession(row, userId);
  });
}

export function handleMove(sessionId: string, userId: string, move: unknown): Promise<void> {
  return runExclusive(sessionId, async () => {
    let row = await gameModel.findSessionById(sessionId);
    if (!row) throw new HttpError('Game not found', 404);
    assertParticipant(row, userId);
    if (row.status !== 'active') throw new HttpError('This game is not active', 409);

    const overdue = engine.tick(toEngine(row), Date.now());
    if (overdue) {
      row = await commit(row, overdue);
      if (row.status !== 'active') return;
    }

    const patch = engine.applyMove(toEngine(row), userId, move, Date.now());
    await commit(row, patch);
  });
}

/** Player explicitly leaves a live game → opponent wins. */
export function leaveSession(sessionId: string, userId: string): Promise<void> {
  return runExclusive(sessionId, async () => {
    const row = await gameModel.findSessionById(sessionId);
    if (!row) return;
    assertParticipant(row, userId);
    if (row.status !== 'active') return;
    emitToUser(otherPlayer(row, userId), 'game:opponent_left', { sessionId });
    await commit(row, engine.forfeit(toEngine(row), userId));
  });
}

// ── Disconnect handling ──────────────────────────────────────────────────────

function clearGraceTimers(sessionId: string): void {
  for (const [key, timer] of graceTimers) {
    if (key.startsWith(`${sessionId}:`)) {
      clearTimeout(timer);
      graceTimers.delete(key);
    }
  }
  presence.delete(sessionId);
}

/** Called by the socket layer when a socket drops. */
export function handleSocketDisconnect(userId: string, socketId: string): void {
  for (const [sessionId, users] of presence) {
    const sockets = users.get(userId);
    if (!sockets || !sockets.delete(socketId)) continue;
    if (sockets.size > 0) continue;

    void (async () => {
      const row = await gameModel.findSessionById(sessionId).catch(() => null);
      if (!row || row.status !== 'active') return;

      emitToUser(otherPlayer(row, userId), 'game:opponent_disconnected', {
        sessionId,
        graceMs: DISCONNECT_GRACE_MS,
      });

      const key = `${sessionId}:${userId}`;
      const existing = graceTimers.get(key);
      if (existing) clearTimeout(existing);
      graceTimers.set(
        key,
        setTimeout(() => {
          graceTimers.delete(key);
          void abandonAfterGrace(sessionId, userId).catch((err) => console.error('[game] abandon failed:', err));
        }, DISCONNECT_GRACE_MS),
      );
    })();
  }
}

async function abandonAfterGrace(sessionId: string, userId: string): Promise<void> {
  await runExclusive(sessionId, async () => {
    const row = await gameModel.findSessionById(sessionId);
    if (!row || row.status !== 'active') return;
    if (presence.get(sessionId)?.get(userId)?.size) return; // came back in time
    emitToUser(otherPlayer(row, userId), 'game:opponent_left', { sessionId });
    await commit(row, engine.forfeit(toEngine(row), userId));
  });
}

// ── Rematch ──────────────────────────────────────────────────────────────────

export function requestRematch(sessionId: string, userId: string): Promise<PublicGameSession | null> {
  return runExclusive(sessionId, async () => {
    const row = await gameModel.findSessionById(sessionId);
    if (!row) throw new HttpError('Game not found', 404);
    assertParticipant(row, userId);
    if (row.status !== 'finished') throw new HttpError('You can only rematch a finished game', 409);

    const vote = rematchVotes.get(sessionId);
    if (!vote || vote.expiresAt < Date.now()) {
      rematchVotes.set(sessionId, { voters: new Set([userId]), expiresAt: Date.now() + REMATCH_WINDOW_MS });
      emitToUser(otherPlayer(row, userId), 'game:rematch_requested', { sessionId });
      return null;
    }
    vote.voters.add(userId);
    if (vote.voters.size < 2) {
      emitToUser(otherPlayer(row, userId), 'game:rematch_requested', { sessionId });
      return null;
    }

    rematchVotes.delete(sessionId);

    const [aBusy, bBusy] = await Promise.all([
      gameModel.findActiveSessionForUser(row.host_id),
      gameModel.findActiveSessionForUser(row.guest_id),
    ]);
    if (aBusy || bBusy) throw new HttpError('One of you is already in another game', 409);

    // Swap who goes first / guesses first.
    const next = await gameModel.insertSession({
      gameId: row.game_id,
      hostId: row.guest_id,
      guestId: row.host_id,
      conversationId: row.conversation_id,
      matchId: row.match_id,
      status: 'invited',
      rematchOf: row.id,
    });
    const started = await activate(next);
    await emitSession(started, 'game:rematch_started', { previousSessionId: sessionId });
    return buildPublicSession(started, userId);
  });
}

// ── Leaderboard ──────────────────────────────────────────────────────────────

export interface LeaderboardItem {
  rank: number;
  userId: string;
  fullName: string | null;
  username: string | null;
  avatarUrl: string | null;
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
  points: number;
  bestScore: number;
  isMe: boolean;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getLeaderboard(
  userId: string | undefined,
  gameId: unknown,
  scope: 'global' | 'friends',
  limit = 50,
): Promise<{ gameId: GameId; scope: string; items: LeaderboardItem[]; me: LeaderboardItem | null }> {
  const targetGame: GameId = engine.isGameId(gameId) ? gameId : 'clue';
  const cappedLimit = Math.min(Math.max(Math.floor(limit) || 50, 1), 100);
  const isValidUser = typeof userId === 'string' && UUID_REGEX.test(userId);

  let rows: gameModel.LeaderboardRow[];
  if (scope === 'friends' && isValidUser) {
    const allyIds = await findAcceptedConnectionIds(userId);
    rows = await gameModel.listLeaderboard(targetGame, { userIds: [...allyIds, userId], limit: 200 });
  } else if (scope === 'friends' && !isValidUser) {
    rows = [];
  } else {
    rows = await gameModel.listLeaderboard(targetGame, { limit: cappedLimit });
  }

  // For the global board the caller may sit below the visible cut-off.
  let meRow = isValidUser ? rows.find((r) => r.user_id === userId) ?? null : null;
  let meRank: number | null = meRow ? rows.indexOf(meRow) + 1 : null;
  if (!meRow && scope === 'global' && isValidUser) {
    meRow = await gameModel.getLeaderboardRow(userId, targetGame);
    if (meRow) meRank = (await gameModel.countPlayersAhead(meRow)) + 1;
  }

  const idsToLoad = [...new Set([...rows.map((r) => r.user_id), ...(meRow ? [meRow.user_id] : [])])];
  const profiles = new Map((await gameModel.findProfilesByIds(idsToLoad)).map((p) => [p.id, p]));

  const toItem = (row: gameModel.LeaderboardRow, rank: number): LeaderboardItem => {
    const profile = profiles.get(row.user_id);
    return {
      rank,
      // NOTE: key names (userId / fullName / username / avatarUrl) are what the
      // global anonymity middleware keys on — non-allies are masked automatically.
      userId: row.user_id,
      fullName: profile?.full_name ?? null,
      username: profile?.username ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      gamesPlayed: row.games_played,
      points: row.points,
      bestScore: row.best_score,
      isMe: Boolean(isValidUser && row.user_id === userId),
    };
  };

  return {
    gameId: targetGame,
    scope,
    items: rows.slice(0, scope === 'friends' ? 200 : cappedLimit).map((row, i) => toItem(row, i + 1)),
    me: meRow && meRank ? toItem(meRow, meRank) : null,
  };
}

export async function getMyStats(userId: string) {
  const rows = await gameModel.listStatsForUser(userId);
  const perGame = Object.fromEntries(
    engine.GAME_IDS.map((id) => {
      const row = rows.find((r) => r.game_id === id);
      return [
        id,
        {
          wins: row?.wins ?? 0,
          losses: row?.losses ?? 0,
          draws: row?.draws ?? 0,
          gamesPlayed: row?.games_played ?? 0,
          points: row?.points ?? 0,
          bestScore: row?.best_score ?? 0,
        },
      ];
    }),
  );
  return { perGame };
}

// ── Sweeper (safety net + restart recovery) ──────────────────────────────────

async function sweep(): Promise<void> {
  const nowIso = new Date().toISOString();

  // 1. Expire stale invites (and refresh their chat cards).
  for (const row of await gameModel.listStaleInvites(nowIso)) {
    await runExclusive(row.id, async () => {
      const fresh = await gameModel.findSessionById(row.id);
      if (!fresh || fresh.status !== 'invited') return;
      await closeWithoutResult(fresh, 'expired');
    });
  }

  // 2. Re-arm timers after a restart, run overdue ticks, and reap dead sessions.
  for (const row of await gameModel.listActiveSessions()) {
    if (Date.now() - Date.parse(row.updated_at) > STALE_ACTIVE_MS) {
      await runExclusive(row.id, async () => {
        const fresh = await gameModel.findSessionById(row.id);
        if (fresh?.status === 'active') await closeWithoutResult(fresh, 'abandoned');
      });
      continue;
    }
    if (!timers.has(row.id)) {
      await tickSession(row.id);
    }
  }

  // 3. Tidy in-memory caches.
  const now = Date.now();
  for (const [id, vote] of rematchVotes) if (vote.expiresAt < now) rematchVotes.delete(id);
  for (const [key, entry] of identityCache) if (now - entry.at > IDENTITY_TTL_MS) identityCache.delete(key);
}

let sweeperStarted = false;
export function initGameSweeper(): void {
  if (sweeperStarted) return;
  sweeperStarted = true;
  const run = () => void sweep().catch((err) => {
    // Tables may not be migrated yet — never take the server down for that.
    console.warn('[game] sweep skipped:', err?.message ?? err);
  });
  run();
  setInterval(run, SWEEP_INTERVAL_MS).unref?.();
}
