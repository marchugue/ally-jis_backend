-- Migration 010: OTP improvements
-- Adds verify_attempts counter and OTP atomic RPC helpers.
-- Apply this in Supabase SQL Editor or via your migration runner.
--
-- Run order: after 009_conversation_type.sql

-- 1. Add verify_attempts column to email_otps (default 0, not null)
ALTER TABLE email_otps
  ADD COLUMN IF NOT EXISTS verify_attempts INTEGER NOT NULL DEFAULT 0;

-- 2. Atomic increment for verify_attempts (prevents read-modify-write race on high concurrency)
CREATE OR REPLACE FUNCTION increment_otp_verify_attempts(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE email_otps
  SET
    verify_attempts = verify_attempts + 1,
    updated_at = NOW()
  WHERE user_id = p_user_id;
END;
$$;

-- 3. Atomic increment for resend_count (replaces the fallback read-modify-write in otp.model.ts)
CREATE OR REPLACE FUNCTION increment_otp_resend(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE email_otps
  SET
    resend_count = resend_count + 1,
    last_resent_at = NOW(),
    updated_at = NOW()
  WHERE user_id = p_user_id;
END;
$$;

-- 4. Index on email for fast findOtpByEmail lookups (supports resume-pending check)
CREATE INDEX IF NOT EXISTS idx_email_otps_email ON email_otps (email);

-- 5. Index on (verified_at, expires_at) for the cleanup sweep
CREATE INDEX IF NOT EXISTS idx_email_otps_unverified_expired
  ON email_otps (expires_at)
  WHERE verified_at IS NULL;
