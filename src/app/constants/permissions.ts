// src/app/constants/permissions.ts

import type { Permission } from '../types/admin.types';

export const ALL_PERMISSIONS: Permission[] = [
  'manage_users',
  'manage_bots',
  'view_reports',
  'resolve_reports',
  'delete_users',
  'ban_users',
  'view_analytics',
  'manage_settings',
  'manage_admins',
];

export const ADMIN_ROLES = ['moderator', 'admin', 'super_admin'] as const;

/** super_admin always has every permission — this is a code-level rule,
 * not rows in role_permissions, specifically so editing that table from
 * the (future) Admin Management UI can never accidentally lock every
 * super_admin out of the system. */
export function hasImplicitAllPermissions(role: string): boolean {
  return role === 'super_admin';
}

export function isAdminRole(role: string): role is (typeof ADMIN_ROLES)[number] {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}
