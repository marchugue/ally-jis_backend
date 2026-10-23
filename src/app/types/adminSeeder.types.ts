// src/app/types/adminSeeder.types.ts

export interface SeederMemberProfile {
  id: string;
  userId: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
}

export interface SeederMatchDetails {
  id: string;
  matchPoints: number;
  stagePoints: number;
  currentStage: number;
  dayStreak: number;
  revealedAt: string | null;
  status: string;
  userAAlias?: string | null;
  userBAlias?: string | null;
  userAAvatar?: string | null;
  userBAvatar?: string | null;
}

export interface SeederConversationItem {
  id: string;
  type: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  members: SeederMemberProfile[];
  match: SeederMatchDetails | null;
}

export interface SeedPointsPayload {
  conversationId: string;
  points: number;
}

export interface SeedPointsResult {
  conversationId: string;
  matchId: string;
  previousPoints: number;
  newPoints: number;
  currentStage: number;
  dayStreak: number;
  revealedAt: string | null;
  isRevealed: boolean;
}
