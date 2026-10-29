-- =====================================================================
-- Central AI Pipeline Tracker — cloud setup for Supabase (v2: accounts + team workspaces)
-- Run once: Supabase dashboard → SQL Editor → New query → paste → Run.
-- Safe to run again: it only adds what is missing and refreshes the rules.
--
-- IMPORTANT: keep Authentication → Sign In / Providers → Email → "Confirm email" ON.
-- Access is matched by email address, so people must prove they own their email.
-- =====================================================================

-- ---------- Tables ----------

-- A team or company. Created by anyone who registers; they become its first admin.
create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  timezone    text not null default 'Asia/Dhaka',      -- "today" and the midnight lock use this zone
  lock_days   boolean not null default true,           -- users can only fill in today; past days lock at midnight
  settings    jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),  -- tasks, job roles, weightages
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- Who can open a workspace. admin = manage everything, user = fill in own sheets, viewer = look only.
create table if not exists public.members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email        text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  role         text not null check (role in ('admin','user','viewer')),
  name         text check (char_length(name) <= 120),
  added_at     timestamptz not null default now(),
  primary key (workspace_id, email)
);
create index if not exists members_email_idx on public.members(email);

-- One daily work log (or plan) per person. Name, targets and owner are set by an admin.
create table if not exists public.sheets (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  kind         text not null default 'work' check (kind in ('work','plan')),
  owner_email  text check (owner_email = lower(btrim(owner_email))),   -- the member who fills it in
  person       text check (char_length(person) <= 120),
  role_id      text,
  targets      jsonb not null default '{}'::jsonb check (jsonb_typeof(targets) = 'object'),
  position     int not null default 0,
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   text
);
create index if not exists sheets_ws_idx on public.sheets(workspace_id);

-- One row per sheet per day: up to 10 one-hour slots (task ids) plus remarks.
create table if not exists public.sheet_entries (
  sheet_id     uuid not null references public.sheets(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,  -- copied from the sheet by a trigger
  day          date not null,
  slots        jsonb not null default '[]'::jsonb check (jsonb_typeof(slots) = 'array' and jsonb_array_length(slots) <= 10),
  remarks      text not null default '' check (char_length(remarks) <= 2000),
  updated_at   timestamptz not null default now(),
  updated_by   text,
  primary key (sheet_id, day)
);
create index if not exists sheet_entries_ws_idx on public.sheet_entries(workspace_id, day);

-- Weekly results per sheet. week_start is the first day of the team's week (Saturday by default).
create table if not exists public.kpi_entries (
  sheet_id     uuid not null references public.sheets(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  week_start   date not null,
  leads        int not null default 0 check (leads between 0 and 1000000),
  opps         int not null default 0 check (opps between 0 and 1000000),
  clients      int not null default 0 check (clients between 0 and 1000000),
  revenue      numeric(16,2) not null default 0 check (revenue >= 0),
  notes        text not null default '' check (char_length(notes) <= 2000),
  updated_at   timestamptz not null default now(),
  updated_by   text,
  primary key (sheet_id, week_start)
);
create index if not exists kpi_entries_ws_idx on public.kpi_entries(workspace_id, week_start);

-- Each person's own tracker (pipeline, daily plan, activity log, settings). Only its owner can see it.
create table if not exists public.tracker_items (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner        uuid not null default auth.uid(),
  kind         text not null check (kind in ('lead','act','plan','settings')),
  id           text not null check (char_length(id) <= 100),
  data         jsonb not null,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, owner, kind, id)
);
create index if not exists tracker_items_owner_idx on public.tracker_items(owner, workspace_id);

-- ---------- Who is asking ----------

-- The signed-in person's email, only once they have confirmed it.
create or replace function public.my_email() returns text
language sql stable security definer set search_path = public, auth as $$
  select lower(u.email) from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null
$$;

create or replace function public.my_workspace_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select workspace_id from public.members where email = public.my_email()
$$;

-- 'admin', 'user', 'viewer', or null when not a member
create or replace function public.ws_role(ws uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where workspace_id = ws and email = public.my_email()
$$;

-- Admins can change any day. A user can change only their own sheet, and with the lock on:
-- a work log only for today, a plan for today or later. Yesterday locks at midnight in the team's time zone.
create or replace function public.can_write_entry(p_sheet uuid, p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case public.ws_role(s.workspace_id)
      when 'admin' then true
      when 'user' then not s.archived
        and s.owner_email = public.my_email()
        and (not w.lock_days or (
              p_day >= (now() at time zone w.timezone)::date
          and (s.kind = 'plan' or p_day <= (now() at time zone w.timezone)::date)))
      else false end
    from public.sheets s join public.workspaces w on w.id = s.workspace_id
    where s.id = p_sheet), false)
$$;

-- Weekly results: a user can change their own work sheet's current week only (when the lock is on).
create or replace function public.can_write_kpi(p_sheet uuid, p_week date) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case public.ws_role(s.workspace_id)
      when 'admin' then true
      when 'user' then not s.archived and s.kind = 'work'
        and s.owner_email = public.my_email()
        and (not w.lock_days or (now() at time zone w.timezone)::date between p_week and p_week + 6)
      else false end
    from public.sheets s join public.workspaces w on w.id = s.workspace_id
    where s.id = p_sheet), false)
