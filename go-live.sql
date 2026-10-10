-- ============================================================
-- Deep & Honey · Eternal Contract — GO-LIVE SQL (v4.14 DH)
-- Project: qbnxcfwwsuqfmearyris (https://qbnxcfwwsuqfmearyris.supabase.co)
--
-- 👉 Paste this ENTIRE file into:
--      Supabase Dashboard → SQL Editor → New query → Run
--
-- WHAT THIS DOES — every piece of data the app creates is stored in
-- the cloud table public.contract_state, keyed exactly as js/cloud.js
-- and js/app.js read/write it:
--
--   'fields'   → EVERY text entry across the whole contract, including
--                all Pre-Scene Execution Affidavit inputs/textareas AND
--                every 📔 BDSM Log Book pre-scene form input inside the
--                affidavit (v4.15: app.js wires those forms before each
--                collection so their values ride along to the cloud)
--   'accepts'  → signature / acceptance ("I accept") data per area+party
--   'days'     → FULL HTML of EVERY day section created on any device
--                (➕ blank day / ✨ AI-written day) — no hardcoded days;
--                whatever you create becomes the cloud's source of truth.
--                Because the saved HTML contains the entire day page, the
--                affidavit AND its embedded 📔 Log Book block come back
--                intact on every device and after every re-login.
--   'deleted'  → timestamped tombstones so a ✖ deleted day stays gone
--                on BOTH devices forever
--
-- NOTE ON THE LOG BOOK SITE: the pre-scene entries are ALSO pushed (on 💾
-- Save / 📤 Send) into the Log Book's own existing Supabase project
-- `sjaxgxsvtldcgvunzeye`, table public.log_book_data (sheet_name PK,
-- html_content, updated_at). That table already exists with RLS + grants
-- from the Log Book site itself — NO SQL changes are needed here for it,
-- and this script deliberately does not touch that other project.
--
-- This script is NON-DESTRUCTIVE (it never drops existing data):
--   • safe to run repeatedly — "create if missing" everywhere
--   • upgrades an older store in place: adds the last_writer audit
--     column, re-enables RLS/realtime, backfills timestamps
--   • ends with a verification SELECT showing exactly what is live
--
-- After running: open the app → fill/create anything → press 💾 Save.
-- Status pill shows "☁️ Connected · synced just now". Open the same
-- URL on the other device → everything appears within ~1 second via
-- realtime. Created days now also come back after re-login because
-- they are stored here, not hardcoded.
-- ============================================================

-- ------------------------------------------------------------
-- 0) IDEMPOTENT PREP — remove ONLY our own old objects from a
--    previous partial run. We NEVER drop the table itself, so
--    already-synced affidavit entries and created days survive.
--    (The built-in "supabase_realtime" publication is managed by
--     Supabase — we only detach/reattach our table from it.)
-- ------------------------------------------------------------
drop trigger   if exists contract_state_touch on public.contract_state;
drop function  if exists public.touch_updated_at();
drop policy    if exists "contract rw" on public.contract_state;

do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime'
               and schemaname = 'public'
               and tablename  = 'contract_state') then
    execute 'alter publication supabase_realtime drop table public.contract_state';
  end if;
end $$;

-- ------------------------------------------------------------
-- 1) THE CLOUD STATE TABLE (key/value JSONB store)
--    Created only if it does not exist yet — existing rows kept.
-- ------------------------------------------------------------
create table if not exists public.contract_state (
  k           text primary key,               -- 'fields' | 'accepts' | 'days' | 'deleted'
  v           jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  last_writer text        not null default 'unknown'
);

comment on table  public.contract_state is
  'Deep & Honey contract cloud store: affidavit fields + signatures + every created day section + deletion tombstones.';
comment on column public.contract_state.created_at is
  'First time this state key was written by any device.';
comment on column public.contract_state.last_writer is
  'Opaque tag of the device that wrote this key last (cross-device sync audit).';

