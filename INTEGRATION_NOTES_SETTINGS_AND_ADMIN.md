# This Delivery: Settings + Domain Redirect + Remaining Admin Modules

## 1. Migrations, in order

Run `008_admin_user_management.sql` then `009_admin_reports.sql` (after 003-007 from earlier).
009 also **remaps existing report rows**: old `'reviewed'` → `'resolved'`, old `'dismissed'` →
`'rejected'`, before tightening the status CHECK constraint — safe even if you have live report
data already.

`npm install` on the backend picks up `@types/jsonwebtoken` (new devDependency, needed for the
force-logout check reading a token's `iat` claim).

## 2. Domain (admin.ally-jis.xyz)

1. **DNS** (at your registrar): add a CNAME, host `admin`, pointing at whatever your hosting
   platform gives you for custom domains.
2. **Hosting platform**: add `admin.ally-jis.xyz` as a custom domain in your project settings —
   the exact screen depends on where you deployed (Vercel/Netlify/Railway/etc.), didn't want to
   guess wrong so ask if you want the exact clicks for your specific host.
3. Since `/admin` is a route inside this same app, not a separate deployment, I added a small
   client-side redirect: visiting the bare `admin.ally-jis.xyz` root now sends you straight to
   `/admin` (`App.tsx`, checks `window.location.hostname`). Without this, the subdomain would
   just show the regular student welcome page — pointing DNS at the same deployment doesn't by
   itself know to land on a different route.

## 3. Settings (client + admin)

- New `POST /auth/change-password` (logged in only) — reuses `signInWithPassword` to verify the
  current password first, then the exact same `resetPasswordWithToken` your forgot-password flow
  already used. One password-update code path in the whole backend, not two.
- `SettingsPage.tsx` at `/settings`: change password, a link into the existing `BlockedUserPage`
  (didn't rebuild that — it already worked), log out, delete account. Linked from the profile
  dropdown in `TopNav`.
- Admin gets an "Account Settings" link in the sidebar footer pointing at the same `/settings` —
  it's the same underlying account, so no separate implementation. Note this is **not** the
  system-level settings module from your original admin spec (registration/matching/bot/security/
  email/notification/maintenance-mode toggles) — that's a distinct, much larger piece, still on
  the "Soon" list in the sidebar.

## 4. Admin modules built this pass

**User Management** — search/filter (active/banned/suspended)/paginate, a detail drawer (bio,
posts count, reports-against count, activity), and every action except two: ban, unban, suspend,
unsuspend, verify, remove verification, force logout, reset password (sends the email — never
sets a password directly), delete account. **Not built**: "Create User" (unusual for a
self-registration app, and registration already works) and "Disable/Enable Login" as a concept
separate from ban — they overlap enough that I didn't see the distinct value; flag if you actually
need that distinction.

Ban/suspend also **immediately end the user's current session** (same force-logout mechanism) —
otherwise a banned user stays logged in until their token naturally expires.

**Reports Management** — the `reports` table existed but had no way to be reviewed before this.
Status tabs (pending/reviewing/resolved/rejected), internal notes, and warn/suspend/ban actions
that reuse the exact same User Management functions rather than a second implementation. **Not
built**: "Delete Content" — reports only reference a `conversation_id`, never a specific message
or post, so there's nothing unambiguous to delete from a report alone. Also not built: the
report submission flow still doesn't collect a description or evidence images (pre-existing gap,
not something this admin-side pass touched).

**Activity Log** — every admin action above logs to `admin_activity_log` automatically; this page
lists and filters it.

## 5. Still not built (from "remaining features")

- **Analytics** (separate deeper page — retention, demographics, interest popularity, peak
  hours) — Dashboard's 3 charts are the only analytics that exist right now.
- **Admin notification center** (new-registration/new-report/server-error alerts for admins) —
  needs its own delivery mechanism, distinct from the student-facing notification system.
- **Global search** across users/reports/admins.
- **System-level Settings** module (see #3 above).
- **Bot Management** — still declined for the reasons in the earlier conversation; open to a
  non-deceptive alternative if there's a real need underneath it.
