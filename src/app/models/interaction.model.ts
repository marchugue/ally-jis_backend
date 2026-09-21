import { supabaseAdmin } from '../../config/supabase';
import { emitToUser } from '../services/realtime.service';
import type { AllyListItem, InteractionRow, InteractionStatus } from '../types/interaction.types';
import { HttpError } from '../types/auth.types';

/**
 * GET /interactions
 * All interactions the current user initiated.
 */
export async function findAllByUser(userId: string): Promise<InteractionRow[]> {
  const { data, error } = await supabaseAdmin
    .from('user_interactions')
    .select('user_id, target_user_id, status, accepted_at')
    .eq('user_id', userId);

  if (error) throw error;
  return (data as InteractionRow[]) ?? [];
}

/**
 * POST /interactions/incoming
 * Interactions directed AT the current user, filtered to a given set of
 * requester ids (the frontend already knows which profiles it's asking about).
 */
export async function findIncomingFromRequesters(
  targetUserId: string,
  requesterIds: string[]
): Promise<InteractionRow[]> {
  if (requesterIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('user_interactions')
    .select('user_id, target_user_id, status, accepted_at')
    .eq('target_user_id', targetUserId)
    .in('user_id', requesterIds);

  if (error) throw error;
  return (data as InteractionRow[]) ?? [];
}

/**
 * Upserts a single interaction row (used by request/reject, and by the
 * accept flow to flip both directions to 'accepted').
 * Relies on the unique(user_id, target_user_id) constraint in schema.sql.
 */
export async function upsertInteraction(input: {
  userId: string;
  targetUserId: string;
  status: InteractionStatus;
  acceptedAt?: string | null;
}): Promise<void> {
  const { userId, targetUserId, status, acceptedAt = null } = input;

  if (status === 'accepted') {
    throw new HttpError(
      'Direct ally creation is forbidden. Allies are strictly formed upon completing Stage 4 of the matching roadmap.',
      403
    );
  }

  const { error } = await supabaseAdmin.from('user_interactions').upsert(
    {
      user_id: userId,
      target_user_id: targetUserId,
      status,
      accepted_at: acceptedAt,
    },
    { onConflict: 'user_id,target_user_id' }
  );

  if (error) throw error;
}

/**
 * Marks the requester -> current-user row as accepted (step 1 of accept).
 * Deprecated: direct status flips to 'accepted' are blocked to ensure ally security.
 */
export async function markAccepted(_userId: string, _targetUserId: string, _acceptedAt: string): Promise<void> {
  throw new HttpError(
    'Direct ally creation is forbidden. Allies are strictly formed upon completing Stage 4 of the matching roadmap.',
    403
  );
}

/**
 * GET /interactions/status/:targetUserId
 */
export async function findStatus(userId: string, targetUserId: string): Promise<InteractionStatus | null> {
  const { data, error } = await supabaseAdmin
    .from('user_interactions')
    .select('status')
    .eq('user_id', userId)
    .eq('target_user_id', targetUserId)
    .maybeSingle();

  if (error) throw error;
  return (data as { status: InteractionStatus } | null)?.status ?? null;
}

/**
 * Cancels a pending request the caller sent — deletes the row entirely
 * (not a status flip) so a fresh request later behaves the same as a
 * first-ever request. Scoped to `status = 'pending'` so this can't be
 * used to unilaterally erase an already-accepted relationship — that's
 * removeAlly's job, and it has to clear both directions.
 */
export async function cancelPendingRequest(userId: string, targetUserId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('user_interactions')
    .delete()
    .eq('user_id', userId)
    .eq('target_user_id', targetUserId)
    .eq('status', 'pending');
  if (error) throw error;
}

/**
 * Removes an accepted ally relationship — deletes both directions.
 * Deliberately leaves the shared conversation and its messages alone;
 * unfriending isn't meant to erase chat history.
 */
export async function removeAllyRows(userIdA: string, userIdB: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('user_interactions')
    .delete()
    .or(
      `and(user_id.eq.${userIdA},target_user_id.eq.${userIdB}),and(user_id.eq.${userIdB},target_user_id.eq.${userIdA})`,
    );
  if (error) throw error;
}

/**
 * Atomically establishes a symmetric accepted ally relationship between two users.
 * Triggered automatically when a match completes Stage 4 of the roadmap.
 */
export async function createAllyRelationship(userIdA: string, userIdB: string): Promise<void> {
  const acceptedAt = new Date().toISOString();
  const { error } = await supabaseAdmin.from('user_interactions').upsert(
    [
      { user_id: userIdA, target_user_id: userIdB, status: 'accepted', accepted_at: acceptedAt },
      { user_id: userIdB, target_user_id: userIdA, status: 'accepted', accepted_at: acceptedAt },
    ],
    { onConflict: 'user_id,target_user_id' },
  );
  if (error) throw error;
}

/**
 * Checks whether two users have an accepted ally relationship.
 */
export async function isAllies(userIdA: string, userIdB: string): Promise<boolean> {
  if (userIdA === userIdB) return true;

  try {
    // 1. Check user_interactions in either direction
    const { data: interactionData, error: interactionError } = await supabaseAdmin
      .from('user_interactions')
      .select('status')
      .or(
        `and(user_id.eq.${userIdA},target_user_id.eq.${userIdB}),and(user_id.eq.${userIdB},target_user_id.eq.${userIdA})`
      )
      .eq('status', 'accepted')
      .limit(1);

    if (!interactionError && interactionData && interactionData.length > 0) {
      return true;
    }

    // 2. Check active or revealed matches
    const { data: matchData, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('id, revealed_at, current_stage, status, user_a_id, user_b_id')
      .or(
        `and(user_a_id.eq.${userIdA},user_b_id.eq.${userIdB}),and(user_a_id.eq.${userIdB},user_b_id.eq.${userIdA})`
      )
      .in('status', ['chatting', 'confirmed'])
      .limit(1);

    if (!matchError && matchData && matchData.length > 0) {
      const match = matchData[0];
      if (match.revealed_at || (match.current_stage && match.current_stage >= 4)) {
        return true;
      }

      // Check if neither side has a pending friend_request notification
      const { data: notifData } = await supabaseAdmin
        .from('notifications')
        .select('id')
        .eq('type', 'friend_request')
        .or(
          `and(user_id.eq.${userIdA},from_user_id.eq.${userIdB}),and(user_id.eq.${userIdB},from_user_id.eq.${userIdA})`
        )
        .limit(1);

      if (!notifData || notifData.length === 0) {
        return true;
      }
    }
  } catch (err) {
    console.warn('[isAllies] Error checking ally relationship:', err);
  }

  return false;
}

const ALLY_PROFILE_COLUMNS = 'id, username, full_name, avatar_url, course, department, year_level';

export async function listAllies(
  userId: string,
  limit: number,
  offset: number,
  filters?: { search?: string; department?: string; course?: string; year_level?: string; sortBy?: 'recent' | 'name' }
): Promise<AllyListItem[]> {
  const { data, error } = await supabaseAdmin
    .from('user_interactions')
    .select(`accepted_at, target:profiles!user_interactions_target_user_id_fkey(${ALLY_PROFILE_COLUMNS})`)
    .eq('user_id', userId)
    .eq('status', 'accepted')
    .order('accepted_at', { ascending: false });

  if (error) throw error;

  let items = (data ?? [])
    .filter((row: any) => row.target)
    .map((row: any) => ({
      id: row.target.id,
      username: row.target.username ?? null,
      fullName: row.target.full_name ?? null,
      avatarUrl: row.target.avatar_url ?? null,
      course: row.target.course ?? null,
      department: row.target.department ?? null,
      yearLevel: row.target.year_level ?? null,
      alliedAt: row.accepted_at,
    }));

  if (filters?.search) {
    const s = filters.search.toLowerCase().trim();
    items = items.filter((item) =>
      (item.fullName?.toLowerCase() || '').includes(s) ||
      (item.username?.toLowerCase() || '').includes(s)
    );
  }

  if (filters?.department) {
    const d = filters.department.toLowerCase().trim();
    items = items.filter((item: any) => (item.department?.toLowerCase() || '') === d);
  }

  if (filters?.course) {
    const c = filters.course.toLowerCase().trim();
    items = items.filter((item) => (item.course?.toLowerCase() || '') === c);
  }

  if (filters?.year_level) {
    const y = filters.year_level.toLowerCase().trim();
    items = items.filter((item: any) => (item.yearLevel?.toLowerCase() || '') === y);
  }

  if (filters?.sortBy === 'name') {
    items.sort((a, b) => (a.fullName || a.username || '').localeCompare(b.fullName || b.username || ''));
  }

  return items.slice(offset, offset + limit);
}

/** Raw id set of accepted allies — used for mutual-allies computation. */
export async function getAllyIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from('user_interactions')
    .select('user_id, target_user_id')
    .eq('status', 'accepted')
    .or(`user_id.eq.${userId},target_user_id.eq.${userId}`);
  if (error) throw error;
  const ids = new Set<string>();
  for (const row of (data as { user_id: string; target_user_id: string }[]) ?? []) {
    ids.add(row.user_id === userId ? row.target_user_id : row.user_id);
  }
  return ids;
}

export async function getAlliesCount(userId: string): Promise<number> {
  const allyIds = await getAllyIds(userId);
  return allyIds.size;
}

/**
 * Finds a conversation shared by both users (mirrors get_shared_conversation
 * in schema.sql), used by the accept flow to avoid creating duplicate
 * conversations when one already exists.
 */
export async function findSharedConversationId(userIdA: string, userIdB: string): Promise<string | null> {
  const { data: ownRows, error: ownError } = await supabaseAdmin
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userIdA);

  if (ownError) throw ownError;

  const conversationIds = (ownRows ?? []).map((row) => row.conversation_id as string);
  if (conversationIds.length === 0) return null;

  const { data: sharedRows, error: sharedError } = await supabaseAdmin
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userIdB)
    .in('conversation_id', conversationIds)
    .limit(1);

  if (sharedError) throw sharedError;
  return (sharedRows?.[0]?.conversation_id as string | undefined) ?? null;
}

