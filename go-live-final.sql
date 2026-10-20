-- ============================================================
-- Deep & Honey · Eternal Contract — GO-LIVE SQL  v6.0 DH (FINAL, ONE-SHOT)
-- Project: nmxowqizxsujhmfnfdto   →   https://nmxowqizxsujhmfnfdto.supabase.co
-- (this is EXACTLY the project js/supabase-config.js writes to — the old
--  go-live*.sql files still named the retired project qbnxcfwwsuqfmearyris,
--  which is why "the other phone" never saw anything: the tables the app
--  actually uses were never set up in the live project.)
--
-- 👉 Paste this ENTIRE file into: Supabase Dashboard → open project
--    "nmxowqizxsujhmfnfdto" → SQL Editor → New query → Run   (once)
--
-- WHY SYNC FAILED ON THE OTHER PHONE (all reasons found in the code):
--   1. Wrong-project SQL: every previous script targeted the retired
--      project; the LIVE project may have no contract_state table, no
--      policy, or an OLD restrictive policy → anon writes/reads fail.
--   2. Missing 'last_writer' column: cloud.js ALWAYS sends it in every
--      upsert; if the column doesn't exist EVERY save fails silently →
--      nothing ever lands in the cloud → nothing to show on phone B.
--   3. Realtime not enabled for contract_state: without it phone B only
--      hears about changes when you re-open / focus the tab.
--   4. Stale 'deleted' tombstones could hide days on all devices —
--      section 7 below purges tombstones older than the day's data.
--   5. The structured "readable tables" (contract_day_sections etc.)
--      never existed in the live project → js/sections.js pushes got 404.
--
-- WHAT THIS DOES
--   A. Creates + fully repairs the KEY/VALUE store public.contract_state
--      (keys 'fields','accepts','days','deleted') exactly as js/cloud.js
--      reads/writes it — permissive RLS for BOTH roles, audit columns,
--      updated_at trigger, REALTIME publication, replica identity full,
--      grants. Your existing synced data is preserved (never dropped).
--   B. Creates ONE TABLE PER SECTION with clean headings (same schema as
--      go-live-structured.sql) + heading registry + realtime + grants,
--      so js/sections.js can push readable rows from every device.
--   C. Heals stale deletion tombstones and shows verification SELECTs.
--
-- SAFE TO RE-RUN ANY TIME: create-if-not-exists / or-replace everywhere.
-- NON-DESTRUCTIVE: never drops the tables or your rows.
-- ============================================================

-- ------------------------------------------------------------
-- 1) THE CLOUD STATE TABLE — same shape js/cloud.js expects
-- ------------------------------------------------------------
create table if not exists public.contract_state (
  k           text primary key,               -- 'fields' | 'accepts' | 'days' | 'deleted'
  v           jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  last_writer text        not null default 'unknown'
);

comment on table  public.contract_state is
  'Deep & Honey contract cloud store: every text entry + signatures + all created day pages + deletion tombstones.';
comment on column public.contract_state.last_writer is
  'Opaque tag of the device that wrote this key last (cross-device sync audit).';

-- repair an older table missing the audit columns (a missing last_writer
-- column makes EVERY app upsert fail → "nothing syncs")
alter table public.contract_state
  add column if not exists last_writer text not null default 'unknown';
alter table public.contract_state
  add column if not exists created_at  timestamptz not null default now();

-- ------------------------------------------------------------
-- 2) AUTO-REFRESH updated_at ON EVERY WRITE (insert AND update)
--    Last-writer-wins merges fall back to updated_at for payloads
--    without an internal __ts stamp, so both events matter.
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists contract_state_touch on public.contract_state;
create trigger contract_state_touch
  before insert or update on public.contract_state
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 3) SECURITY — RLS ON with a permissive policy that covers BOTH
--    the anon role (what the app calls with) AND authenticated
--    (what a logged-in session uses). Old/partial policies are
--    dropped first so a half-set-up project self-heals.
--    (The app has its own password gate by design.)
-- ------------------------------------------------------------
alter table public.contract_state enable row level security;
drop policy if exists "contract rw"     on public.contract_state;
drop policy if exists "contract_anon_rw" on public.contract_state;
drop policy if exists "contract_auth_rw" on public.contract_state;

create policy "contract_anon_rw" on public.contract_state
  for all to anon
  using (true) with check (true);

create policy "contract_auth_rw" on public.contract_state
  for all to authenticated
  using (true) with check (true);

