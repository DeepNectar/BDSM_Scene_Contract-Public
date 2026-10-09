-- ============================================================
-- Deep & Honey · Eternal Contract — COMPLETE go-live SQL
-- Project: qbnxcfwwsuqfmearyris  (https://qbnxcfwwsuqfmearyris.supabase.co)
-- Run this ONCE in Supabase Dashboard → SQL Editor → New query → Run.
-- Safe to re-run any time (idempotent). No data is deleted on re-run.
--
-- What gets saved here by the app (js/cloud.js v3.9):
--   'fields'  → ALL text entries of the Pre-Scene Execution Affidavit
--               (names, dates, places, vows, every input/textarea)
--   'accepts' → signature / acceptance ("I accept") data of the affidavit
--   'days'    → full HTML of EVERY day section created during a session
--               (blank ➕ days and ✨ AI-written days alike)
--   'wiped'   → flag remembering that days were cleared
-- ============================================================

-- ------------------------------------------------------------
-- 1) THE STATE TABLE (key/value JSONB store)
-- ------------------------------------------------------------
create table if not exists public.contract_state (
  k          text primary key,              -- 'fields' | 'accepts' | 'days' | 'wiped'
  v          jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.contract_state is
  'Deep & Honey contract cloud store: affidavit fields+signatures and all created day sections.';

-- ------------------------------------------------------------
-- 2) AUTO-REFRESH updated_at ON EVERY WRITE
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists contract_state_touch on public.contract_state;
create trigger contract_state_touch
  before update on public.contract_state
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 3) SECURITY — RLS enabled with one permissive policy
--    (the app has its own password gate; the anon key can read/write)
-- ------------------------------------------------------------
alter table public.contract_state enable row level security;

drop policy if exists "contract rw" on public.contract_state;
create policy "contract rw"
  on public.contract_state
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- ------------------------------------------------------------
-- 4) REALTIME — instant multi-device sync (v3.8+ feature)
--    Without this, saves still work but other devices only sync
--    on refresh/focus. This block creates the publication if needed
--    and adds the table exactly once.
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- add table only if not already a member (avoids "already published" error)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'contract_state'
  ) then
    alter publication supabase_realtime add table public.contract_state;
  end if;
end $$;

-- ensure the table's replica identity is FULL so realtime payloads are complete
alter table public.contract_state replica identity full;

-- ------------------------------------------------------------
-- 5) GRANTS — make sure the API roles can use the table
-- ------------------------------------------------------------
grant usage        on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.contract_state to anon, authenticated;
grant all          on public.contract_state to service_role;

-- ------------------------------------------------------------
-- 6) SANITY CHECK — should run without errors (0 rows is fine
--    until you first save in the app)
-- ------------------------------------------------------------
select k,
       length(v::text)  as bytes,
       updated_at
from   public.contract_state
order  by updated_at desc;

-- ============================================================
-- ✅ If the query above runs green, you are GO LIVE:
--    • Open the app → fill the Pre-Scene Execution Affidavit
--    • Create day sections (➕ blank / ✨ AI)
--    • Press SAVE → status shows "☁️ Connected · synced Xs ago"
--    • Open the same URL on the second device → everything
--      appears within ~1 second via realtime.
-- ============================================================
