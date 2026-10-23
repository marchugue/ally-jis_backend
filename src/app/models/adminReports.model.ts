// src/app/models/adminReports.model.ts

import { supabaseAdmin } from '../../config/supabase';
import { resolveRealFullName } from './adminUsers.model';
import type {
  AdminReportListItem,
  AdminReportMessage,
  AdminReportMessageDetail,
  AdminReportPost,
  ListReportsParams,
  ReportStatus,
} from '../types/adminReports.types';

function extractPostId(r: any): string | null {
  if (r.post_id) return String(r.post_id);
  if (r.internal_notes && typeof r.internal_notes === 'string') {
    const match = r.internal_notes.match(/\[POST:([a-f0-9-]+)\]/i);
    if (match) return match[1];
  }
  return null;
}

function extractMessageId(r: any): string | null {
  if (r.message_id) return String(r.message_id);
  if (r.internal_notes && typeof r.internal_notes === 'string') {
    const match = r.internal_notes.match(/\[MSG:([a-f0-9-]+)\]/i);
    if (match) return match[1];
  }
  return null;
}

const LEADING_TAG_RE = /^\s*(\[(?:POST|MSG):[a-f0-9-]+\])\s*/i;

/** Strips any legacy `[POST:..]` / `[MSG:..]` reference tag from notes. */
function stripReferenceTag(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(LEADING_TAG_RE, '').trim();
}

const MESSAGE_CONTEXT_RADIUS = 3;
const MESSAGE_COLUMNS = 'id, conversation_id, sender_id, content, image_url, created_at, is_deleted, deleted_at';

/** Fetches reported messages plus a few neighbours in the same conversation, with sender identities. */
async function loadMessageDetails(messageIds: string[]): Promise<Map<string, AdminReportMessageDetail>> {
  const result = new Map<string, AdminReportMessageDetail>();
  if (messageIds.length === 0) return result;

  const { data: reported, error } = await supabaseAdmin.from('messages').select(MESSAGE_COLUMNS).in('id', messageIds);
  if (error) {
    console.error('[adminReports.loadMessageDetails] messages error:', error);
    return result;
  }

  const contextByMessage = new Map<string, any[]>();
  await Promise.all(
    (reported ?? []).map(async (m: any) => {
      if (!m.conversation_id) {
        contextByMessage.set(m.id, [m]);
        return;
      }
      const [beforeRes, afterRes] = await Promise.all([
        supabaseAdmin
          .from('messages')
          .select(MESSAGE_COLUMNS)
          .eq('conversation_id', m.conversation_id)
          .lt('created_at', m.created_at)
          .order('created_at', { ascending: false })
          .limit(MESSAGE_CONTEXT_RADIUS),
        supabaseAdmin
          .from('messages')
          .select(MESSAGE_COLUMNS)
          .eq('conversation_id', m.conversation_id)
          .gt('created_at', m.created_at)
          .order('created_at', { ascending: true })
          .limit(MESSAGE_CONTEXT_RADIUS),
      ]);
      const before = [...(beforeRes.data ?? [])].reverse();
      const after = afterRes.data ?? [];
      contextByMessage.set(m.id, [...before, m, ...after]);
    }),
  );

  const senderIds = [
    ...new Set([...contextByMessage.values()].flat().map((m: any) => m.sender_id).filter(Boolean)),
  ] as string[];
  const { data: senders } = senderIds.length
    ? await supabaseAdmin.from('profiles').select('id, username, full_name, avatar_url, email').in('id', senderIds)
    : { data: [] as any[] };
  const senderById = new Map((senders ?? []).map((p: any) => [p.id, p]));

  const toMessage = (m: any, reportedId: string): AdminReportMessage => {
    const sender = m.sender_id ? senderById.get(m.sender_id) : null;
    return {
      id: m.id,
      conversation_id: m.conversation_id ?? null,
      sender_id: m.sender_id ?? null,
      sender_username: sender?.username ?? null,
      sender_name: resolveRealFullName(sender),
      sender_avatar: sender?.avatar_url ?? null,
      content: m.content ?? '',
      image_url: m.image_url ?? null,
      created_at: m.created_at,
      is_deleted: Boolean(m.is_deleted || m.deleted_at),
      is_deleted_in_chat: Boolean(m.is_deleted || m.deleted_at),
      is_reported: m.id === reportedId,
    };
  };

  for (const m of reported ?? []) {
    const context = (contextByMessage.get(m.id) ?? [m]).map((c: any) => toMessage(c, m.id));
    result.set(m.id, { ...toMessage(m, m.id), context });
  }
  return result;
}