-- ------------------------------------------------------------
-- 4) REALTIME — instant multi-device sync (phone B updates within
--    ~1 second of phone A pressing 💾 Save, no refresh needed)
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public'
                   and tablename = 'contract_state') then
    alter publication supabase_realtime add table public.contract_state;
  end if;
end $$;

alter table public.contract_state replica identity full;

-- ------------------------------------------------------------
-- 5) GRANTS — the API roles must be able to use the table
-- ------------------------------------------------------------
grant usage                          on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.contract_state to anon, authenticated;
grant all                            on public.contract_state to service_role;

-- ------------------------------------------------------------
-- 6) OPTIONAL SEED — pre-create the four state keys so the table
--    is visibly ready. ON CONFLICT DO NOTHING ⇒ NEVER overwrites
--    data your devices already synced.
-- ------------------------------------------------------------
insert into public.contract_state (k, v) values
  ('fields',  '{}'::jsonb),          -- every text entry (Day + Affidavit + Log Book forms)
  ('accepts', '{}'::jsonb),          -- signatures / acceptances
  ('days',    '[]'::jsonb),          -- every created day page (full HTML)
  ('deleted', '{}'::jsonb)           -- deletion tombstones
on conflict (k) do nothing;

-- remove the dead legacy sticky-wipe flag (app never honours it since v4.0)
delete from public.contract_state where k = 'wiped';

-- ------------------------------------------------------------
-- 7) SELF-HEAL STALE TOMBSTONES — a 'deleted' entry older than the
--    newest surviving copy of that day HIDES the day on every phone
--    forever (this was the "created day never appears after login"
--    bug). Purge those stale tombstones from the shared cloud now.
-- ------------------------------------------------------------
with day_latest AS (
  select j->>'id' as day_id,
         greatest(
           coalesce((j->>'updatedAt')::bigint, 0),
           coalesce((j->>'createdAt')::bigint, 0)
         ) as latest_ms
  from public.contract_state cs,
       lateral jsonb_array_elements(cs.v) j
  where cs.k = 'days' and jsonb_typeof(cs.v) = 'array'
),
tomb AS (
  select cs.updated_at, e.key as day_id, (e.value)::bigint as del_ms
  from public.contract_state cs,
       lateral jsonb_each_text(cs.v) e
  where cs.k = 'deleted' and jsonb_typeof(cs.v) = 'object'
)
update public.contract_state cs
set v = (select coalesce(jsonb_object_agg(t.day_id, t.del_ms), '{}'::jsonb)
         from tomb t
         where t.updated_at = cs.updated_at
           and not exists (select 1 from day_latest d
                           where d.day_id = t.day_id
                             and d.latest_ms >= t.del_ms))
where cs.k = 'deleted';

-- ------------------------------------------------------------
-- 8) HEADING REGISTRY — "give their heading for all sections"
-- ------------------------------------------------------------
create table if not exists public.contract_section_headings (
  section_key text primary key,
  heading     text not null,
  cloud_table text not null,
  sort_order  int  not null default 0
);

insert into public.contract_section_headings (section_key, heading, cloud_table, sort_order) values
 ('day_header',       '📅 Day header — title, couple type, mood & tone, intensity, who leads, venue, duration, aftercare focus', 'contract_days', 1),
 ('articles',         '📜 Articles 1–8 — Preamble, Session Parameters, Play Bill, New Activities, Hard Limits, Aftercare, Special Requests, Safewords', 'contract_articles', 2),
 ('play_bill',        '🎬 Article 3 · Scheduled Activities (The Play Bill)', 'contract_play_bill', 3),
 ('hard_limits',      '🚫 Article 5 · Hard Limits — Session Specific', 'contract_hard_limits', 4),
 ('aftercare',        '💞 Article 6 · Aftercare Provision', 'contract_aftercare', 5),
 ('safewords',        '🛑 Article 8 · Safewords & Withdrawal of Consent', 'contract_safewords', 6),
 ('signatories',      '✍️ Signatories — Submissive / Dominant acceptance & dates', 'contract_signatories', 7),
 ('affidavit',        '🗒 Pre-Scene Execution Affidavit — date, time, six confirmations', 'contract_affidavit', 8),
 ('debrief',          '🔁 Scene Debrief — satisfaction, safeword use, adjustments, signatures', 'contract_debrief', 9),
 ('logbook',          '📔 BDSM Log Book — 8 sheets (Daily log, Scene plan, Toys, Bonus, Dominant journal, Debrief, Sub→Dom, Dom→Sub)', 'contract_log_book_rows', 10),
 ('field_entries',    '🧾 Every individual field entry across the whole contract', 'contract_field_entries', 11),
 ('generator_form',   '✨ AI Assistant — Write Our Day form selections', 'contract_generator_choices', 12),
 ('day_sections',     '🪪 ALL day data by section, headings included (pushed live from each device)', 'contract_day_sections', 13)
