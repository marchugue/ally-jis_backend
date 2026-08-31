-- 014_expo_push_tokens.sql
-- Add expo_push_token column to profiles table for native push notifications

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS expo_push_token text;

CREATE INDEX IF NOT EXISTS idx_profiles_expo_push_token
  ON public.profiles (expo_push_token)
  WHERE expo_push_token IS NOT NULL;
