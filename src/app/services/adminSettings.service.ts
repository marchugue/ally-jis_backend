// src/app/services/adminSettings.service.ts
//
// Only maintenance_mode and registrations_enabled are actually read
// anywhere outside the settings page itself (see maintenance.middleware.ts
// and auth.service.ts#register) — everything else in system_settings is
// storage for now. The admin Settings UI labels the unwired ones as such
// rather than implying they already do something.

import * as settingsModel from '../models/adminSettings.model';
import * as adminModel from '../models/admin.model';

const WELL_KNOWN_KEYS = [
  'maintenance_mode',
  'maintenance_message',
  'registrations_enabled',
  'platform_name',
  'support_email',
  'require_email_verification',
];

export async function getAllSettings(): Promise<Record<string, unknown>> {
  return settingsModel.getAllSettings();
}

let maintenanceCache: { on: boolean; message: string; fetchedAt: number } | null = null;
const MAINTENANCE_CACHE_TTL_MS = 10_000;

/** Checked on every non-admin request (see maintenance.middleware.ts) — a
 * 10s cache trades "changes take up to 10s to take effect" for "not a DB
 * round trip on every single API call". */
export async function isMaintenanceModeOn(): Promise<{ on: boolean; message: string }> {
  if (maintenanceCache && Date.now() - maintenanceCache.fetchedAt < MAINTENANCE_CACHE_TTL_MS) {
    return { on: maintenanceCache.on, message: maintenanceCache.message };
  }
  const [modeRaw, msgRaw] = await Promise.all([
    settingsModel.getSetting('maintenance_mode'),
    settingsModel.getSetting('maintenance_message'),
  ]);
  const on = modeRaw === true;
  const message = typeof msgRaw === 'string' ? msgRaw : 'Ally-jis is undergoing maintenance. Please check back shortly.';
  maintenanceCache = { on, message, fetchedAt: Date.now() };
  return { on, message };
}

export async function areRegistrationsEnabled(): Promise<boolean> {
  const value = await settingsModel.getSetting('registrations_enabled');
  return value !== false; // default open if unset
}

export async function updateSettings(adminId: string, updates: Record<string, unknown>, ip?: string): Promise<void> {
  const entries = Object.entries(updates).filter(([key]) => WELL_KNOWN_KEYS.includes(key));
  await Promise.all(entries.map(([key, value]) => settingsModel.setSetting(key, value, adminId)));
  if (entries.some(([key]) => key === 'maintenance_mode' || key === 'maintenance_message')) {
    maintenanceCache = null; // force a fresh read instead of waiting out the TTL
  }
  await adminModel.logAction({ adminId, action: 'update_settings', targetUserId: null, metadata: updates, ipAddress: ip });
}
