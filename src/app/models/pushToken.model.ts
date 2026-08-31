import fs from 'fs';
import path from 'path';
import { supabaseAdmin } from '../../config/supabase';

const FALLBACK_DIR = path.join(process.cwd(), 'data');
const FALLBACK_FILE = path.join(FALLBACK_DIR, 'push_tokens.json');

// In-memory fallback map: userId -> expoPushToken
const memoryStore = new Map<string, string>();

function loadFallbackStore() {
  try {
    if (fs.existsSync(FALLBACK_FILE)) {
      const data = JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf-8'));
      for (const [userId, token] of Object.entries(data)) {
        if (typeof token === 'string') {
          memoryStore.set(userId, token);
        }
      }
    }
  } catch (err) {
    console.error('[pushToken.model] Error loading fallback store:', err);
  }
}

function saveFallbackStore() {
  try {
    if (!fs.existsSync(FALLBACK_DIR)) {
      fs.mkdirSync(FALLBACK_DIR, { recursive: true });
    }
    const obj = Object.fromEntries(memoryStore.entries());
    fs.writeFileSync(FALLBACK_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    console.error('[pushToken.model] Error saving fallback store:', err);
  }
}

// Initial load
loadFallbackStore();

/**
 * Saves/updates a user's Expo push token in Supabase and local cache.
 */
export async function savePushToken(userId: string, token: string | null): Promise<void> {
  if (token) {
    memoryStore.set(userId, token);
  } else {
    memoryStore.delete(userId);
  }
  saveFallbackStore();

  try {
    // Attempt update on Supabase profiles table
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ expo_push_token: token })
      .eq('id', userId);

    if (error && error.code !== '42703') {
      console.warn('[pushToken.model] Supabase update warning:', error.message);
    }
  } catch (err) {
    console.warn('[pushToken.model] Supabase update error:', err);
  }
}

/**
 * Gets a user's Expo push token from Supabase or local cache.
 */
export async function getPushToken(userId: string): Promise<string | null> {
  // 1. Try Supabase first
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('expo_push_token')
      .eq('id', userId)
      .maybeSingle();

    if (!error && data?.expo_push_token) {
      return data.expo_push_token as string;
    }
  } catch {
    // Ignore error if column doesn't exist yet
  }

  // 2. Fall back to memory/file store
  return memoryStore.get(userId) ?? null;
}

/**
 * Gets push tokens for multiple user IDs.
 */
export async function getPushTokens(userIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (userIds.length === 0) return result;

  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, expo_push_token')
      .in('id', userIds);

    if (!error && data) {
      for (const row of data) {
        if (row.expo_push_token) {
          result.set(row.id as string, row.expo_push_token as string);
        }
      }
    }
  } catch {
    // Ignore error if column doesn't exist
  }

  // Fill in any missing tokens from fallback memory store
  for (const userId of userIds) {
    if (!result.has(userId)) {
      const fallbackToken = memoryStore.get(userId);
      if (fallbackToken) {
        result.set(userId, fallbackToken);
      }
    }
  }

  return result;
}
