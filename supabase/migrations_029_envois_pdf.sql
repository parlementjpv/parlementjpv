-- 029 — Plus de téléchargement direct : chaque document est envoyé par email (ZIP chiffré) à l'adresse du Parlement.
alter table public.archives_pdf add column if not exists libelle text;
alter table public.archives_pdf add column if not exists demande_par text;
grant select (libelle, demande_par) on public.archives_pdf to authenticated;
