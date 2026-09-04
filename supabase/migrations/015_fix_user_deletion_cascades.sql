-- 015_fix_user_deletion_cascades.sql
--
-- FIX FOR SUPABASE DASHBOARD 500 ERROR ON USER DELETION:
-- When a user is deleted from Supabase Auth Dashboard or API, Postgres performs a
-- CASCADE delete from `auth.users` to `public.profiles`. If any child table
-- references `public.profiles(id)` or `auth.users(id)` WITHOUT `ON DELETE CASCADE`
-- or `ON DELETE SET NULL`, Postgres raises a Foreign Key Violation constraint error,
-- causing the Supabase Auth Admin API to return an Internal Server Error (500).
--
-- Run this script in your Supabase SQL Editor.

DO $$
BEGIN

  -- 1. PROFILES -> auth.users (ON DELETE CASCADE)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- 2. FOLLOWS -> public.profiles (ON DELETE CASCADE)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'follows') THEN
    ALTER TABLE public.follows DROP CONSTRAINT IF EXISTS follows_follower_id_fkey;
    ALTER TABLE public.follows DROP CONSTRAINT IF EXISTS follows_followed_id_fkey;
    ALTER TABLE public.follows 
      ADD CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
      ADD CONSTRAINT follows_followed_id_fkey FOREIGN KEY (followed_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;

  -- 3. ADMIN_ACTIVITY_LOG -> public.profiles (ON DELETE SET NULL)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_activity_log') THEN
    ALTER TABLE public.admin_activity_log ALTER COLUMN admin_id DROP NOT NULL;
    ALTER TABLE public.admin_activity_log DROP CONSTRAINT IF EXISTS admin_activity_log_admin_id_fkey;
    ALTER TABLE public.admin_activity_log DROP CONSTRAINT IF EXISTS admin_activity_log_target_user_id_fkey;
    ALTER TABLE public.admin_activity_log 
      ADD CONSTRAINT admin_activity_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
      ADD CONSTRAINT admin_activity_log_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  -- 4. REPORTS -> public.profiles (ON DELETE SET NULL)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reports') THEN
    ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_reviewed_by_fkey;
    ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_reporter_id_fkey;
    ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_reported_user_id_fkey;
    ALTER TABLE public.reports 
      ADD CONSTRAINT reports_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
      ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
      ADD CONSTRAINT reports_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  -- 5. SYSTEM_SETTINGS -> public.profiles (ON DELETE SET NULL)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'system_settings') THEN
    ALTER TABLE public.system_settings DROP CONSTRAINT IF EXISTS system_settings_updated_by_fkey;
    ALTER TABLE public.system_settings 
      ADD CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  -- 6. DELETED_MESSAGES_USER -> auth.users (ON DELETE CASCADE)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'deleted_messages_user') THEN
    ALTER TABLE public.deleted_messages_user DROP CONSTRAINT IF EXISTS deleted_messages_user_user_id_fkey;
    ALTER TABLE public.deleted_messages_user 
      ADD CONSTRAINT deleted_messages_user_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- 7. MESSAGE_REACTIONS -> public.profiles (ON DELETE CASCADE)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'message_reactions') THEN
    ALTER TABLE public.message_reactions DROP CONSTRAINT IF EXISTS message_reactions_user_id_fkey;
    ALTER TABLE public.message_reactions 
      ADD CONSTRAINT message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;

  -- 8. BLOCKS -> public.profiles (ON DELETE CASCADE)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'blocks') THEN
    ALTER TABLE public.blocks DROP CONSTRAINT IF EXISTS blocks_blocker_id_fkey;
    ALTER TABLE public.blocks DROP CONSTRAINT IF EXISTS blocks_blocked_id_fkey;
    ALTER TABLE public.blocks 
      ADD CONSTRAINT blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
      ADD CONSTRAINT blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;

  -- 9. EMAIL_OTPS -> auth.users (ON DELETE CASCADE)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'email_otps') THEN
    ALTER TABLE public.email_otps DROP CONSTRAINT IF EXISTS email_otps_user_id_fkey;
    ALTER TABLE public.email_otps 
      ADD CONSTRAINT email_otps_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

END $$;
