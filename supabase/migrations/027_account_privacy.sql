-- 027_account_privacy.sql
-- Public / private account setting.
--   public  : anyone may open the profile page and see its public posts
--             (identity stays anonymous unless the viewer is an ally).
--   private : the profile page is still reachable, but only allies can see posts.
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS account_privacy TEXT NOT NULL DEFAULT 'public';

ALTER TABLE public.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_account_privacy_check;

ALTER TABLE public.user_preferences
  ADD CONSTRAINT user_preferences_account_privacy_check
  CHECK (account_privacy IN ('public', 'private'));