async function attachLookups(rows: any[]): Promise<AdminReportListItem[]> {
  if (rows.length === 0) return [];

  const reportIds = rows.map((r) => r.id);
  const violationIds = [...new Set(rows.map((r) => r.violation_id))];

  // 1. Fetch snapshots from dedicated snapshot tables
  const [msgSnapRes, postSnapRes] = await Promise.all([
    supabaseAdmin.from('reported_message_snapshots').select('*').in('report_id', reportIds),
    supabaseAdmin.from('reported_post_snapshots').select('*').in('report_id', reportIds),
  ]);
  if (msgSnapRes.error) console.error('[adminReports.attachLookups] msg snapshots error:', msgSnapRes.error);
  if (postSnapRes.error) console.error('[adminReports.attachLookups] post snapshots error:', postSnapRes.error);

  const msgSnapshotByReportId = new Map((msgSnapRes.data ?? []).map((s: any) => [s.report_id, s]));
  const postSnapshotByReportId = new Map((postSnapRes.data ?? []).map((s: any) => [s.report_id, s]));

  // Legacy fallback post/message IDs for rows without snapshot records
  const legacyPostIds = [
    ...new Set(
      rows
        .filter((r) => !postSnapshotByReportId.has(r.id))
        .map(extractPostId)
        .filter(Boolean),
    ),
  ] as string[];
  const legacyMessageIds = [
    ...new Set(
      rows
        .filter((r) => !msgSnapshotByReportId.has(r.id))
        .map(extractMessageId)
        .filter(Boolean),
    ),
  ] as string[];

  // Check live messages status for all message reports (to see if student deleted in live chat)
  const allMessageIds = [
    ...new Set([
      ...legacyMessageIds,
      ...(msgSnapRes.data ?? []).map((s: any) => s.message_id).filter(Boolean),
    ]),
  ] as string[];
  const liveMessagesRes = allMessageIds.length
    ? await supabaseAdmin.from('messages').select('id, is_deleted, deleted_at').in('id', allMessageIds)
    : { data: [] as any[] };
  const liveMessageById = new Map((liveMessagesRes.data ?? []).map((m: any) => [m.id, m]));

  // Check live posts status for all post reports (to see if student deleted from feed)
  const allPostIds = [
    ...new Set([
      ...legacyPostIds,
      ...(postSnapRes.data ?? []).map((s: any) => s.post_id).filter(Boolean),
    ]),
  ] as string[];
  const livePostsRes = allPostIds.length
    ? await supabaseAdmin.from('posts').select('id').in('id', allPostIds)
    : { data: [] as any[] };
  const livePostIdSet = new Set((livePostsRes.data ?? []).map((p: any) => p.id));

  // Legacy lookups if needed
  const legacyMessageDetails = await loadMessageDetails(legacyMessageIds);
  let legacyPosts: any[] = [];
  let legacyPostMedia: any[] = [];
  if (legacyPostIds.length > 0) {
    const [postsRes, mediaRes] = await Promise.all([
      supabaseAdmin.from('posts').select('id, author_id, content, audience, likes_count, comments_count, created_at').in('id', legacyPostIds),
      supabaseAdmin.from('post_media').select('id, post_id, url, position').in('post_id', legacyPostIds).order('position', { ascending: true }),
    ]);
    legacyPosts = postsRes.data ?? [];
    legacyPostMedia = mediaRes.data ?? [];
  }
  const legacyPostById = new Map(legacyPosts.map((p) => [p.id, p]));
  const legacyMediaByPostId = new Map<string, { id: string; url: string; position: number }[]>();
  for (const m of legacyPostMedia) {
    const arr = legacyMediaByPostId.get(m.post_id) ?? [];
    arr.push({ id: m.id, url: m.url, position: m.position });
    legacyMediaByPostId.set(m.post_id, arr);
  }

  // User profile lookups
  const postAuthorIds = legacyPosts.map((p) => p.author_id).filter(Boolean);
  const userIds = [
    ...new Set([
      ...rows.flatMap((r) => [r.reporter_id, r.reported_user_id]),
      ...postAuthorIds,
    ].filter(Boolean)),
  ];

  const [violationsRes, categoriesRes, profilesRes] = await Promise.all([
    supabaseAdmin.from('violations').select('id, label, category_id').in('id', violationIds),
    supabaseAdmin.from('report_categories').select('id, label'),
    profilesResQuery(userIds),
  ]);
  if (violationsRes.error) throw violationsRes.error;
  if (categoriesRes.error) throw categoriesRes.error;

  const violationById = new Map((violationsRes.data ?? []).map((v) => [v.id, v]));
  const categoryLabelById = new Map((categoriesRes.data ?? []).map((c) => [c.id, c.label as string]));
  const profileById = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p]));

  return rows.map((r) => {
    const violation = violationById.get(r.violation_id) as { id: string; label: string; category_id: string } | undefined;
    const postId = extractPostId(r);
    const messageId = extractMessageId(r);
    const reporterProfile = r.reporter_id ? profileById.get(r.reporter_id) : null;
    const reportedProfile = r.reported_user_id ? profileById.get(r.reported_user_id) : null;

    // ── Build Post Object (Snapshot preferred) ───────────────────────────
    let postObj: AdminReportPost | null = null;
    const postSnapshot = postSnapshotByReportId.get(r.id);

    if (postSnapshot) {
      const isDeletedFromFeed = !livePostIdSet.has(postSnapshot.post_id);
      postObj = {
        id: postSnapshot.post_id,
        author_id: postSnapshot.author_id,
        author_username: postSnapshot.author_username,
        author_name: postSnapshot.author_name,
        author_avatar: postSnapshot.author_avatar,
        content: postSnapshot.content,
        audience: postSnapshot.audience || 'public',
        likes_count: postSnapshot.likes_count || 0,
        comments_count: postSnapshot.comments_count || 0,
        created_at: postSnapshot.post_created_at || r.created_at,
        media: Array.isArray(postSnapshot.media) ? postSnapshot.media : [],
        is_deleted: isDeletedFromFeed,
        is_deleted_from_feed: isDeletedFromFeed,
        is_preserved: true,
      };
    } else if (postId) {
      const postData = legacyPostById.get(postId);
      if (postData) {
        const postAuthor = profileById.get(postData.author_id);
        postObj = {
          id: postData.id,
          author_id: postData.author_id,
          author_username: postAuthor?.username ?? null,
          author_name: resolveRealFullName(postAuthor),
          author_avatar: postAuthor?.avatar_url ?? null,
          content: postData.content ?? '',
          audience: postData.audience ?? 'public',
          likes_count: postData.likes_count ?? 0,
          comments_count: postData.comments_count ?? 0,
          created_at: postData.created_at,
          media: legacyMediaByPostId.get(postData.id) ?? [],
          is_deleted: false,
          is_deleted_from_feed: false,
          is_preserved: false,
        };
      } else {
        postObj = {
          id: postId,
          author_id: r.reported_user_id ?? '',
          author_username: reportedProfile?.username ?? r.reported_username_snapshot ?? null,
          author_name: resolveRealFullName(reportedProfile),
          author_avatar: reportedProfile?.avatar_url ?? null,
          content: '[This post was deleted by user]',
          audience: 'public',
          likes_count: 0,
          comments_count: 0,
          created_at: r.created_at,
          media: [],
          is_deleted: true,
          is_deleted_from_feed: true,
          is_preserved: false,
        };
      }
    }

    // ── Build Message Object (Snapshot preferred) ────────────────────────
    let messageObj: AdminReportMessageDetail | null = null;
    const msgSnapshot = msgSnapshotByReportId.get(r.id);

    if (msgSnapshot) {
      const liveMsg = liveMessageById.get(msgSnapshot.message_id);
      const isDeletedInChat = !liveMsg || Boolean(liveMsg.is_deleted || liveMsg.deleted_at);

      // Context array from JSONB snapshot
      const rawContext = Array.isArray(msgSnapshot.context_messages) ? msgSnapshot.context_messages : [];
      const contextMessages: AdminReportMessage[] = rawContext.map((c: any) => ({
        id: c.id,
        conversation_id: c.conversation_id ?? msgSnapshot.conversation_id ?? null,
        sender_id: c.sender_id ?? null,
        sender_username: c.sender_username ?? null,
        sender_name: c.sender_name ?? 'User',
        sender_avatar: c.sender_avatar ?? null,
        content: c.content ?? '',
        image_url: c.image_url ?? null,
        created_at: c.created_at,
        is_deleted: Boolean(c.is_deleted),
        is_deleted_in_chat: Boolean(c.is_deleted),
        is_reported: c.id === msgSnapshot.message_id || Boolean(c.is_reported),
      }));

      messageObj = {
        id: msgSnapshot.message_id,
        conversation_id: msgSnapshot.conversation_id ?? null,
        sender_id: msgSnapshot.sender_id ?? null,
        sender_username: msgSnapshot.sender_username ?? null,
        sender_name: msgSnapshot.sender_name ?? resolveRealFullName(reportedProfile),
        sender_avatar: msgSnapshot.sender_avatar ?? reportedProfile?.avatar_url ?? null,
        content: msgSnapshot.content ?? '',
        image_url: msgSnapshot.image_url ?? null,
        created_at: msgSnapshot.message_created_at || r.created_at,
        is_deleted: isDeletedInChat,
        is_deleted_in_chat: isDeletedInChat,
        is_reported: true,
        is_preserved: true,
        context: contextMessages.length > 0 ? contextMessages : [
          {
            id: msgSnapshot.message_id,
            conversation_id: msgSnapshot.conversation_id ?? null,
            sender_id: msgSnapshot.sender_id ?? null,
            sender_username: msgSnapshot.sender_username ?? null,
            sender_name: msgSnapshot.sender_name ?? resolveRealFullName(reportedProfile),
            sender_avatar: msgSnapshot.sender_avatar ?? null,
            content: msgSnapshot.content ?? '',
            image_url: msgSnapshot.image_url ?? null,
            created_at: msgSnapshot.message_created_at || r.created_at,
            is_deleted: isDeletedInChat,
            is_deleted_in_chat: isDeletedInChat,
            is_reported: true,
          },
        ],
      };
    } else if (messageId) {
      const liveMsgDetail = legacyMessageDetails.get(messageId);
      if (liveMsgDetail) {
        messageObj = liveMsgDetail;
      } else {
        messageObj = {
          id: messageId,
          conversation_id: r.conversation_id ?? null,
          sender_id: r.reported_user_id ?? null,
          sender_username: reportedProfile?.username ?? null,
          sender_name: resolveRealFullName(reportedProfile),
          sender_avatar: reportedProfile?.avatar_url ?? null,
          content: '[This message was deleted by user]',
          image_url: null,
          created_at: r.created_at,
          is_deleted: true,
          is_deleted_in_chat: true,
          is_reported: true,
          is_preserved: false,
          context: [],
        };
      }
    }

    // Reporter notes priority: explicit column -> stripped internal notes
    const reporterNotes = r.reporter_notes || stripReferenceTag(r.internal_notes) || null;
    const internalNotes = r.reporter_notes ? (r.internal_notes || null) : (r.internal_notes && !r.internal_notes.match(/^\[(MSG|POST):/) ? r.internal_notes : null);

    return {
      id: r.id,
      reporter_id: r.reporter_id,
      reporter_username: reporterProfile?.username ?? r.reporter_username_snapshot ?? null,
      reporter_name: resolveRealFullName(reporterProfile),
      reporter_email: reporterProfile?.email ?? null,
      reporter_avatar: reporterProfile?.avatar_url ?? null,
      reported_user_id: r.reported_user_id,
      reported_username: reportedProfile?.username ?? r.reported_username_snapshot ?? null,
      reported_name: resolveRealFullName(reportedProfile),
      reported_email: reportedProfile?.email ?? null,
      reported_avatar: reportedProfile?.avatar_url ?? null,
      violation_id: r.violation_id,
      violation_label: violation?.label ?? r.violation_id,
      category_id: violation?.category_id ?? '',
      category_label: violation ? categoryLabelById.get(violation.category_id) ?? '' : '',
      conversation_id: r.conversation_id,
      post_id: postObj?.id || postId || null,
      post: postObj,
      message_id: messageObj?.id || messageId || null,
      message: messageObj,
      status: r.status,
      reporter_notes: reporterNotes,
      internal_notes: internalNotes,
      created_at: r.created_at,
      reviewed_at: r.reviewed_at,
    };
  });
}

