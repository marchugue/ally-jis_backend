// src/app/models/adminReports.model.ts

import { supabaseAdmin } from '../../config/supabase';
import type { AdminReportListItem, ListReportsParams, ReportStatus } from '../types/adminReports.types';

async function attachLookups(rows: any[]): Promise<AdminReportListItem[]> {
  if (rows.length === 0) return [];

  const violationIds = [...new Set(rows.map((r) => r.violation_id))];
  const userIds = [...new Set(rows.flatMap((r) => [r.reporter_id, r.reported_user_id]).filter(Boolean))];

  const [violationsRes, categoriesRes, profilesRes] = await Promise.all([
    supabaseAdmin.from('violations').select('id, label, category_id').in('id', violationIds),
    supabaseAdmin.from('report_categories').select('id, label'),
    supabaseAdmin.from('profiles').select('id, username').in('id', userIds),
  ]);
  if (violationsRes.error) throw violationsRes.error;
  if (categoriesRes.error) throw categoriesRes.error;
  if (profilesRes.error) throw profilesRes.error;

  const violationById = new Map((violationsRes.data ?? []).map((v) => [v.id, v]));
  const categoryLabelById = new Map((categoriesRes.data ?? []).map((c) => [c.id, c.label as string]));
  const usernameById = new Map((profilesRes.data ?? []).map((p) => [p.id, p.username as string | null]));

  return rows.map((r) => {
    const violation = violationById.get(r.violation_id) as { id: string; label: string; category_id: string } | undefined;
    return {
      id: r.id,
      reporter_id: r.reporter_id,
      reporter_username: r.reporter_id ? usernameById.get(r.reporter_id) ?? r.reporter_username_snapshot : r.reporter_username_snapshot,
      reported_user_id: r.reported_user_id,
      reported_username: r.reported_user_id ? usernameById.get(r.reported_user_id) ?? r.reported_username_snapshot : r.reported_username_snapshot,
      violation_id: r.violation_id,
      violation_label: violation?.label ?? r.violation_id,
      category_id: violation?.category_id ?? '',
      category_label: violation ? categoryLabelById.get(violation.category_id) ?? '' : '',
      conversation_id: r.conversation_id,
      status: r.status,
      internal_notes: r.internal_notes,
      created_at: r.created_at,
      reviewed_at: r.reviewed_at,
    };
  });
}

export async function listReports(params: ListReportsParams): Promise<{ items: AdminReportListItem[]; total: number }> {
  const { status = 'all', categoryId, cursor, limit = 20 } = params;
  const offset = cursor ? Number(cursor) || 0 : 0;

  let query = supabaseAdmin.from('reports').select('*', { count: 'exact' });
  if (status !== 'all') query = query.eq('status', status);

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
