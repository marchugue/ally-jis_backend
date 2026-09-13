-- 017_student_id_back_url.sql
--
-- Adds student_id_back_url to public.profiles to store the back side
-- scan of the student ID / COR for external email verification.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS student_id_back_url text;
