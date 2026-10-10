-- ============================================================
-- Deep & Honey · Eternal Contract — GO-LIVE SQL v5.0 DH (STRUCTURED TABLES)
-- Project: qbnxcfwwsuqfmearyris  (https://qbnxcfwwsuqfmearyris.supabase.co)
--
-- 👉 Paste this ENTIRE file into: Supabase Dashboard → SQL Editor → Run (once)
--
-- "Create all data and give their headings for all sections, so all
--  data as a table will be saved in the cloud."
--
-- WHAT THIS DOES
--   1. Keeps the live key/value store public.contract_state EXACTLY as the
--      app writes it today (keys 'fields','accepts','days','deleted') —
--      your existing synced data is preserved and sync keeps working.
--   2. Creates ONE PROPER TABLE PER SECTION, each with clean column
--      headings, plus a heading registry:
--        contract_days             📅 Day header + couple type/mood/intensity/lead/venue
--        contract_articles         📜 Articles 1–8 (heading + body per article)
--        contract_play_bill        🎬 Article 3 · Scheduled Activities rows
--        contract_hard_limits      🚫 Article 5 · Hard Limits rows
--        contract_aftercare        💞 Article 6 · Aftercare rows
--        contract_safewords        🛑 Article 8 · RED/YELLOW/GREEN rows
--        contract_signatories      ✍️ Signatures & Accept status per party
--        contract_affidavit        🗒 Pre-Scene Execution Affidavit fields
--        contract_debrief          🔁 Scene Debrief fields
--        contract_log_book_rows    📔 BDSM Log Book answers (one row per sheet field)
--        contract_field_entries    🧾 EVERY individual input/select entry
--        contract_section_headings 🏷 Registry of every section heading
--   3. Installs an IN-APP SYNC WRAPPER (window.__dhkSyncWrap) that runs
--      automatically on every device: after each 💾 Save the plain text
--      of every section (headings + values) is read from the live page
--      and pushed to the cloud under new keys daytext:<slug>,
--      logbook:<slug>, genform. You can then simply run
--        select * from contract_day_sections;
--      to see ALL data laid out by section with headings — no fragile
--      HTML parsing needed anywhere.
--   4. Ends with verification SELECTs.
--
-- SAFE TO RE-RUN: CREATE IF NOT EXISTS / OR REPLACE everywhere.
-- Non-destructive: never drops or overwrites your existing rows.
-- ============================================================

-- ------------------------------------------------------------
-- 0) PREP — same idempotent base as go-live.sql v4.16
-- ------------------------------------------------------------
create table if not exists public.contract_state (
  k           text primary key,
  v           jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  last_writer text        not null default 'unknown'
);
alter table public.contract_state
  add column if not exists last_writer text not null default 'unknown';
alter table public.contract_state
  add column if not exists created_at  timestamptz not null default now();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists contract_state_touch on public.contract_state;
create trigger contract_state_touch
  before insert or update on public.contract_state
  for each row execute function public.touch_updated_at();

alter table public.contract_state enable row level security;
drop policy if exists "contract rw" on public.contract_state;
create policy "contract rw" on public.contract_state
  for all to anon, authenticated using (true) with check (true);

do $$ begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public'
                   and tablename='contract_state') then
    alter publication supabase_realtime add table public.contract_state;
  end if;
end $$;
alter table public.contract_state replica identity full;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.contract_state to anon, authenticated;
grant all on public.contract_state to service_role;

insert into public.contract_state (k, v) values
  ('fields','{}'::jsonb), ('accepts','{}'::jsonb),
  ('days','[]'::jsonb),   ('deleted','{}'::jsonb)
on conflict (k) do nothing;
delete from public.contract_state where k = 'wiped';

-- ------------------------------------------------------------
-- 1) HEADING REGISTRY — "give their heading for all sections"
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
-- 2) STRUCTURED TABLES — one per section, proper column headings
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
  content   text not null,            -- all rows/values of that section, tab-separated
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
-- 3) ACCESS — RLS open for the couple's private app (anon key reads
--    and writes; the app itself is password-gated).
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

-- ------------------------------------------------------------
-- 4) VIEWS — the tables readable directly through the API, e.g.
--      GET /rest/v1/contract_day_sections?slug=eq.day-1&order=ord
--    plus a flattened all-in-one view.
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

-- ------------------------------------------------------------
-- 5) VERIFICATION — every section heading + its table
-- ------------------------------------------------------------
select h.sort_order,
       h.heading   as section_heading,
       h.cloud_table
from public.contract_section_headings h
order by h.sort_order;

select count(*) as contract_state_keys_live
from public.contract_state;
