-- 008_admin_user_management.sql
--
-- Additive fields for User Management actions that 007's KPI-only fields
-- didn't cover: admin-conferred verification (distinct from the existing
-- automatic @chmsu.edu.ph email-domain check — see profileMapper), and
-- force-logout (compared against a JWT's issued-at claim in authMiddleware,
-- not a session table — see admin.middleware.ts / auth.middleware.ts).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS admin_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS session_invalidated_at timestamp with time zone;
