// src/app/models/adminReports.model.ts

import { supabaseAdmin } from '../../config/supabase';
import { resolveRealFullName } from './adminUsers.model';
import type {
  AdminReportListItem,
  AdminReportMessage,
  AdminReportMessageDetail,
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
  if (r.internal_notes && typeof r.internal_notes === 'string') {
    const match = r.internal_notes.match(/\[MSG:([a-f0-9-]+)\]/i);
    if (match) return match[1];
  }
  return null;
}

const LEADING_TAG_RE = /^\s*(\[(?:POST|MSG):[a-f0-9-]+\])\s*/i;

/** Leading `[POST:..]` / `[MSG:..]` tag of an existing report, kept when admin notes are rewritten. */
function leadingTag(internalNotes: string | null | undefined): string {
  if (!internalNotes) return '';
  const match = internalNotes.match(LEADING_TAG_RE);
  return match ? match[1] : '';
}

function withTag(tag: string, notes: string): string {
  const trimmed = notes.replace(LEADING_TAG_RE, '').trim();
  if (!tag) return trimmed;
  return trimmed ? `${tag} ${trimmed}` : tag;
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

  const violationIds = [...new Set(rows.map((r) => r.violation_id))];
  const postIds = [...new Set(rows.map(extractPostId).filter(Boolean))] as string[];
  const messageIds = [...new Set(rows.map(extractMessageId).filter(Boolean))] as string[];
  const messageDetails = await loadMessageDetails(messageIds);

  // Fetch posts and media if any post reports exist
  let posts: any[] = [];
  let postMedia: any[] = [];
  if (postIds.length > 0) {
    const [postsRes, mediaRes] = await Promise.all([
      supabaseAdmin.from('posts').select('id, author_id, content, audience, likes_count, comments_count, created_at').in('id', postIds),
      supabaseAdmin.from('post_media').select('id, post_id, url, position').in('post_id', postIds).order('position', { ascending: true }),
    ]);
    if (postsRes.error) console.error('[adminReports.attachLookups] posts error:', postsRes.error);
    if (mediaRes.error) console.error('[adminReports.attachLookups] post_media error:', mediaRes.error);
    posts = postsRes.data ?? [];
    postMedia = mediaRes.data ?? [];
  }

  const postAuthorIds = posts.map((p) => p.author_id).filter(Boolean);
  const userIds = [...new Set([...rows.flatMap((r) => [r.reporter_id, r.reported_user_id]), ...postAuthorIds].filter(Boolean))];

  const [violationsRes, categoriesRes, profilesRes] = await Promise.all([
    supabaseAdmin.from('violations').select('id, label, category_id').in('id', violationIds),
    supabaseAdmin.from('report_categories').select('id, label'),
    supabaseAdmin.from('profiles').select('id, username, full_name, avatar_url, email').in('id', userIds),
  ]);
  if (violationsRes.error) throw violationsRes.error;
  if (categoriesRes.error) throw categoriesRes.error;
  if (profilesRes.error) throw profilesRes.error;

  const violationById = new Map((violationsRes.data ?? []).map((v) => [v.id, v]));
  const categoryLabelById = new Map((categoriesRes.data ?? []).map((c) => [c.id, c.label as string]));
  const profileById = new Map((profilesRes.data ?? []).map((p) => [p.id, p]));
  const postById = new Map(posts.map((p) => [p.id, p]));

  const mediaByPostId = new Map<string, { id: string; url: string; position: number }[]>();
  for (const m of postMedia) {
    const arr = mediaByPostId.get(m.post_id) ?? [];
    arr.push({ id: m.id, url: m.url, position: m.position });
    mediaByPostId.set(m.post_id, arr);
  }

  return rows.map((r) => {
    const violation = violationById.get(r.violation_id) as { id: string; label: string; category_id: string } | undefined;
    const postId = extractPostId(r);
    const messageId = extractMessageId(r);
    const messageObj = messageId ? messageDetails.get(messageId) ?? null : null;
    const postData = postId ? postById.get(postId) : null;
    const reporterProfile = r.reporter_id ? profileById.get(r.reporter_id) : null;
    const reportedProfile = r.reported_user_id ? profileById.get(r.reported_user_id) : null;

    let postObj = null;
    if (postId) {
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
          media: mediaByPostId.get(postData.id) ?? [],
          is_deleted: false,
        };
      } else {
        postObj = {
          id: postId,
          author_id: r.reported_user_id ?? '',
          author_username: reportedProfile?.username ?? r.reported_username_snapshot ?? null,
          author_name: resolveRealFullName(reportedProfile),
          author_avatar: reportedProfile?.avatar_url ?? null,
          content: '[This post has been removed or deleted]',
          audience: 'public',
          likes_count: 0,
          comments_count: 0,
          created_at: r.created_at,
          media: [],
          is_deleted: true,
        };
      }
    }

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
      post_id: postId,
      post: postObj,
      message_id: messageId,
      message: messageId
        ? messageObj ?? {
            id: messageId,
            conversation_id: r.conversation_id ?? null,
            sender_id: r.reported_user_id ?? null,
            sender_username: reportedProfile?.username ?? null,
            sender_name: resolveRealFullName(reportedProfile),
            sender_avatar: reportedProfile?.avatar_url ?? null,
            content: '[This message has been removed or deleted]',
            image_url: null,
            created_at: r.created_at,
            is_deleted: true,
            is_reported: true,
            context: [],
          }
        : null,
      status: r.status,
      internal_notes: r.internal_notes,
      created_at: r.created_at,
      reviewed_at: r.reviewed_at,
    };
  });
}

export async function listReports(params: ListReportsParams): Promise<{ items: AdminReportListItem[]; total: number }> {
  const { status = 'all', categoryId, cursor, limit = 20, targetType = 'all' } = params;
  const offset = cursor ? Number(cursor) || 0 : 0;

  let query = supabaseAdmin.from('reports').select('*', { count: 'exact' });
  if (status !== 'all') query = query.eq('status', status);

  if (targetType === 'post') {
    query = query.ilike('internal_notes', '%[POST:%');
  } else if (targetType === 'message') {
    query = query.ilike('internal_notes', '%[MSG:%');
  } else if (targetType === 'user') {
    query = query.or('internal_notes.is.null,and(internal_notes.not.ilike.%[POST:%,internal_notes.not.ilike.%[MSG:%)');
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
  const update: Record<string, unknown> = { status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() };
  if (notes !== undefined) update.internal_notes = withTag(await currentTag(reportId), notes);
  const { error } = await supabaseAdmin.from('reports').update(update).eq('id', reportId);
  if (error) throw error;
}

async function currentTag(reportId: string): Promise<string> {
  const { data } = await supabaseAdmin.from('reports').select('internal_notes').eq('id', reportId).maybeSingle();
  return leadingTag(data?.internal_notes as string | null | undefined);
}

export async function setInternalNotes(reportId: string, notes: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('reports')
    .update({ internal_notes: withTag(await currentTag(reportId), notes) })
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