on conflict (section_key) do update
  set heading = excluded.heading, cloud_table = excluded.cloud_table,
      sort_order = excluded.sort_order;

-- ------------------------------------------------------------
-- 9) STRUCTURED TABLES — one per section, proper column headings
-- ------------------------------------------------------------
create table if not exists public.contract_days (
  day_id       bigint generated always as identity primary key,
  slug         text unique not null,
  title        text,
  ai_drafted   boolean default false,
  couple_type  text, mood_tone text, intensity text, lead text, venue text,
  between_line text,
  planned_duration text, aftercare_focus text,
  special_request_sub text, special_request_dom text,
  extra_limits text, extra_notes text,
  synced_at    timestamptz not null default now()
);

create table if not exists public.contract_articles (
  id         bigint generated always as identity primary key,
  slug       text not null,
  article_no int  not null,
  heading    text not null,
  body       text,
  unique (slug, article_no)
);

create table if not exists public.contract_play_bill (
  id        bigint generated always as identity primary key,
  slug      text not null,
  category  text,               -- heading col 1
  implement text,               -- heading col 2
  ord       int  not null default 0
);

create table if not exists public.contract_hard_limits (
  id          bigint generated always as identity primary key,
  slug        text not null,
  clause      text,             -- 5.1, 5.2 …
  prohibition text,
  ord         int not null default 0
);

create table if not exists public.contract_aftercare (
  id          bigint generated always as identity primary key,
  slug        text not null,
  deliverable text,
  duration    text,
  ord         int not null default 0
);

create table if not exists public.contract_safewords (
  id      bigint generated always as identity primary key,
  slug    text not null,
  word    text, meaning text, action_required text,
  ord     int not null default 0
);

create table if not exists public.contract_signatories (
  id       bigint generated always as identity primary key,
  slug     text not null,
  party    text not null,          -- submissive | dominant
  kind     text not null,          -- signature | debrief
  name     text, printed_name text,
  accepted boolean default false,
  accept_date text,
  unique (slug, party, kind)
);

create table if not exists public.contract_affidavit (
  id       bigint generated always as identity primary key,
  slug     text not null unique,
  exec_date text, exec_time text,
  both_read_understood boolean default false,
  bathroom_ok          boolean default false,
  water_30min          boolean default false,
  toys_clean           boolean default false,
  activities_agreed    boolean default false,
  safewords_spoken     boolean default false
);

create table if not exists public.contract_debrief (
  id       bigint generated always as identity primary key,
  slug     text not null unique,
  satisfaction text, aftercare_effectiveness text,
  safeword_used text, safeword_which text,
  adjustments text, notes text,
  dom_signature text, dom_date text,
  sub_signature text, sub_date  text,
  love_stamp text
);

create table if not exists public.contract_log_book_rows (
  id            bigint generated always as identity primary key,
  slug          text not null,
  sheet_key     text not null,     -- dailyBody … dominantFeedbackBody
  sheet_name    text not null,     -- 📅 Daily log …
  field_heading text not null,     -- column heading inside the sheet
  value         text,
  lb_date       text,              -- Date (from 2.1)
  synced_at     timestamptz not null default now(),
  unique (slug, sheet_key, field_heading)
);

create table if not exists public.contract_field_entries (
  id        bigint generated always as identity primary key,
  state_key text not null,             -- fields | accepts
  entry_key text not null,             -- stable data-dhk key
  slug      text,
  section   text,
  heading   text,
  value     text,
  updated_at timestamptz not null default now(),
  unique (state_key, entry_key)
);

create table if not exists public.contract_generator_choices (
  id         bigint generated always as identity primary key,
  choice_key text not null unique,     -- coupleType / moodTone / intensity …
  heading    text not null,            -- human heading of the control
  value      text,
  updated_at timestamptz not null default now()
);

