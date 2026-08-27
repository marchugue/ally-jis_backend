-- 011_admin_settings.sql
--
-- Key-value system settings. Only two keys are actually wired to real
-- behavior this pass (maintenance_mode in a new middleware,
-- registrations_enabled in auth.service.ts#register) — the rest are
-- storage only for now, honestly labeled as such in the admin UI rather
-- than presented as if they already affect something. Matching-related
-- settings aren't here at all: there's nothing to wire them to without
-- the actual matching RPC bodies (002_matchmaking.sql), which weren't
-- part of what was shared.

CREATE TABLE IF NOT EXISTS public.system_settings (
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id),
  CONSTRAINT system_settings_pkey PRIMARY KEY (key)
);

INSERT INTO public.system_settings (key, value) VALUES
  ('maintenance_mode', 'false'),
  ('maintenance_message', '"Ally-jis is undergoing maintenance. Please check back shortly."'),
  ('registrations_enabled', 'true'),
  ('platform_name', '"Ally-jis"'),
  ('support_email', 'null'),
  ('require_email_verification', 'true')
ON CONFLICT (key) DO NOTHING;
