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
  PORT: Number(process.env.PORT ?? 3001),
  WEB_URL: process.env.WEB_URL ?? 'http://localhost:5174',
  SUPABASE_URL: required('SUPABASE_URL'),
  SUPABASE_ANON_KEY: required('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY'),
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  PASSWORD_RESET_REDIRECT_URL:
    process.env.PASSWORD_RESET_REDIRECT_URL ?? `${process.env.WEB_URL ?? 'http://localhost:5174'}/reset-password`,
};
