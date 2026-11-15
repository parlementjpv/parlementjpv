-- 018 — Annonce par email de l'ouverture d'un vote (une seule fois par élection)
alter table public.elections add column if not exists annonce_envoyee_at timestamptz;