/**
 * Creates a new conversation row, returning its id.
 */
export async function createConversation(): Promise<string> {
  const { data, error } = await supabaseAdmin.from('conversations').insert({}).select('id').single();

  if (error) throw error;
  return (data as { id: string }).id;
}

/**
 * Adds both users as members of a conversation. Uses upsert so this is
 * safe to call even if one of them is already a member.
 */
export async function addConversationMembers(conversationId: string, userIds: string[]): Promise<void> {
  const rows = userIds.map((userId) => ({ conversation_id: conversationId, user_id: userId }));

  const { error } = await supabaseAdmin
    .from('conversation_members')
    .upsert(rows, { onConflict: 'conversation_id,user_id' });

  if (error) throw error;
}

/**
 * Inserts a notification row. Shared by request/accept flows.
 */
export async function createNotification(input: {
  userId: string;
  type: string;
  title: string;
  description: string;
  fromUserId?: string | null;
  targetId?: string | null;
  postId?: string | null;
  commentId?: string | null;
}): Promise<void> {
  const { userId, type, title, description, fromUserId, targetId, postId, commentId } = input;

  const insertPayload: Record<string, any> = {
    user_id: userId,
    type,
    title,
    description,
    from_user_id: fromUserId ?? null,
  };
  if (targetId) insertPayload.target_id = targetId;
  if (postId) insertPayload.post_id = postId;
  if (commentId) insertPayload.comment_id = commentId;

  let insertedData: any = null;
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .insert(insertPayload)
    .select()
    .maybeSingle();

  if (error) {
    const { data: fallbackData, error: fallbackError } = await supabaseAdmin
      .from('notifications')
      .insert({
        user_id: userId,
        type,
        title,
        description,
        from_user_id: fromUserId ?? null,
      })
      .select()
      .maybeSingle();
    if (fallbackError) throw fallbackError;
    insertedData = fallbackData;
  } else {
    insertedData = data;
  }

  try {
    emitToUser(
      userId,
      'notification:new',
      insertedData || {
        user_id: userId,
        type,
        title,
        description,
        from_user_id: fromUserId ?? null,
        target_id: targetId ?? null,
        created_at: new Date().toISOString(),
      }
    );
  } catch {
    // Non-blocking socket emission
  }
}
