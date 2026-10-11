// src/app/services/userPreferences.service.ts

import * as model from '../models/userPreferences.model';
import type { UserPreferences, UpdateUserPreferencesInput } from '../models/userPreferences.model';

export async function getPreferences(userId: string): Promise<UserPreferences> {
  return model.getUserPreferences(userId);
}

export async function updatePreferences(
  userId: string,
  updates: UpdateUserPreferencesInput,
): Promise<UserPreferences> {
  return model.updateUserPreferences(userId, updates);
}