-- upgrade an older table (pre last_writer / pre created_at) in place
alter table public.contract_state
  add column if not exists last_writer text not null default 'unknown';
alter table public.contract_state
  add column if not exists created_at  timestamptz not null default now();

-- ------------------------------------------------------------
-- 2) AUTO-REFRESH updated_at ON EVERY WRITE (insert AND update)
--    The app's LAST-WRITER-WINS merge falls back to updated_at for
--    payloads without an internal __ts stamp, so both events matter.
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger contract_state_touch
  before insert or update on public.contract_state
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 3) SECURITY — RLS enabled with one permissive policy.
--    (The app has its own password gate; the anon key reads/writes.)
-- ------------------------------------------------------------
alter table public.contract_state enable row level security;

create policy "contract rw"
  on public.contract_state
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- ------------------------------------------------------------
-- 4) REALTIME — instant multi-device sync.
--    Add our table to the built-in Supabase realtime publication
--    (created defensively if somehow missing), with complete
--    payloads so listeners receive the full new value.
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.contract_state;

alter table public.contract_state replica identity full;

-- ------------------------------------------------------------
-- 5) GRANTS — make sure the API roles can use the table
-- ------------------------------------------------------------
grant usage                        on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.contract_state to anon, authenticated;
grant all                          on public.contract_state to service_role;

-- ------------------------------------------------------------
-- 6) OPTIONAL SEED — pre-create the four state keys so the table
--    is visibly ready the moment you open the SQL editor.
--    ON CONFLICT DO NOTHING ⇒ this NEVER overwrites data your
--    devices have already synced. Safe either way; the app
--    self-heals empty/missing keys on the first pull anyway.
-- ------------------------------------------------------------
insert into public.contract_state (k, v) values
  ('fields',  '{}'::jsonb),          -- affidavit + every text entry
  ('accepts', '{}'::jsonb),          -- signatures / acceptances
  ('days',    '[]'::jsonb),          -- every created day page (HTML)
  ('deleted', '{}'::jsonb)           -- permanent deletion tombstones
on conflict (k) do nothing;

-- drop the DEAD legacy key entirely: since v4.0 the app never honours a
-- sticky 'wiped' flag any more (it was the "auto wipe on login" bug), so
-- the leftover row is removed for good — fully in line with "remove all
-- hardcode": the cloud now contains ONLY the four live keys below.
delete from public.contract_state where k = 'wiped';

-- ------------------------------------------------------------
-- 7) VERIFICATION — run result shows what is live right now.
--    Expect up to 4 rows; bytes > 0 means real data is stored.
-- ------------------------------------------------------------
select k,
       case
         when k = 'days'    then jsonb_array_length(v)
         when k = 'fields'  then (select count(*) from jsonb_object_keys(v))
         when k = 'accepts' then (select count(*) from jsonb_object_keys(v))
         else (select count(*) from jsonb_object_keys(v))
       end                            as entries,
       length(v::text)                 as bytes,
       updated_at,
       created_at,
       last_writer
from   public.contract_state
order  by updated_at desc;

-- ============================================================
-- ✅ GO-LIVE COMPLETE — cloud is the single source of truth:
--    • No day is hardcoded anywhere (index.html ships zero day
--      pages); every day you create is stored under 'days' and
--      comes back on ANY device after re-login/reload.
--    • Every affidavit field, signature and checklist lands in
--      the cloud automatically on 💾 Save, on tab close, and on
--      background switch (js/cloud.js flush + heartbeat).
--    • Deletions propagate as tombstones under 'deleted' and
--      stick permanently on both devices.
--    • Realtime pushes the other device's saves within ~1 s.
--
--    To start fresh at any time (wipes ALL cloud data), run:
--      truncate public.contract_state;
--      insert into public.contract_state (k, v) values
--        ('fields','{}'),('accepts','{}'),('days','[]'),('deleted','{}');
-- ============================================================
