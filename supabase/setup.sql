-- =====================================================================
-- Potluck  - database setup
-- Run this whole file in Supabase: Dashboard -> SQL Editor -> New query
-- -> paste EVERYTHING -> make sure NOTHING is highlighted -> Run.
-- It is safe to run again: parts that already exist are skipped or updated.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. DISHES: one row per dish a guest submits.
--    CHECK constraints are the database's own safety net: even if someone
--    bypasses the web page, it refuses empty or giant entries.
-- ---------------------------------------------------------------------
create table if not exists public.dishes (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  dish_name    text not null check (char_length(trim(dish_name)) between 1 and 60),
  cook_name    text not null default '' check (char_length(trim(cook_name)) <= 40),  -- optional
  ingredients  text not null check (char_length(trim(ingredients)) between 1 and 1000),
  allergens    text[] not null default '{}'
               check (cardinality(allergens) <= 20 and char_length(array_to_string(allergens, ',')) <= 300),
  diet_tags    text[] not null default '{}'
               check (cardinality(diet_tags) <= 20 and char_length(array_to_string(diet_tags, ',')) <= 300),
  status       text not null default 'waiting' check (status in ('waiting', 'printed')),
  priority     boolean not null default false,   -- "move to front of the queue"
  printed_at   timestamptz,
  print_count  int not null default 0
);

create index if not exists dishes_queue_idx on public.dishes (status, priority desc, created_at);

-- Update for tables created before the cook's name became optional:
-- "create table if not exists" skips an existing table, so swap the rule here.
alter table public.dishes alter column cook_name set default '';
alter table public.dishes drop constraint if exists dishes_cook_name_check;
alter table public.dishes add constraint dishes_cook_name_check
  check (char_length(trim(cook_name)) <= 40);


-- ---------------------------------------------------------------------
-- 2. SHEETS: remembers what went on each label sheet (top / bottom half),
--    so the admin page knows when a sheet has one unused half left over.
--    "closed" = both halves used, or you chose to throw the leftover away.
-- ---------------------------------------------------------------------
create table if not exists public.sheets (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  top_dish_id     bigint references public.dishes (id) on delete set null,
  bottom_dish_id  bigint references public.dishes (id) on delete set null,
  top_used        boolean not null default false,
  bottom_used     boolean not null default false,
  closed          boolean not null default false
);


-- ---------------------------------------------------------------------
-- 3. ADMINS: which logged-in users may see and print the queue.
--    You add yourself at the end of this file.
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- is_admin(): true when the person calling is listed in admins.
-- "security definer" lets it read the admins table, which nobody can read directly.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;


-- ---------------------------------------------------------------------
-- 4. SECURITY RULES (Row Level Security).
--    The publishable key is public (it's inside the web page), so these
--    rules are what actually protect your data:
--      * guests (anon)  -> may ONLY add a dish, and only these 5 columns
--      * admins         -> may read / update / delete dishes and sheets
--      * everyone else  -> nothing
-- ---------------------------------------------------------------------
alter table public.dishes enable row level security;
alter table public.sheets enable row level security;
alter table public.admins enable row level security;   -- no policies = locked

-- Column-level permissions: guests can't set status, priority, etc.
revoke all on public.dishes from anon, authenticated;
grant insert (dish_name, cook_name, ingredients, allergens, diet_tags)
  on public.dishes to anon, authenticated;
grant select, update, delete on public.dishes to authenticated;

revoke all on public.sheets from anon, authenticated;
grant select, insert, update, delete on public.sheets to authenticated;

revoke all on public.admins from anon, authenticated;

drop policy if exists "Guests can submit dishes" on public.dishes;
create policy "Guests can submit dishes"
  on public.dishes for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Admins can read dishes" on public.dishes;
create policy "Admins can read dishes"
  on public.dishes for select
  to authenticated
  using ((select public.is_admin()));

drop policy if exists "Admins can update dishes" on public.dishes;
create policy "Admins can update dishes"
  on public.dishes for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Admins can delete dishes" on public.dishes;
create policy "Admins can delete dishes"
  on public.dishes for delete
  to authenticated
  using ((select public.is_admin()));

drop policy if exists "Admins manage sheets" on public.sheets;
create policy "Admins manage sheets"
  on public.sheets for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));


-- ---------------------------------------------------------------------
-- 5. LIVE UPDATES: tell Supabase Realtime to broadcast changes to these
--    tables, so the admin page updates the moment a guest submits.
--    (Realtime still obeys the security rules above.)
-- ---------------------------------------------------------------------
do $realtime$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dishes') then
    alter publication supabase_realtime add table public.dishes;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sheets') then
    alter publication supabase_realtime add table public.sheets;
  end if;
end
$realtime$;


-- ---------------------------------------------------------------------
-- 6. PHONE NOTIFICATIONS via ntfy.
--    A "private" schema is NOT reachable from the web API, so the secret
--    ntfy channel name stored here never leaves the database.
--    pg_net lets the database make a web request (to ntfy.sh).
-- ---------------------------------------------------------------------
create extension if not exists pg_net;

create schema if not exists private;

create table if not exists private.app_config (
  id          int primary key default 1 check (id = 1),   -- only ever one row
  ntfy_topic  text,      -- your secret channel name
  admin_url   text       -- tapping the notification opens this page
);
insert into private.app_config (id) values (1) on conflict (id) do nothing;

create or replace function private.notify_new_dish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      record;
  waiting  int;
begin
  select ntfy_topic, admin_url into cfg from private.app_config where id = 1;
  if cfg.ntfy_topic is null or cfg.ntfy_topic = '' then
    return new;
  end if;

  select count(*) into waiting from public.dishes where status = 'waiting';

  perform net.http_post(
    url     := 'https://ntfy.sh/',
    body    := jsonb_strip_nulls(jsonb_build_object(
                 'topic',   cfg.ntfy_topic,
                 'title',   'New dish: ' || new.dish_name,
                 'message', case when trim(new.cook_name) = '' then ''
                                 else 'by ' || new.cook_name || ' - ' end
                            || waiting || ' waiting'
                            || case when waiting >= 2 then ' (ready to print a pair)'
                                    else ' (wait for a pair or print 1 now)' end,
                 'tags',    jsonb_build_array('stew'),
                 'click',   cfg.admin_url
               )),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
exception when others then
  -- Never block a guest's submission just because a notification failed.
  return new;
end;
$$;

drop trigger if exists dishes_notify on public.dishes;
create trigger dishes_notify
  after insert on public.dishes
  for each row execute function private.notify_new_dish();


-- =====================================================================
-- AFTER running the above, do these two small steps (see SETUP.md):
--
-- A) Create your admin login: Dashboard -> Authentication -> Users ->
--    Add user -> "Create new user" (email + password, tick Auto Confirm).
--    Then run (with your email):
--
--      insert into public.admins (user_id)
--      select id from auth.users where email = 'you@example.com';
--
-- B) Turn on notifications (use the channel name from SETUP.md and your
--    real Vercel address once you have it):
--
--      update private.app_config
--      set ntfy_topic = 'potluck-REPLACE-WITH-RANDOM',
--          admin_url  = 'https://YOUR-APP.vercel.app/admin'
--      where id = 1;
-- =====================================================================
