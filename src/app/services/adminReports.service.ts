// src/app/services/adminReports.service.ts

import { supabaseAdmin } from '../../config/supabase';
import * as adminReportsModel from '../models/adminReports.model';
import * as adminModel from '../models/admin.model';
import * as adminUsersService from './adminUsers.service';
import * as feedModel from '../models/feed.model';
import { createNotification } from '../models/interaction.model';
import { HttpError } from '../types/auth.types';
import type { ListReportsParams, PaginatedReportList, ReportStatus } from '../types/adminReports.types';

async function log(adminId: string, action: string, targetUserId: string | null, ipAddress?: string, metadata?: Record<string, unknown>) {
  await adminModel.logAction({ adminId, action, targetUserId, metadata, ipAddress });
}

export async function listReports(params: ListReportsParams): Promise<PaginatedReportList> {
  const limit = params.limit ?? 20;
  const offset = params.cursor ? Number(params.cursor) || 0 : 0;
  const { items, total } = await adminReportsModel.listReports(params);
  const nextCursor = offset + limit < total ? String(offset + limit) : null;
  return { items, total, nextCursor };
}

export async function getReport(reportId: string) {
  const report = await adminReportsModel.getReportById(reportId);
  if (!report) throw new HttpError('Report not found', 404);
  return report;
}

export async function getStatusCounts() {
  return adminReportsModel.countByStatus();
}

export async function setStatus(adminId: string, reportId: string, status: ReportStatus, notes?: string, ip?: string): Promise<void> {
  const report = await adminReportsModel.getReportById(reportId);
  if (!report) throw new HttpError('Report not found', 404);
  await adminReportsModel.updateStatus(reportId, status, adminId, notes);
  await log(adminId, `report_${status}`, report.reported_user_id, ip, { reportId });
}

export async function setInternalNotes(adminId: string, reportId: string, notes: string, ip?: string): Promise<void> {
  await adminReportsModel.setInternalNotes(reportId, notes);
  await log(adminId, 'report_add_notes', null, ip, { reportId });
}

/** A warning is an official notification with content flags and post restriction.
 * - If linked to a post, restricts post visibility strictly to author & admin and flags it.
 * - If linked to a message, flags the message with an official warning indicator.
 * - Dispatches official warning notification with direct redirection to the reported post/content.
 */
export async function warnUser(adminId: string, reportId: string, message: string, ip?: string): Promise<void> {
  const report = await adminReportsModel.getReportById(reportId);
  if (!report?.reported_user_id) throw new HttpError('Report has no reported user to warn', 400);

  const postId = report.post_id || null;
  const messageId = report.message_id || null;

  // 1. If linked to a post: flag the post and restrict its visibility to author and admin only!
  if (postId) {
    const { data: postRow } = await supabaseAdmin
      .from('posts')
      .select('content')
      .eq('id', postId)
      .maybeSingle();

    if (postRow) {
      let rawContent = postRow.content || '';
      if (!rawContent.includes('<!--visibility:admin_and_user_only-->')) {
        rawContent = `<!--visibility:admin_and_user_only--><!--flagged:warning-->${rawContent}`;
        await supabaseAdmin
          .from('posts')
          .update({ content: rawContent, updated_at: new Date().toISOString() })
          .eq('id', postId);
      }
    }

    await supabaseAdmin
      .from('reported_post_snapshots')
      .update({ audience: 'admin_and_user_only' })
      .eq('report_id', reportId);
  }

  // 2. If linked to a message: flag the message!
  if (messageId) {
    const { data: msgRow } = await supabaseAdmin
      .from('messages')
      .select('content')
      .eq('id', messageId)
      .maybeSingle();

    if (msgRow) {
      let rawContent = msgRow.content || '';
      if (!rawContent.includes('<!--flagged:warning-->')) {
        rawContent = `<!--flagged:warning-->${rawContent}`;
        await supabaseAdmin
          .from('messages')
          .update({ content: rawContent })
          .eq('id', messageId);
      }
    }
  }

  // 3. Dispatch official warning notification with post redirect metadata
  await createNotification({
    userId: report.reported_user_id,
    type: 'admin_warning',
    title: 'Official Account Warning',
    description: message,
    fromUserId: null,
    postId: postId || null,
    targetId: postId || messageId || null,
  });

  const currentNotes = report.internal_notes || '';
  const warnNote = `[Warning issued to student by Admin at ${new Date().toISOString()}]`;
  await adminReportsModel.setInternalNotes(reportId, currentNotes ? `${currentNotes}\n${warnNote}` : warnNote);

  await log(adminId, 'warn_user', report.reported_user_id, ip, { reportId, message, postId, messageId });
}

