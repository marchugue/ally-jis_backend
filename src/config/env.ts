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
    process.env.EMAIL_REDIRECT_URL ?? `${process.env.WEB_URL ?? 'http://localhost:5174'}/confirmation-page`,
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID ?? '',
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? '',
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? '',
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME ?? 'ally-jis-media',
  R2_PUBLIC_DOMAIN: process.env.R2_PUBLIC_DOMAIN ?? '',
  R2_ENDPOINT: process.env.R2_ENDPOINT ?? (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : ''),
};

