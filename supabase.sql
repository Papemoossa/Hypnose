-- RELAX MIND — à exécuter une seule fois dans Supabase (SQL Editor)
create table if not exists public.rm_uploads (
  id          uuid primary key default gen_random_uuid(),
  pid         text not null,
  fp          text,
  n_events    int,
  n_done      int,
  app         text,
  payload     jsonb not null,   -- contenu chiffré : illisible par le serveur
  created_at  timestamptz not null default now()
);

create index if not exists rm_uploads_pid_idx on public.rm_uploads (pid, created_at desc);

alter table public.rm_uploads enable row level security;

-- La clé anonyme embarquée dans l'application ne peut QU'INSÉRER :
-- aucune lecture, aucune modification, aucune suppression ne lui est permise.
drop policy if exists rm_insert_only on public.rm_uploads;
create policy rm_insert_only on public.rm_uploads
  for insert to anon with check (
    length(pid) between 1 and 64
    and pg_column_size(payload) < 200000
  );

-- Facultatif : purge automatique des envois de plus de 18 mois
-- delete from public.rm_uploads where created_at < now() - interval '18 months';