async function profilesResQuery(userIds: string[]) {
  if (userIds.length === 0) return { data: [] as any[], error: null };
  return supabaseAdmin.from('profiles').select('id, username, full_name, avatar_url, email').in('id', userIds);
}

export async function listReports(params: ListReportsParams): Promise<{ items: AdminReportListItem[]; total: number }> {
  const { status = 'all', categoryId, cursor, limit = 20, targetType = 'all' } = params;
  const offset = cursor ? Number(cursor) || 0 : 0;

  let query = supabaseAdmin.from('reports').select('*', { count: 'exact' });
  if (status !== 'all') query = query.eq('status', status);

  if (targetType === 'post') {
    query = query.or('post_id.not.is.null,internal_notes.ilike.%[POST:%');
  } else if (targetType === 'message') {
    query = query.or('message_id.not.is.null,internal_notes.ilike.%[MSG:%');
  } else if (targetType === 'user') {
    query = query
      .is('post_id', null)
      .is('message_id', null)
      .or('internal_notes.is.null,and(internal_notes.not.ilike.%[POST:%,internal_notes.not.ilike.%[MSG:%)');
  }

  // Filtering by category requires knowing which violation ids belong to
  // it first, since reports only stores violation_id directly.
  if (categoryId) {
    const { data: violations, error } = await supabaseAdmin.from('violations').select('id').eq('category_id', categoryId);
    if (error) throw error;
    query = query.in('violation_id', (violations ?? []).map((v) => v.id));
  }

  query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  const items = await attachLookups(data ?? []);
  return { items, total: count ?? 0 };
}

