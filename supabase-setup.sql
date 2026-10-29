-- =====================================================================
-- Central AI Pipeline Tracker — team workspace setup for Supabase
-- Run once: Supabase dashboard → SQL Editor → New query → paste → Run
-- BEFORE RUNNING: change the email on the LAST "insert" line to yours.
-- =====================================================================

-- Team members and their access level
create table if not exists public.crm_members (
  email     text primary key check (email = lower(email)),
  role      text not null check (role in ('owner','editor','viewer')),
  added_at  timestamptz not null default now()
);

-- Data tables (each record stored as JSON so the app can evolve freely)
create table if not exists public.crm_leads (
  id text primary key, data jsonb not null,
  updated_at timestamptz not null default now(), updated_by text
);
create table if not exists public.crm_activities (
  id text primary key, data jsonb not null,
  updated_at timestamptz not null default now(), updated_by text
);
create table if not exists public.crm_plan (
  id text primary key, data jsonb not null,          -- id = the day, e.g. 2026-11-01
  updated_at timestamptz not null default now(), updated_by text
);
create table if not exists public.crm_settings (
  id int primary key default 1 check (id = 1), data jsonb not null,
  updated_at timestamptz not null default now(), updated_by text
);

-- Returns the signed-in person's role, or null if they are not on the team
create or replace function public.crm_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.crm_members where email = lower(auth.jwt() ->> 'email')
$$;
revoke all on function public.crm_role() from public;
grant execute on function public.crm_role() to authenticated;

-- Row Level Security: only team members can read; owners and editors can write
alter table public.crm_members    enable row level security;
alter table public.crm_leads      enable row level security;
alter table public.crm_activities enable row level security;
alter table public.crm_plan       enable row level security;
alter table public.crm_settings   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['crm_leads','crm_activities','crm_plan','crm_settings'] loop
    execute format('drop policy if exists "team read" on public.%I', t);
    execute format('drop policy if exists "team write" on public.%I', t);
    execute format('create policy "team read" on public.%I for select to authenticated using (public.crm_role() is not null)', t);
    execute format('create policy "team write" on public.%I for all to authenticated using (public.crm_role() in (''owner'',''editor'')) with check (public.crm_role() in (''owner'',''editor''))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

drop policy if exists "team read" on public.crm_members;
drop policy if exists "owner manages" on public.crm_members;
create policy "team read" on public.crm_members for select to authenticated using (public.crm_role() is not null);
create policy "owner manages" on public.crm_members for all to authenticated
  using (public.crm_role() = 'owner') with check (public.crm_role() = 'owner');
grant select, insert, update, delete on public.crm_members to authenticated;

-- Live updates between team members
do $$
declare t text;
begin
  foreach t in array array['crm_members','crm_leads','crm_activities','crm_plan','crm_settings'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- >>> CHANGE THIS TO YOUR OWN EMAIL (the account that owns the tracker) <<<
insert into public.crm_members (email, role) values (lower('you@example.com'), 'owner')
on conflict (email) do update set role = 'owner';