$$;

-- ---------- Creating a workspace ----------

create or replace function public.create_workspace(p_name text, p_person text default null,
  p_timezone text default 'Asia/Dhaka', p_settings jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_email text := public.my_email(); v_id uuid;
begin
  if v_email is null then raise exception 'Confirm your email address before creating a workspace'; end if;
  if (select count(*) from public.members where email = v_email and role = 'admin') >= 20 then
    raise exception 'You can be admin of at most 20 workspaces';
  end if;
  insert into public.workspaces(name, timezone, settings, created_by, updated_by)
    values (btrim(p_name), coalesce(nullif(btrim(p_timezone), ''), 'Asia/Dhaka'), coalesce(p_settings, '{}'::jsonb), auth.uid(), v_email)
    returning id into v_id;
  insert into public.members(workspace_id, email, role, name) values (v_id, v_email, 'admin', nullif(btrim(p_person), ''));
  return v_id;
end $$;

-- ---------- Triggers ----------

create or replace function public.stamp_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(public.my_email(), new.updated_by);
  return new;
end $$;

create or replace function public.touch_row() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create or replace function public.check_workspace() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform now() at time zone new.timezone;   -- raises for an unknown time zone
  if tg_op = 'UPDATE' then new.created_by := old.created_by; new.created_at := old.created_at; end if;
  new.updated_at := now();
  new.updated_by := coalesce(public.my_email(), new.updated_by);
  return new;
end $$;

-- Entries always belong to their sheet's workspace, whatever the app sends.
create or replace function public.sync_sheet_workspace() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select s.workspace_id into new.workspace_id from public.sheets s where s.id = new.sheet_id;
  if new.workspace_id is null then raise exception 'Sheet not found'; end if;
  return new;
end $$;

-- A sheet can't be moved to another workspace.
create or replace function public.keep_sheet_workspace() returns trigger
language plpgsql as $$
begin new.workspace_id := old.workspace_id; return new; end $$;

-- Every workspace keeps at least one admin (deleting the whole workspace is still allowed).
create or replace function public.keep_one_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin' or new.workspace_id <> old.workspace_id)
     and exists (select 1 from public.workspaces where id = old.workspace_id)
     and not exists (select 1 from public.members where workspace_id = old.workspace_id and role = 'admin' and email <> old.email) then
    raise exception 'A workspace needs at least one admin. Make someone else admin first.';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists workspaces_check on public.workspaces;
create trigger workspaces_check before insert or update on public.workspaces for each row execute function public.check_workspace();
drop trigger if exists members_keep_admin on public.members;
create trigger members_keep_admin before update or delete on public.members for each row execute function public.keep_one_admin();
drop trigger if exists sheets_stamp on public.sheets;
create trigger sheets_stamp before insert or update on public.sheets for each row execute function public.stamp_row();
drop trigger if exists sheets_keep_ws on public.sheets;
create trigger sheets_keep_ws before update on public.sheets for each row execute function public.keep_sheet_workspace();
drop trigger if exists entries_ws on public.sheet_entries;
create trigger entries_ws before insert or update on public.sheet_entries for each row execute function public.sync_sheet_workspace();
drop trigger if exists entries_stamp on public.sheet_entries;
create trigger entries_stamp before insert or update on public.sheet_entries for each row execute function public.stamp_row();
drop trigger if exists kpi_ws on public.kpi_entries;
create trigger kpi_ws before insert or update on public.kpi_entries for each row execute function public.sync_sheet_workspace();
drop trigger if exists kpi_stamp on public.kpi_entries;
create trigger kpi_stamp before insert or update on public.kpi_entries for each row execute function public.stamp_row();
drop trigger if exists tracker_touch on public.tracker_items;
create trigger tracker_touch before insert or update on public.tracker_items for each row execute function public.touch_row();

-- ---------- Row Level Security ----------

alter table public.workspaces    enable row level security;
alter table public.members       enable row level security;
alter table public.sheets        enable row level security;
alter table public.sheet_entries enable row level security;
alter table public.kpi_entries   enable row level security;
alter table public.tracker_items enable row level security;

do $$
declare p record;
begin
  -- start clean so re-running this script never leaves an old rule behind
  for p in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('workspaces','members','sheets','sheet_entries','kpi_entries','tracker_items') loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- workspaces: members read; admins change or delete. New workspaces come from create_workspace().
create policy "members read" on public.workspaces for select to authenticated
  using (id in (select public.my_workspace_ids()));
create policy "admins update" on public.workspaces for update to authenticated
  using (public.ws_role(id) = 'admin') with check (public.ws_role(id) = 'admin');
create policy "admins delete" on public.workspaces for delete to authenticated
  using (public.ws_role(id) = 'admin');

-- members: everyone in the workspace sees the team list; admins manage it; anyone can leave.
create policy "members read" on public.members for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()));
create policy "admins add" on public.members for insert to authenticated
  with check (public.ws_role(workspace_id) = 'admin');
