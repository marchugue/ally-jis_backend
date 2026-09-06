import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  PORT: Number(process.env.PORT ?? 5174),
  WEB_URL: process.env.WEB_URL ?? 'http://localhost:5174',
  SUPABASE_URL: required('SUPABASE_URL'),
  SUPABASE_ANON_KEY: required('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY'),
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  PASSWORD_RESET_REDIRECT_URL:
    process.env.PASSWORD_RESET_REDIRECT_URL ?? `${process.env.WEB_URL ?? 'http://localhost:5174'}/forgot-password`,
  EMAIL_REDIRECT_URL:
    process.env.EMAIL_REDIRECT_URL ?? `${process.env.WEB_URL ?? 'http://localhost:5174'}/verify-email`,
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID ?? '',
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? '',
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? '',
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME ?? 'ally-jis-media',
  R2_PUBLIC_DOMAIN: process.env.R2_PUBLIC_DOMAIN ?? '',
  R2_ENDPOINT: process.env.R2_ENDPOINT ?? (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : ''),

  // ─── Resend (Email) ──────────────────────────────────────────────────────
  // Get your API key from resend.com/api-keys
  // Leave blank to fall back to console-log stub in development.
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',
  RESEND_FROM: process.env.RESEND_FROM ?? '"Ally-jis" <no-reply@ally-jis.xyz>',

  // ─── OTP Configuration ────────────────────────────────────────────────────
  OTP_EXPIRY_MINUTES: Number(process.env.OTP_EXPIRY_MINUTES ?? 10),
  OTP_MAX_RESENDS: Number(process.env.OTP_MAX_RESENDS ?? 3),

  // ─── Redis Caching & PubSub ───────────────────────────────────────────────
  // e.g. redis://127.0.0.1:6379 or rediss://...
  REDIS_URL: process.env.REDIS_URL ?? '',
  REDIS_ENABLED: process.env.REDIS_ENABLED !== 'false' && Boolean(process.env.REDIS_URL),
};

