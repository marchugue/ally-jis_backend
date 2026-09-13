// src/app/models/adminReports.model.ts

import { supabaseAdmin } from '../../config/supabase';
import type { AdminReportListItem, ListReportsParams, ReportStatus } from '../types/adminReports.types';

function extractPostId(r: any): string | null {
  if (r.post_id) return String(r.post_id);
  if (r.internal_notes && typeof r.internal_notes === 'string') {
    const match = r.internal_notes.match(/\[POST:([a-f0-9-]+)\]/i);
    if (match) return match[1];
  }
  return null;
}

async function attachLookups(rows: any[]): Promise<AdminReportListItem[]> {
  if (rows.length === 0) return [];

  const violationIds = [...new Set(rows.map((r) => r.violation_id))];
  const postIds = [...new Set(rows.map(extractPostId).filter(Boolean))] as string[];

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
    supabaseAdmin.from('profiles').select('id, username, full_name, avatar_url').in('id', userIds),
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
          author_name: postAuthor?.full_name ?? null,
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
          author_name: reportedProfile?.full_name ?? null,
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
      reported_user_id: r.reported_user_id,
      reported_username: reportedProfile?.username ?? r.reported_username_snapshot ?? null,
      violation_id: r.violation_id,
      violation_label: violation?.label ?? r.violation_id,
      category_id: violation?.category_id ?? '',
      category_label: violation ? categoryLabelById.get(violation.category_id) ?? '' : '',
      conversation_id: r.conversation_id,
      post_id: postId,
      post: postObj,
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
  } else if (targetType === 'user') {
    query = query.or('internal_notes.is.null,internal_notes.not.ilike.%[POST:%');
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
  if (notes !== undefined) update.internal_notes = notes;
  const { error } = await supabaseAdmin.from('reports').update(update).eq('id', reportId);
  if (error) throw error;
}

export async function setInternalNotes(reportId: string, notes: string): Promise<void> {
  const { error } = await supabaseAdmin.from('reports').update({ internal_notes: notes }).eq('id', reportId);
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
