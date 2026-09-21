-- Password reset tokens (Resend email links, not Supabase Auth recovery)

create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade unique,
  email text not null,
  token_hash text not null,
  tracking_token text not null unique,
  source text not null default 'web' check (source in ('web', 'mobile')),
  expires_at timestamptz not null,
  used_at timestamptz,
  reset_completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists password_reset_tokens_user_id_idx on public.password_reset_tokens (user_id);
create index if not exists password_reset_tokens_tracking_token_idx on public.password_reset_tokens (tracking_token);

alter table public.password_reset_tokens disable row level security;

drop trigger if exists set_password_reset_tokens_updated_at on public.password_reset_tokens;
create trigger set_password_reset_tokens_updated_at
before update on public.password_reset_tokens
for each row execute function public.set_updated_at();
