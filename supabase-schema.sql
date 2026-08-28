create extension if not exists pgcrypto;
create extension if not exists pg_cron;

create table if not exists public.diagnoses (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  profile_encrypted text not null,
  answers_encrypted text not null,
  report_encrypted text not null,
  report_token_hash text not null unique,
  marketing_opt_in boolean not null default false,
  adult_confirmed boolean not null default false,
  consent_version text not null,
  source text not null default 'direct',
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  expires_at timestamptz not null
);

alter table public.diagnoses
  add column if not exists profile_encrypted text;
alter table public.diagnoses
  add column if not exists adult_confirmed boolean not null default false;

create index if not exists diagnoses_email_idx on public.diagnoses (lower(email));
create index if not exists diagnoses_created_at_idx on public.diagnoses (created_at desc);
create index if not exists diagnoses_expires_at_idx on public.diagnoses (expires_at);

alter table public.diagnoses enable row level security;
revoke all on table public.diagnoses from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.diagnoses to service_role;

comment on table public.diagnoses is
  'Encrypted diagnostic answers and reports. Access only through server-side service role.';

select cron.schedule(
  'delete-expired-life-reverse-design-reports',
  '17 3 * * *',
  $$delete from public.diagnoses where expires_at < now();$$
);
