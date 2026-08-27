export interface ProfileRow {
  id: string;
  email?: string;
  full_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  department?: string | null;
  course?: string | null;
  year_level?: string | null;
  interests?: string[];
  organizations?: string[];
  created_at?: string;
  // Added in migrations/003_matchmaking_identity.sql — collected via the
  // profile edit form, not yet read by matching/reveal logic (Phase 2).
  zodiac_sign?: string | null;
  personality_type?: string | null;
  music_taste?: string[];
  movie_interests?: string[];
  age_range?: string | null;
  match_gender_preference?: string | null;
  // Added in migrations/007_admin_rbac.sql — never included in
  // PROFILE_COLUMNS (the general-purpose select used by the rest of the
  // app); only admin.model.ts queries these directly, and they're
  // deliberately absent from UpdateProfilePayload below — not settable
  // through the ordinary profile-edit endpoint.
  role?: string;
  is_banned?: boolean;
  banned_at?: string | null;
  is_suspended?: boolean;
  suspended_until?: string | null;
}

export interface UpdateProfilePayload {
  full_name?: string;
  username?: string;
  bio?: string | null;
  avatar_url?: string | null;
  department?: string | null;
  course?: string | null;
  year_level?: string | null;
  interests?: string[];
  organizations?: string[];
  zodiac_sign?: string | null;
  personality_type?: string | null;
  music_taste?: string[];
  movie_interests?: string[];
  age_range?: string | null;
  match_gender_preference?: string | null;
}

export interface UsernameAvailability {
  available: boolean;
}

export interface BatchProfilesPayload {
  ids: string[];
}
