// src/app/models/adminSeeder.model.ts

import { supabaseAdmin } from '../../config/supabase';
import { resolveRealFullName } from './adminUsers.model';
import type { SeederConversationItem, SeederMatchDetails, SeederMemberProfile } from '../types/adminSeeder.types';

export async function listRecentConversations(limit = 50): Promise<SeederConversationItem[]> {
  const { data: convs, error: convsError } = await supabaseAdmin
    .from('conversations')
    .select('id, type, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (convsError) throw convsError;
  if (!convs || convs.length === 0) return [];

  const convIds = convs.map((c) => c.id);

  // 1. Fetch conversation members
  const { data: members, error: membersError } = await supabaseAdmin
    .from('conversation_members')
    .select('conversation_id, user_id')
    .in('conversation_id', convIds);

  if (membersError) throw membersError;

  const userIds = Array.from(new Set((members ?? []).map((m) => m.user_id)));

  // 2. Fetch user profiles
  const profileMap = new Map<string, any>();
  if (userIds.length > 0) {
    const { data: profiles, error: profError } = await supabaseAdmin
      .from('profiles')
      .select('id, username, full_name, email, avatar_url')
      .in('id', userIds);

    if (profError) throw profError;
    (profiles ?? []).forEach((p) => profileMap.set(p.id, p));
  }

  // 3. Fetch linked match progression data
  const { data: matches, error: matchesError } = await supabaseAdmin
    .from('matches')
    .select('id, conversation_id, user_a_id, user_b_id, user_a_alias, user_b_alias, user_a_avatar, user_b_avatar, match_points, stage_points, current_stage, day_streak, revealed_at, status')
    .in('conversation_id', convIds);

  if (matchesError) throw matchesError;

  const matchMap = new Map<string, any>();
  (matches ?? []).forEach((m) => matchMap.set(m.conversation_id, m));

  // Assemble result
  const result: SeederConversationItem[] = convs.map((conv) => {
    const convMembers = (members ?? [])
      .filter((m) => m.conversation_id === conv.id)
      .map((m) => {
        const prof = profileMap.get(m.user_id);
        const memberProfile: SeederMemberProfile = {
          id: m.user_id,
          userId: m.user_id,
          username: prof?.username ?? null,
          fullName: prof ? resolveRealFullName(prof) : 'User',
          avatarUrl: prof?.avatar_url ?? null,
        };
        return memberProfile;
      });

    const matchRow = matchMap.get(conv.id);
    let matchDetails: SeederMatchDetails | null = null;
    let userA: SeederMemberProfile | null = null;
    let userB: SeederMemberProfile | null = null;

    if (matchRow) {
      matchDetails = {
        id: matchRow.id,
        userAId: matchRow.user_a_id ?? null,
        userBId: matchRow.user_b_id ?? null,
        userAAlias: matchRow.user_a_alias ?? null,
        userBAlias: matchRow.user_b_alias ?? null,
        userAAvatar: matchRow.user_a_avatar ?? null,
        userBAvatar: matchRow.user_b_avatar ?? null,
        matchPoints: matchRow.match_points ?? 0,
        stagePoints: matchRow.stage_points ?? 0,
        currentStage: matchRow.current_stage ?? 1,
        dayStreak: matchRow.day_streak ?? 0,
        revealedAt: matchRow.revealed_at ?? null,
        status: matchRow.status ?? 'active',
      };

      if (matchRow.user_a_id) {
        userA = convMembers.find((m) => m.userId === matchRow.user_a_id) ?? null;
      }
      if (matchRow.user_b_id) {
        userB = convMembers.find((m) => m.userId === matchRow.user_b_id) ?? null;
      }
    }

    // Fallback to member order if not resolved by match row
    if (!userA && convMembers.length > 0) {
      userA = convMembers[0];
    }
    if (!userB && convMembers.length > 1) {
      userB = convMembers.find((m) => m.userId !== userA?.userId) ?? convMembers[1];
    }

    const defaultTitle =
      userA && userB
        ? `${userA.fullName} & ${userB.fullName}`
        : convMembers
            .map((m) => m.fullName)
            .filter(Boolean)
            .join(' & ') || 'Direct Conversation';

    return {
      id: conv.id,
      type: conv.type,
      title: defaultTitle,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      members: convMembers,
      userA,
      userB,
      match: matchDetails,
    };
  });

  return result;
}

export async function findConversationById(conversationId: string) {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('id, type, created_at, updated_at')
    .eq('id', conversationId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function findConversationMembers(conversationId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId);

  if (error) throw error;
  return (data ?? []).map((m) => m.user_id as string);
}

export async function findMatchByConversationId(conversationId: string) {
  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('id, conversation_id, user_a_id, user_b_id, match_points, stage_points, current_stage, day_streak, revealed_at, status')
    .eq('conversation_id', conversationId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createMatch(data: {
  conversation_id: string;
  user_a_id: string;
  user_b_id: string;
  match_points: number;
  stage_points: number;
  current_stage: number;
  day_streak: number;
  revealed_at?: string | null;
  status?: string;
}) {
  const { data: inserted, error } = await supabaseAdmin
    .from('matches')
    .insert({
      conversation_id: data.conversation_id,
      user_a_id: data.user_a_id,
      user_b_id: data.user_b_id,
      match_points: data.match_points,
      stage_points: data.stage_points,
      current_stage: data.current_stage,
      day_streak: data.day_streak,
      revealed_at: data.revealed_at ?? null,
      status: data.status ?? 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return inserted;
}

export async function updateMatchPoints(
  matchId: string,
  updates: {
    match_points: number;
    stage_points: number;
    current_stage: number;
    day_streak: number;
    revealed_at?: string | null;
  },
) {
  const { data, error } = await supabaseAdmin
    .from('matches')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', matchId)
    .select()
    .single();

  if (error) throw error;
  return data;
}
