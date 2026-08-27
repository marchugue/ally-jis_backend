-- 009_admin_reports.sql
--
-- The reports table already existed (users could submit reports), but
-- nothing existed for an admin to review one. Widens status from
-- pending/reviewed/dismissed to the 4 states the admin workflow actually
-- needs, and adds internal notes + who-reviewed-it tracking.
--
-- Note: reports.description and evidence images are NOT added here —
-- the existing submit-a-report flow (moderation.model.ts#createReport)
-- never collected them in the first place. Extending that is a separate,
-- pre-existing gap, not part of this admin-side pass.

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_status_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'reviewing'::text, 'resolved'::text, 'rejected'::text]));

-- Existing rows using the old 'reviewed'/'dismissed' values (if any) map
-- onto the closest new equivalent so the constraint above doesn't fail
-- on data that predates this migration.
UPDATE public.reports SET status = 'resolved' WHERE status = 'reviewed';
UPDATE public.reports SET status = 'rejected' WHERE status = 'dismissed';

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS internal_notes text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS reports_status_idx ON public.reports (status);
