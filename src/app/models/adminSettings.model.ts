// src/app/models/adminSettings.model.ts

import { supabaseAdmin } from '../../config/supabase';

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.from('system_settings').select('key, value');
  if (error) throw error;
  const result: Record<string, unknown> = {};
  for (const row of data ?? []) result[row.key] = row.value;
  return result;
}

export async function getSetting(key: string): Promise<unknown> {
  const { data, error } = await supabaseAdmin.from('system_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

export async function setSetting(key: string, value: unknown, updatedBy: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('system_settings')
    .upsert({ key, value, updated_at: new Date().toISOString(), updated_by: updatedBy }, { onConflict: 'key' });
  if (error) throw error;
}