create policy "admins update" on public.members for update to authenticated
  using (public.ws_role(workspace_id) = 'admin') with check (public.ws_role(workspace_id) = 'admin');
create policy "admins remove or self leave" on public.members for delete to authenticated
  using (public.ws_role(workspace_id) = 'admin' or email = public.my_email());

-- sheets: everyone in the workspace sees them; only admins create, rename, set targets or delete.
create policy "members read" on public.sheets for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()));
create policy "admins write" on public.sheets for all to authenticated
  using (public.ws_role(workspace_id) = 'admin') with check (public.ws_role(workspace_id) = 'admin');

-- daily entries: everyone in the workspace sees them; writes follow can_write_entry().
create policy "members read" on public.sheet_entries for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()));
create policy "owner or admin add" on public.sheet_entries for insert to authenticated
  with check (public.can_write_entry(sheet_id, day));
create policy "owner or admin change" on public.sheet_entries for update to authenticated
  using (public.can_write_entry(sheet_id, day)) with check (public.can_write_entry(sheet_id, day));
create policy "owner or admin clear" on public.sheet_entries for delete to authenticated
  using (public.can_write_entry(sheet_id, day));

-- weekly results: same idea, by week.
create policy "members read" on public.kpi_entries for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()));
create policy "owner or admin add" on public.kpi_entries for insert to authenticated
  with check (public.can_write_kpi(sheet_id, week_start));
create policy "owner or admin change" on public.kpi_entries for update to authenticated
  using (public.can_write_kpi(sheet_id, week_start)) with check (public.can_write_kpi(sheet_id, week_start));
create policy "owner or admin clear" on public.kpi_entries for delete to authenticated
  using (public.can_write_kpi(sheet_id, week_start));

-- personal trackers: only the owner, and only while they are still in the workspace.
create policy "owner only" on public.tracker_items for all to authenticated
  using (owner = auth.uid() and workspace_id in (select public.my_workspace_ids()))
  with check (owner = auth.uid() and workspace_id in (select public.my_workspace_ids()));

-- ---------- Permissions ----------

revoke all on public.workspaces, public.members, public.sheets, public.sheet_entries, public.kpi_entries, public.tracker_items from anon;
grant select, insert, update, delete on public.workspaces, public.members, public.sheets, public.sheet_entries, public.kpi_entries, public.tracker_items to authenticated;

revoke all on function public.my_email() from public;
revoke all on function public.my_workspace_ids() from public;
revoke all on function public.ws_role(uuid) from public;
revoke all on function public.can_write_entry(uuid, date) from public;
revoke all on function public.can_write_kpi(uuid, date) from public;
revoke all on function public.create_workspace(text, text, text, jsonb) from public;
grant execute on function public.my_email() to authenticated;
grant execute on function public.my_workspace_ids() to authenticated;
grant execute on function public.ws_role(uuid) to authenticated;
grant execute on function public.can_write_entry(uuid, date) to authenticated;
grant execute on function public.can_write_kpi(uuid, date) to authenticated;
grant execute on function public.create_workspace(text, text, text, jsonb) to authenticated;

-- ---------- Live updates ----------

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['workspaces','members','sheets','sheet_entries','kpi_entries','tracker_items'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;

-- ---------- Older version ----------
-- Version 1 used the tables crm_members, crm_leads, crm_activities, crm_plan and crm_settings.
-- They are no longer used. After moving your data (Download backup → Restore), you can remove them:
-- drop table if exists public.crm_leads, public.crm_activities, public.crm_plan, public.crm_settings, public.crm_members;
-- drop function if exists public.crm_role();
