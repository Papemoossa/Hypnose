-- ============================================================================
-- RELAX MIND — table de collecte des séances
-- À exécuter une seule fois dans Supabase : SQL Editor → coller → Run.
-- ============================================================================

create table if not exists public.rm_seances (
  id              bigint generated always as identity primary key,
  ref             text unique,                  -- identifiant de la séance côté téléphone
  pid             text not null,                -- identifiant de l'enquête T0
  groupe          text,
  seance_id       int  not null check (seance_id between 1 and 60),
  titre           text,
  debut           timestamptz,
  fin             timestamptz not null default now(),
  duree_sec       int  not null default 0 check (duree_sec between 0 and 36000),
  detente_avant   smallint check (detente_avant between 0 and 10),
  detente_apres   smallint check (detente_apres between 0 and 10),
  qualite_texte   smallint check (qualite_texte between 1 and 10),
  remarque        text check (char_length(remarque) <= 2000),
  app             text,
  cree_le         timestamptz not null default now()
);

create index if not exists rm_seances_pid_idx on public.rm_seances (pid, seance_id);
create index if not exists rm_seances_fin_idx on public.rm_seances (fin desc);

alter table public.rm_seances enable row level security;

-- L'application embarque la clé « anon ». On ne lui accorde que le dépôt
-- de nouvelles séances : ni lecture, ni modification, ni suppression.
drop policy if exists rm_depot on public.rm_seances;
create policy rm_depot on public.rm_seances
  for insert to anon
  with check (
    length(pid) between 1 and 64
    and seance_id between 1 and 60
    and duree_sec between 0 and 36000
  );

-- Pour que le bouton « Récupérer les données du serveur » fonctionne dans
-- l'espace administrateur, décommentez la ligne suivante : elle autorise la
-- lecture. Ne le faites que si vous acceptez que la clé anon permette de lire
-- les données — sinon, exportez depuis le tableau de bord Supabase.
-- create policy rm_lecture on public.rm_seances for select to anon using (true);

-- Vue de synthèse, prête pour le mémoire
create or replace view public.rm_synthese as
  select seance_id,
         min(titre)                                                  as titre,
         count(*)                                                    as ecoutes,
         count(distinct pid)                                         as participantes,
         round(avg(detente_avant)::numeric, 2)                       as detente_avant_moy,
         round(avg(detente_apres)::numeric, 2)                       as detente_apres_moy,
         round(avg(detente_apres - detente_avant)::numeric, 2)       as gain_moyen,
         round(avg(qualite_texte)::numeric, 2)                       as qualite_texte_moy,
         round(avg(duree_sec) / 60.0)                                as duree_moy_min
    from public.rm_seances
   group by seance_id
   order by seance_id;
