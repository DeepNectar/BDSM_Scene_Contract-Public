-- ============================================================
-- Deep & Honey · Eternal Contract — FULL RESET SQL (v4.13c DH)
-- Project: qbnxcfwwsuqfmearyris (https://qbnxcfwwsuqfmearyris.supabase.co)
--
-- ⚠️ THIS SCRIPT CLEARS ALL PREVIOUS DATA AND RECREATES EVERYTHING.
--    Every saved affidavit field, signature and day section stored in
--    Supabase will be permanently deleted when you run this.
--    (Local browser copies on each device self-heal: the next pull
--     from the empty cloud store overwrites them. To wipe a device's
--     local copy too, open the app once after running this script.)
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Paste all → Run.
-- Safe to re-run any time — it always resets to a clean state.
--
-- What the app (js/cloud.js v4.13c) stores after this reset:
--   'fields'  → ALL text entries of the Pre-Scene Execution Affidavit
--   'accepts' → signature / acceptance ("I accept") data
--   'days'    → full HTML of EVERY day section created (blank ➕ / ✨ AI)
--   'deleted' → tombstones of permanently deleted days
-- ============================================================

-- ------------------------------------------------------------
-- 0) CLEAN SLATE — remove old objects first (idempotent)
--    NOTE: we never drop the built-in "supabase_realtime" publication
--    itself (Supabase manages it); we only remove our table from it
--    and re-add it later. This avoids permission errors.
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

drop table if exists public.contract_state;

-- ------------------------------------------------------------
-- 1) THE STATE TABLE (key/value JSONB store) — recreated fresh
-- ------------------------------------------------------------
create table public.contract_state (
  k           text primary key,               -- 'fields' | 'accepts' | 'days' | 'deleted'
  v           jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  last_writer text        not null default 'unknown'
);

comment on table  public.contract_state is
  'Deep & Honey contract cloud store: affidavit fields+signatures and all created day sections.';
comment on column public.contract_state.created_at is
  'First time this state key was written by any device.';
comment on column public.contract_state.last_writer is
  'Opaque tag of the device that wrote this key last (cross-device sync audit).';

-- ------------------------------------------------------------
-- 2) AUTO-REFRESH updated_at ON EVERY WRITE
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger contract_state_touch
  before update on public.contract_state
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 3) SECURITY — RLS enabled with one permissive policy
--    (the app has its own password gate; the anon key can read/write)
-- ------------------------------------------------------------
alter table public.contract_state enable row level security;

create policy "contract rw"
  on public.contract_state
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- ------------------------------------------------------------
-- 4) REALTIME — instant multi-device sync
--    Add our (freshly recreated) table to the built-in Supabase
--    realtime publication. Created defensively if it is missing.
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.contract_state;

-- complete payloads for realtime listeners
alter table public.contract_state replica identity full;

-- ------------------------------------------------------------
-- 5) GRANTS — make sure the API roles can use the table
-- ------------------------------------------------------------
grant usage                  on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.contract_state to anon, authenticated;
grant all                    on public.contract_state to service_role;

-- ------------------------------------------------------------
-- 6) SANITY CHECK — runs green, returns 0 rows right after reset
-- ------------------------------------------------------------
select k,
       length(v::text) as bytes,
       updated_at,
       created_at,
       last_writer
from   public.contract_state
order  by updated_at desc;

-- ============================================================
-- ✅ DONE — clean slate ready for cross-device sync:
--    • Open the app → fill the Pre-Scene Execution Affidavit
--    • Create day sections (➕ blank / ✨ AI)
--    • Press SAVE → status shows "☁️ Connected · synced Xs ago"
--    • Open the same URL on any other device → everything appears
--      within ~1 second via realtime.
--
--    Synced automatically on every SAVE:
--      – affidavit fields (all inputs/textareas)
--      – signatures / acceptances
--      – every created day (blank & AI), including checklists
--      – permanent deletions (tombstones) so deleted days stay gone
-- ============================================================
