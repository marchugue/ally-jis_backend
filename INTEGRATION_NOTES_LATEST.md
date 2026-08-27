# This Delivery: Domain Redirect, General Settings, User & Reports Management

## 1. Domain (admin.ally-jis.xyz)

Two-part process, and I can only help with the second:

1. **DNS (at your registrar):** add a CNAME record — Host: `admin`, Value: whatever your hosting
   platform gives you for custom domains (e.g. `cname.vercel-dns.com` for Vercel). I don't know
   your host, so this step is on you.
2. **Hosting platform:** add `admin.ally-jis.xyz` as a custom domain in your project settings
   (Vercel: Project → Settings → Domains; Netlify: Site → Domain management; Railway: Service →
   Settings → Networking).
3. **What I did add:** pointing DNS at the same deployment doesn't automatically land visitors on
   `/admin` — it's the same app either way. `App.tsx` now checks `window.location.hostname` and
   redirects the root path to `/admin` when the hostname starts with `admin.`, so once DNS/hosting
   is set up, visiting the subdomain actually takes people to the admin panel instead of the
   student welcome page.

## 2. Run migrations 008 and 009

`008_admin_user_management.sql` — adds `admin_verified` and `session_invalidated_at` to `profiles`.
`009_admin_reports.sql` — widens `reports.status` from pending/reviewed/dismissed to
pending/reviewing/resolved/rejected (matches the 4-state workflow the spec asked for), adds
`internal_notes`/`reviewed_by`/`reviewed_at`. Run in order after 007 if you haven't already.

**`npm install` needed in the backend** — added `@types/jsonwebtoken` as a dev dependency
(force-logout enforcement decodes the JWT's issued-at claim to compare against
`session_invalidated_at`).

## 3. General Settings (client-side + admin)

New `/settings` page: change password (re-authenticates with the current password first, then
reuses the existing password-reset code path rather than a separate implementation), a link to
the blocked-users page that already existed, and account actions (log out / delete). Reachable
from the profile dropdown in `TopNav`. Admin gets a matching "Account Settings" link in the
sidebar footer — it navigates to the same `/settings` page rather than a separate admin-only
copy, since it's the same account either way. What it does **not** include: the system-level
settings module from the original spec (registration/matching/bot/security/email/notification/
maintenance mode) — that's a different, larger thing and still shows as "Soon" in the sidebar.

## 4. User Management — built

Search/filter (active/banned/suspended)/paginate, detail view, and: ban, unban, suspend,
unsuspend, verify, unverify, force logout, reset password (sends the email — never sets a
password directly), edit basic fields, delete account. Ban/suspend also immediately invalidate
the user's current session via `session_invalidated_at`, checked on every authenticated request.

**Not built, deliberately, to keep this landable:** "Create User" (unusual for a self-registration
app, and registration already exists) and "Disable/Enable Login" as a separate toggle from
ban/suspend (redundant in practice — both already block login).

## 5. Reports Management — built

Your `reports` table existed but had no admin-facing side at all before this. Status tabs
(pending/reviewing/resolved/rejected), internal notes, and from a report: warn (sends a
notification), suspend, or ban the reported user — all reusing the exact same ban/suspend
functions User Management uses, not a second implementation.

**One real gap, not glossed over:** the original report-submission flow never collected a
description or evidence images — only a violation category. Reports Management shows what's
actually in the database; adding description/evidence would mean changing the submit-a-report
flow itself, which is separate, pre-existing functionality I didn't touch this pass.
"Delete Content" from the spec also isn't wired up — a report references a conversation, not a
specific message or post, so there's nothing unambiguous to delete from a report alone yet.

## 6. Activity Log — built

Frontend page for the `admin_activity_log` table (built alongside the RBAC foundation earlier).
Every action above logs here automatically.

## Still not built

Bot Management (declined — see earlier explanation), Analytics (deeper than the Dashboard
charts), Notifications (admin-facing notification center, distinct from the per-user
notifications students get), Global Search across users/reports/admins, and the system-level
Settings module. All still show as disabled "Soon" items in the sidebar rather than being hidden.
