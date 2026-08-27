// src/app/types/presetAvatar.types.ts

export interface PresetAvatarRow {
  id: string;
  label: string | null;
  url: string;
  r2_path: string;
  sort_order: number;
  created_at: string;
}

export interface PresetAvatarListResponse {
  avatars: PresetAvatarRow[];
}

export interface PresetAvatarCreateResponse {
  avatar: PresetAvatarRow;
}
