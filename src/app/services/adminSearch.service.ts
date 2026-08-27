// src/app/services/adminSearch.service.ts
//
// Deliberately not a new search index/table — reuses the same list
// functions User Management, Reports Management, and Admin Management
// already have, just capped to a handful of results each and run in
// parallel. Good enough at this app's scale; revisit with real full-text
// search if the users/reports tables ever get large enough for ILIKE
// scans to matter.

import * as adminUsersModel from '../models/adminUsers.model';
import * as adminReportsModel from '../models/adminReports.model';
import * as adminModel from '../models/admin.model';

export interface GlobalSearchResult {
  users: { id: string; username: string | null; full_name: string | null; email: string }[];
  reports: { id: string; reported_username: string | null; violation_label: string; status: string }[];
  admins: { id: string; username: string | null; full_name: string | null; role: string }[];
}

const RESULT_CAP = 5;

export async function search(query: string): Promise<GlobalSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { users: [], reports: [], admins: [] };

  const [usersRes, reportsRes, allAdmins] = await Promise.all([
    adminUsersModel.listUsers({ search: trimmed, limit: RESULT_CAP, cursor: null }),
    adminReportsModel.listReports({ status: 'all', limit: 50, cursor: null }), // reports have no direct text search column — filtered below
    adminModel.listAdmins(),
  ]);

  const q = trimmed.toLowerCase();
  const matchingReports = reportsRes.items
    .filter((r) => (r.reported_username ?? '').toLowerCase().includes(q) || r.violation_label.toLowerCase().includes(q))
    .slice(0, RESULT_CAP);
  const matchingAdmins = (allAdmins as any[])
    .filter((a) => (a.username ?? '').toLowerCase().includes(q) || (a.full_name ?? '').toLowerCase().includes(q) || (a.email ?? '').toLowerCase().includes(q))
    .slice(0, RESULT_CAP);

  return {
    users: usersRes.items.map((u) => ({ id: u.id, username: u.username, full_name: u.full_name, email: u.email })),
    reports: matchingReports.map((r) => ({ id: r.id, reported_username: r.reported_username, violation_label: r.violation_label, status: r.status })),
    admins: matchingAdmins.map((a) => ({ id: a.id, username: a.username, full_name: a.full_name, role: a.role })),
  };
}
