// src/routes/admin.routes.ts

import { Router } from 'express';
import * as adminController from '../app/controller/admin.controller';
import * as adminUsersController from '../app/controller/adminUsers.controller';
import * as adminReportsController from '../app/controller/adminReports.controller';
import * as adminSearchController from '../app/controller/adminSearch.controller';
import * as adminAvatarsController from '../app/controller/adminAvatars.controller';
import { authMiddleware } from '../app/middleware/auth.middleware';
import { requireAdminRole, requirePermission } from '../app/middleware/admin.middleware';

const router = Router();

router.use(authMiddleware);
router.use(requireAdminRole);

router.get('/me', adminController.getMe);

router.get('/dashboard/kpis', requirePermission('view_analytics'), adminController.getDashboardKpis);
router.get('/dashboard/charts', requirePermission('view_analytics'), adminController.getDashboardCharts);

router.get('/admins', requirePermission('manage_admins'), adminController.listAdmins);
router.post('/admins/:userId/role', requirePermission('manage_admins'), adminController.setUserRole);

router.get('/permissions', requirePermission('manage_admins'), adminController.listRolePermissions);
router.put('/permissions', requirePermission('manage_admins'), adminController.setRolePermission);

router.get('/activity-log', adminController.listActivityLog);

// ─── User Management ───────────────────────────────────────────────────────
router.get('/users', requirePermission('manage_users'), adminUsersController.listUsers);

// Student ID verification (non-CHMSU email users) - MUST BE BEFORE /users/:userId
router.get('/users/pending-verifications', requirePermission('manage_users'), adminUsersController.listPendingVerifications);

router.get('/users/:userId', requirePermission('manage_users'), adminUsersController.getUserDetail);
router.patch('/users/:userId', requirePermission('manage_users'), adminUsersController.updateUser);
router.post('/users/:userId/ban', requirePermission('ban_users'), adminUsersController.banUser);
router.post('/users/:userId/unban', requirePermission('ban_users'), adminUsersController.unbanUser);
router.post('/users/:userId/suspend', requirePermission('ban_users'), adminUsersController.suspendUser);
router.post('/users/:userId/unsuspend', requirePermission('ban_users'), adminUsersController.unsuspendUser);
router.post('/users/:userId/verify', requirePermission('manage_users'), adminUsersController.verifyUser);
router.post('/users/:userId/unverify', requirePermission('manage_users'), adminUsersController.unverifyUser);
router.post('/users/:userId/force-logout', requirePermission('manage_users'), adminUsersController.forceLogout);
router.post('/users/:userId/reset-password', requirePermission('manage_users'), adminUsersController.resetUserPassword);
router.post('/users/:userId/approve-verification', requirePermission('manage_users'), adminUsersController.approveStudentVerification);
router.post('/users/:userId/reject-verification', requirePermission('manage_users'), adminUsersController.rejectStudentVerification);
router.delete('/users/:userId', requirePermission('delete_users'), adminUsersController.deleteUser);


// ─── Reports Management ─────────────────────────────────────────────────────
router.get('/reports', requirePermission('view_reports'), adminReportsController.listReports);
router.get('/reports/status-counts', requirePermission('view_reports'), adminReportsController.getStatusCounts);
router.get('/reports/:reportId', requirePermission('view_reports'), adminReportsController.getReport);
router.post('/reports/:reportId/status', requirePermission('resolve_reports'), adminReportsController.setStatus);
router.put('/reports/:reportId/notes', requirePermission('resolve_reports'), adminReportsController.setInternalNotes);
router.post('/reports/:reportId/warn', requirePermission('resolve_reports'), adminReportsController.warnUser);
router.post('/reports/:reportId/ban', requirePermission('ban_users'), adminReportsController.banReportedUser);
router.post('/reports/:reportId/suspend', requirePermission('ban_users'), adminReportsController.suspendReportedUser);

// ─── Global Search ───────────────────────────────────────────────────────
router.get('/search', adminSearchController.search);

// ─── Settings ────────────────────────────────────────────────────────────
router.get('/settings', requirePermission('manage_settings'), adminController.getSettings);
router.put('/settings', requirePermission('manage_settings'), adminController.updateSettings);

// ─── Preset Avatar Management ────────────────────────────────────────────
// List is also exposed publicly via /api/media/avatars/presets (no auth).
router.get('/avatars/presets', adminAvatarsController.listPresetAvatars);
router.post(
  '/avatars/presets',
  requirePermission('manage_settings'),
  adminAvatarsController.upload.single('file'),
  adminAvatarsController.createPresetAvatar,
);
router.delete(
  '/avatars/presets/:id',
  requirePermission('manage_settings'),
  adminAvatarsController.deletePresetAvatar,
);

export default router;