export async function getReportById(reportId: string): Promise<AdminReportListItem | null> {
  const { data, error } = await supabaseAdmin.from('reports').select('*').eq('id', reportId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [item] = await attachLookups([data]);
  return item;
}

export async function updateStatus(reportId: string, status: ReportStatus, reviewerId: string, notes?: string): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    reviewed_by: reviewerId,
    reviewed_at: new Date().toISOString(),
  };
  if (notes !== undefined) {
    update.internal_notes = notes.trim() || null;
  }
  const { error } = await supabaseAdmin.from('reports').update(update).eq('id', reportId);
  if (error) throw error;
}

export async function setInternalNotes(reportId: string, notes: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('reports')
    .update({ internal_notes: notes.trim() || null })
    .eq('id', reportId);
  if (error) throw error;
}

export async function countByStatus(): Promise<Record<ReportStatus, number>> {
  const statuses: ReportStatus[] = ['pending', 'reviewing', 'resolved', 'rejected'];
  const counts = await Promise.all(
    statuses.map((s) => supabaseAdmin.from('reports').select('id', { count: 'exact', head: true }).eq('status', s)),
  );
  const result = {} as Record<ReportStatus, number>;
  statuses.forEach((s, i) => {
    result[s] = counts[i].count ?? 0;
  });
  return result;
}
