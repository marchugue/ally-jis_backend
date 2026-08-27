// src/app/models/presetAvatar.model.ts
//
// DATA LAYER — SQL via pg pool.
// Reads and writes the `preset_avatars` table.
// Falls back gracefully if the table doesn't exist yet.

import { supabaseAdmin } from '../../config/supabase';
import type { PresetAvatarRow } from '../types/presetAvatar.types';

/**
 * Returns all preset avatars ordered by sort_order ascending.
 */
export async function listPresetAvatars(): Promise<PresetAvatarRow[]> {
  const { data, error } = await supabaseAdmin
    .from('preset_avatars')
    .select('id, label, url, r2_path, sort_order, created_at')
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return (data ?? []) as PresetAvatarRow[];
}

/**
 * Inserts a new preset avatar record after the file has been uploaded to R2.
 */
export async function createPresetAvatar(input: {
  label: string | null;
  url: string;
  r2_path: string;
  sort_order?: number;
}): Promise<PresetAvatarRow> {
  const { data, error } = await supabaseAdmin
    .from('preset_avatars')
    .insert({
      label: input.label,
      url: input.url,
      r2_path: input.r2_path,
      sort_order: input.sort_order ?? 0,
    })
    .select('id, label, url, r2_path, sort_order, created_at')
    .single();

  if (error) throw error;
  return data as PresetAvatarRow;
}

/**
 * Retrieves a single preset avatar by ID (used before delete to get r2_path).
 */
export async function getPresetAvatarById(id: string): Promise<PresetAvatarRow | null> {
  const { data, error } = await supabaseAdmin
    .from('preset_avatars')
    .select('id, label, url, r2_path, sort_order, created_at')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return (data as PresetAvatarRow | null) ?? null;
}

/**
 * Deletes a preset avatar record by ID.
 */
export async function deletePresetAvatar(id: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('preset_avatars')
    .delete()
    .eq('id', id);

  if (error) throw error;
}
