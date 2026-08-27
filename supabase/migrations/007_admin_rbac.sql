-- 007_admin_rbac.sql
--
-- Foundation for the admin panel: roles, configurable per-role permissions,
-- and the minimal moderation-status fields the dashboard's KPI cards need
-- (Banned Users, Suspended). Full ban/suspend/verify *actions* (the User
-- Management module) come in a later pass — this only adds what Dashboard
-- needs to report on.
--
-- Deliberately does NOT add anything bot-related — see the conversation
-- notes on why the bot-matching module wasn't built.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'student'
    CHECK (role = ANY (ARRAY['student'::text, 'moderator'::text, 'admin'::text, 'super_admin'::text])),
  ADD COLUMN IF NOT EXISTS is_banned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS banned_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspended_until timestamp with time zone;

CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles (role) WHERE role <> 'student';

-- Fixed permission keys (matches the set named in the admin panel spec).
-- "Configurable permissions" means editable per-role here, not an
-- open-ended permission-authoring system — see integration notes for the
-- scoping call.
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role text NOT NULL CHECK (role = ANY (ARRAY['moderator'::text, 'admin'::text, 'super_admin'::text])),
  permission text NOT NULL CHECK (permission = ANY (ARRAY[
    'manage_users'::text, 'manage_bots'::text, 'view_reports'::text, 'resolve_reports'::text,
    'delete_users'::text, 'ban_users'::text, 'view_analytics'::text, 'manage_settings'::text,
    'manage_admins'::text
  ])),
  CONSTRAINT role_permissions_pkey PRIMARY KEY (role, permission)
);

-- Sensible defaults — super_admin gets everything via a code-level check
-- rather than rows here (see permissions.ts), so it can't accidentally be
-- locked out by editing this table. moderator/admin start with a
-- reasonable baseline; edit freely from the Admin Management UI once
-- that phase exists.
INSERT INTO public.role_permissions (role, permission) VALUES
  ('moderator', 'view_reports'),
  ('moderator', 'resolve_reports'),
  ('admin', 'manage_users'),
  ('admin', 'view_reports'),
  ('admin', 'resolve_reports'),
  ('admin', 'ban_users'),
  ('admin', 'view_analytics')
ON CONFLICT DO NOTHING;

-- Every admin-tier action taken through /admin/* gets logged here.
CREATE TABLE IF NOT EXISTS public.admin_activity_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES public.profiles(id),
  action text NOT NULL,
  target_user_id uuid REFERENCES public.profiles(id),
  metadata jsonb,
  ip_address text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT admin_activity_log_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS admin_activity_log_admin_id_idx ON public.admin_activity_log (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_log_target_user_id_idx ON public.admin_activity_log (target_user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Bootstrapping your first super_admin — RBAC requires one to exist before
-- anyone can grant roles through the admin UI. Run this manually, once,
-- with your own account's email:
--
--   UPDATE public.profiles SET role = 'super_admin' WHERE email = 'you@chmsu.edu.ph';
--
-- Deliberately not baked into this migration as an automatic step — a
-- hardcoded email/UUID in a migration file is exactly the kind of thing
-- that's easy to forget about and accidentally ship.
-- ─────────────────────────────────────────────────────────────────────────
