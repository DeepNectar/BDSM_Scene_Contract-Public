/* ============================================================
   Supabase configuration — v1.9 DH
   ------------------------------------------------------------
   1. Create a project at https://supabase.com
   2. Project settings → API → copy the two values below.
   3. Run this SQL once (SQL Editor) to create the store table:

     create table if not exists contract_state (
       k text primary key,
       v jsonb not null,
       updated_at timestamptz default now()
     );
     alter table contract_state enable row level security;
     create policy "contract rw" on contract_state
       for all using (true) with check (true);

   NOTE: RLS here is open by design (this private contract is
   protected by its own password gate). For extra safety, tighten
   the policy or add an auth anon key of your own.
   ============================================================ */
window.SUPABASE_CONFIG = {
  url: 'https://qbnxcfwwsuqfmearyris.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFibnhjZnd3c3VxZm1lYXJ5cmlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0MzI0NDEsImV4cCI6MjEwNzAwODQ0MX0.dP_Ip49NkOMxqn-lE15cOlR6EwJw4yB5dFLJYxBumPE',
};