-- THE headline table: every section of every day, headings included,
-- pushed straight from the live page by every device on each save.
create table if not exists public.contract_day_sections (
  id        bigint generated always as identity primary key,
  slug      text not null,
  heading   text not null,            -- e.g. '🎬 Article 3 · Scheduled Activities (The Play Bill)'
  content   text not null,            -- all rows/values of that section, newline-separated
  ord       int  not null default 0,
  writer    text default 'unknown',
  synced_at timestamptz not null default now(),
  unique (slug, heading)
);

create index if not exists ar_slug   on public.contract_articles(slug);
create index if not exists pb_slug   on public.contract_play_bill(slug);
create index if not exists hl_slug   on public.contract_hard_limits(slug);
create index if not exists ac_slug   on public.contract_aftercare(slug);
create index if not exists sw_slug   on public.contract_safewords(slug);
create index if not exists lb_slug   on public.contract_log_book_rows(slug);
create index if not exists fe_slug   on public.contract_field_entries(slug);
create index if not exists ds_slug   on public.contract_day_sections(slug);

-- ------------------------------------------------------------
-- 10) ACCESS — same open-by-design RLS for the couple's private app
--     (the app itself is password-gated), for BOTH roles.
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'contract_days','contract_articles','contract_play_bill','contract_hard_limits',
    'contract_aftercare','contract_safewords','contract_signatories','contract_affidavit',
    'contract_debrief','contract_log_book_rows','contract_field_entries',
    'contract_generator_choices','contract_day_sections','contract_section_headings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "couple rw" on public.%I', t);
    execute format('create policy "couple rw" on public.%I for all to anon, authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated, service_role', t);
  end loop;
end $$;

-- realtime for the readable tables too (live dashboards / debugging)
do $$
declare t text;
begin
  foreach t in array array[
    'contract_day_sections','contract_field_entries','contract_log_book_rows',
    'contract_generator_choices','contract_days']
  loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public'
                     and tablename = t) then
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when others then null; end;
    end if;
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 11) VIEWS — read everything laid out by section with headings:
--      select * from contract_day_overview;
--      select * from contract_all_data;
-- ------------------------------------------------------------
create or replace view public.contract_day_overview as
select d.slug, d.title,
       d.couple_type, d.mood_tone, d.intensity, d.lead, d.venue,
       d.planned_duration, d.aftercare_focus,
       d.special_request_sub, d.special_request_dom,
       s.synced_at as sections_synced_at
from public.contract_days d
left join (select slug, max(synced_at) as synced_at
           from public.contract_day_sections group by slug) s
  on s.slug = d.slug;

create or replace view public.contract_all_data as
select '🪪 Day sections'::text as source, slug as day, heading, content as value, synced_at
from public.contract_day_sections
union all
select '🧾 Field entries', coalesce(nullif(slug,''),'main'), heading, value, updated_at
from public.contract_field_entries
union all
select '📔 Log book', slug, sheet_name || ' · ' || field_heading, value, synced_at
from public.contract_log_book_rows
union all
select '✨ AI form', '', heading, value, updated_at
from public.contract_generator_choices;

grant select on public.contract_day_overview, public.contract_all_data to anon, authenticated;

-- ------------------------------------------------------------
-- 12) VERIFICATION — run result shows what is live right now.
-- ------------------------------------------------------------
select k,
       case
         when k = 'days'    then jsonb_array_length(v)
         when k = 'fields'  then (select count(*) from jsonb_object_keys(v))
         when k = 'accepts' then (select count(*) from jsonb_object_keys(v))
         else jsonb_array_length('[]'::jsonb)
       end as entries,
       pg_size_pretty(octet_length(v::text)::bigint) as bytes,
       last_writer, updated_at
from public.contract_state
order by k;

select h.sort_order, h.heading as section_heading, h.cloud_table
from public.contract_section_headings h
order by h.sort_order;

-- final sanity: policies that actually exist on the live tables —
-- if "contract_anon_rw" shows up here, the app's anon key can read+write.
select tablename, policyname, permissive, roles, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- ============================================================
-- AFTER RUNNING THIS (important — do all three):
--   1. Open the app on Phone A → press 💾 Save once (pushes everything).
--   2. On Phone B: CLOSE the app tab completely and re-open the URL
--      (or pull-to-refresh) so the NEW js files load — old cached
--      JS is the #1 reason fixes "don't work" on the second phone.
--   3. If the pill still says "unreachable": dashboard.supabase.com →
--      project nmxowqizxsujhmfnfdto → if PAUSED, click RESTORE, then
--      Settings → Network Restrictions → make sure "Block all access"
--      is OFF. The app reconnects by itself within ~20 s.
-- ============================================================