/** Removes the flagged message or post content, replacing it with the removed state. */
export async function removeReportedMessage(adminId: string, reportId: string, ip?: string): Promise<void> {
  const report = await adminReportsModel.getReportById(reportId);
  if (!report) throw new HttpError('Report not found', 404);

  const messageId = report.message_id || null;
  const postId = report.post_id || null;

  if (messageId) {
    await supabaseAdmin
      .from('messages')
      .update({
        content: 'This message was removed',
        is_deleted: true,
        deleted_at: new Date().toISOString(),
      })
      .eq('id', messageId);

    await supabaseAdmin
      .from('reported_message_snapshots')
      .update({
        content: 'This message was removed',
        is_deleted_in_chat: true,
      })
      .eq('report_id', reportId);

    // Broadcast message deletion so all clients update instantly
    const { data: msg } = await supabaseAdmin
      .from('messages')
      .select('conversation_id')
      .eq('id', messageId)
      .maybeSingle();

    if (msg?.conversation_id) {
      const { emitToUser } = await import('./realtime.service');
      const { data: members } = await supabaseAdmin
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', msg.conversation_id);

      for (const m of members ?? []) {
        emitToUser(m.user_id, 'conversation:message_deleted', {
          conversationId: msg.conversation_id,
          messageId,
          mode: 'delete_for_everyone',
        });
      }
    }
  }

  if (postId) {
    await supabaseAdmin
      .from('posts')
      .update({
        content: 'This message was removed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', postId);

    await supabaseAdmin
      .from('reported_post_snapshots')
      .update({
        content: 'This message was removed',
      })
      .eq('report_id', reportId);
  }

  const currentNotes = report.internal_notes || '';
  const note = `[Message content removed by Admin at ${new Date().toISOString()}]`;
  await adminReportsModel.setInternalNotes(reportId, currentNotes ? `${currentNotes}\n${note}` : note);

  await log(adminId, 'remove_reported_message', report.reported_user_id, ip, { reportId, messageId, postId });
}

/** Removes the flagged media/photo from message or post, replacing it with the removed media notice. */
export async function removeReportedMedia(adminId: string, reportId: string, ip?: string): Promise<void> {
  const report = await adminReportsModel.getReportById(reportId);
  if (!report) throw new HttpError('Report not found', 404);

  const messageId = report.message_id || null;
  const postId = report.post_id || null;

  if (messageId) {
    await supabaseAdmin
      .from('messages')
      .update({
        image_url: '[removed]',
      })
      .eq('id', messageId);

    await supabaseAdmin
      .from('reported_message_snapshots')
      .update({
        image_url: '[removed]',
      })
      .eq('report_id', reportId);

    const { data: msg } = await supabaseAdmin
      .from('messages')
      .select('conversation_id')
      .eq('id', messageId)
      .maybeSingle();

    if (msg?.conversation_id) {
      const { emitToUser } = await import('./realtime.service');
      const { data: members } = await supabaseAdmin
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', msg.conversation_id);

      for (const m of members ?? []) {
        emitToUser(m.user_id, 'conversation:message_updated', {
          conversationId: msg.conversation_id,
          messageId,
          imageUrl: '[removed]',
        });
      }
    }
  }

  if (postId) {
    await supabaseAdmin
      .from('post_media')
      .update({
        url: '[removed]',
      })
      .eq('post_id', postId);

    const { data: snapshot } = await supabaseAdmin
      .from('reported_post_snapshots')
      .select('media')
      .eq('report_id', reportId)
      .maybeSingle();

    if (snapshot?.media && Array.isArray(snapshot.media)) {
      const updatedMedia = snapshot.media.map((m: any) => ({ ...m, url: '[removed]' }));
      await supabaseAdmin
        .from('reported_post_snapshots')
        .update({ media: updatedMedia })
        .eq('report_id', reportId);
    }
  }

  const currentNotes = report.internal_notes || '';
  const note = `[Media photo removed by Admin at ${new Date().toISOString()}]`;
  await adminReportsModel.setInternalNotes(reportId, currentNotes ? `${currentNotes}\n${note}` : note);

  await log(adminId, 'remove_reported_media', report.reported_user_id, ip, { reportId, messageId, postId });
}

/** Thin pass-throughs so "Ban User" / "Suspend User" from a report use the
 * exact same ban/suspend implementation as User Management — one place
 * that actually bans someone, not two. */
export async function banReportedUser(adminId: string, reportId: string, ip?: string): Promise<void> {
  const report = await adminReportsModel.getReportById(reportId);
  if (!report?.reported_user_id) throw new HttpError('Report has no reported user', 400);
  await adminUsersService.banUser(adminId, report.reported_user_id, ip);
}

export async function suspendReportedUser(adminId: string, reportId: string, until: string | null, ip?: string): Promise<void> {
  const report = await adminReportsModel.getReportById(reportId);
  if (!report?.reported_user_id) throw new HttpError('Report has no reported user', 400);
  await adminUsersService.suspendUser(adminId, report.reported_user_id, until, ip);
}

export async function deleteReportedPost(adminId: string, reportId: string, explicitPostId?: string, ip?: string): Promise<void> {
  const report = await adminReportsModel.getReportById(reportId);
  if (!report) throw new HttpError('Report not found', 404);

  const postId = explicitPostId || report.post_id;
  if (!postId) throw new HttpError('Report is not linked to any post', 400);

  await feedModel.deletePost(postId);

  await supabaseAdmin
    .from('reported_post_snapshots')
    .update({ is_deleted_from_feed: true })
    .eq('report_id', reportId);

  const currentNotes = report.internal_notes || '';
  const deletionNote = `[Post deleted by Admin at ${new Date().toISOString()}]`;
  const updatedNotes = currentNotes ? `${currentNotes}\n${deletionNote}` : deletionNote;
  await adminReportsModel.setInternalNotes(reportId, updatedNotes);

  await log(adminId, 'delete_reported_post', report.reported_user_id, ip, { reportId, postId });
}

