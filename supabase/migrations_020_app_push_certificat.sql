-- 020 — Application installable : notifications push, guide d'installation, rappel la veille, certificat de membre

-- Abonnements aux notifications push (un par appareil)
create table if not exists public.push_abonnements (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique check (char_length(endpoint) < 1000 and endpoint like 'https://%'),
  p256dh     text not null check (char_length(p256dh) < 200),
  auth       text not null check (char_length(auth) < 100),
  appareil   text not null default '' check (char_length(appareil) < 200),
  created_at timestamptz not null default now()
);
create index if not exists push_abonnements_user on public.push_abonnements (user_id);
alter table public.push_abonnements enable row level security;
drop policy if exists "push: lire les siens" on public.push_abonnements;
create policy "push: lire les siens" on public.push_abonnements for select to authenticated using (user_id = auth.uid());
drop policy if exists "push: s'abonner" on public.push_abonnements;
create policy "push: s'abonner" on public.push_abonnements for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "push: se désabonner" on public.push_abonnements;
create policy "push: se désabonner" on public.push_abonnements for delete to authenticated using (user_id = auth.uid());

-- Guide d'installation : envoyé une fois, à la première connexion ; les comptes existants sont considérés comme servis
alter table public.profiles add column if not exists guide_envoye_at timestamptz;
update public.profiles set guide_envoye_at = now() where guide_envoye_at is null;

-- Rappel la veille d'une séance (une seule fois par séance)
alter table public.events add column if not exists rappel_veille_at timestamptz;

-- Certificat de membre : code unique imprimé sur le certificat, vérifiable en ligne
alter table public.profiles add column if not exists certificat_code text unique;
update public.profiles set certificat_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)) where certificat_code is null;
alter table public.profiles alter column certificat_code set default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

create or replace function public.mon_certificat()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('prenom', p.prenom, 'nom', p.nom, 'classe', p.classe, 'membre_depuis', p.created_at, 'code', p.certificat_code, 'poste', p.poste,
    'seances', (select count(*) from public.presences pr where pr.user_id = p.id and pr.statut = 'present'),
    'president', (select json_build_object('prenom', b.prenom, 'nom', b.nom) from public.profiles b where b.poste ilike 'Président%' and not coalesce(b.banni, false) limit 1))
  from public.profiles p where p.id = auth.uid() and not coalesce(p.banni, false);
$$;

-- Vérification publique d'un certificat à partir de son code (ne révèle que ce qui est imprimé dessus)
create or replace function public.verifier_certificat(p_code text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('prenom', p.prenom, 'nom', p.nom, 'classe', p.classe, 'membre_depuis', p.created_at, 'actif', not coalesce(p.banni, false))
  from public.profiles p where p.certificat_code = upper(trim(p_code)) and char_length(trim(p_code)) = 10;
$$;

revoke all on function public.mon_certificat(), public.verifier_certificat(text) from public;
grant execute on function public.mon_certificat() to authenticated;
grant execute on function public.verifier_certificat(text) to anon, authenticated;

-- Un membre ne peut pas non plus modifier son code de certificat ni la date d'envoi du guide
drop policy if exists "profil: modification soi-même" on public.profiles;
create policy "profil: modification soi-même" on public.profiles for update using (auth.uid() = id)
  with check (auth.uid() = id
    and role  = (select role  from public.profiles where id = auth.uid())
    and banni = (select banni from public.profiles where id = auth.uid())
    and poste is not distinct from (select poste from public.profiles where id = auth.uid())
    and absences_depuis is not distinct from (select absences_depuis from public.profiles where id = auth.uid())
    and certificat_code is not distinct from (select certificat_code from public.profiles where id = auth.uid())
    and guide_envoye_at is not distinct from (select guide_envoye_at from public.profiles where id = auth.uid()));

-- Enregistre l'abonnement push de cet appareil pour l'utilisateur connecté (remplace un éventuel abonnement précédent du même appareil)
create or replace function public.push_enregistrer(p_endpoint text, p_p256dh text, p_auth text, p_appareil text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'non_connecte'; end if;
  delete from public.push_abonnements where endpoint = p_endpoint;
  insert into public.push_abonnements (user_id, endpoint, p256dh, auth, appareil) values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_appareil, ''), 190));
end $$;
revoke all on function public.push_enregistrer(text, text, text, text) from public, anon;
grant execute on function public.push_enregistrer(text, text, text, text) to authenticated;
