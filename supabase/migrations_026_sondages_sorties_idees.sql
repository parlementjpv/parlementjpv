-- 026 — Sondages rapides, sorties et visites, boîte à idées anonyme, contact d'un membre du bureau

-- ── Sondages ──
create table if not exists public.sondages (
  id         uuid primary key default gen_random_uuid(),
  question   text not null check (char_length(question) between 3 and 200),
  options    text[] not null check (cardinality(options) between 2 and 8),
  multiple   boolean not null default false,
  fin        timestamptz,
  clos       boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.sondage_reponses (
  sondage    uuid not null references public.sondages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  choix      int[] not null,
  created_at timestamptz not null default now(),
  primary key (sondage, user_id)
);
alter table public.sondages enable row level security;
alter table public.sondage_reponses enable row level security;
drop policy if exists "sondages: bureau gère" on public.sondages;
create policy "sondages: bureau gère" on public.sondages for all to authenticated using (public.is_bureau()) with check (public.is_bureau());

-- Résultats agrégés uniquement (personne ne voit qui a répondu quoi)
create or replace function public.sondages_liste()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'id', s.id, 'question', s.question, 'options', s.options, 'multiple', s.multiple, 'fin', s.fin, 'created_at', s.created_at,
    'ouvert', not s.clos and (s.fin is null or s.fin > now()),
    'votants', (select count(*) from public.sondage_reponses r where r.sondage = s.id),
    'compte', (select coalesce(json_agg(n order by i), '[]') from (select i, (select count(*) from public.sondage_reponses r where r.sondage = s.id and i = any(r.choix)) n from generate_series(0, cardinality(s.options) - 1) i) x),
    'mon_choix', (select r.choix from public.sondage_reponses r where r.sondage = s.id and r.user_id = auth.uid())
  ) order by (not s.clos and (s.fin is null or s.fin > now())) desc, s.created_at desc), '[]')
  from public.sondages s where (public.est_membre() or public.is_bureau()) and s.created_at > now() - interval '1 year';
$$;

create or replace function public.repondre_sondage(p_sondage uuid, p_choix int[])
returns void language plpgsql security definer set search_path = public as $$
declare s public.sondages;
begin
  if not public.est_membre() then raise exception 'reserve_aux_membres'; end if;
  select * into s from public.sondages where id = p_sondage;
  if not found then raise exception 'introuvable'; end if;
  if s.clos or (s.fin is not null and s.fin <= now()) then raise exception 'sondage_clos'; end if;
  if cardinality(p_choix) = 0 or (not s.multiple and cardinality(p_choix) > 1)
     or exists (select 1 from unnest(p_choix) c where c < 0 or c >= cardinality(s.options)) then raise exception 'choix_invalide'; end if;
  insert into public.sondage_reponses (sondage, user_id, choix) values (p_sondage, auth.uid(), (select array_agg(distinct c order by c) from unnest(p_choix) c))
  on conflict (sondage, user_id) do update set choix = excluded.choix, created_at = now();
end $$;

-- ── Sorties et visites ──
create table if not exists public.sorties (
  id           uuid primary key default gen_random_uuid(),
  titre        text not null check (char_length(titre) between 3 and 150),
  description  text not null default '' check (char_length(description) <= 3000),
  lieu         text not null default '' check (char_length(lieu) <= 200),
  quand        timestamptz not null,
  retour       text not null default '' check (char_length(retour) <= 120),
  rdv          text not null default '' check (char_length(rdv) <= 200),
  places       int check (places is null or places between 1 and 500),
  autorisation boolean not null default true,
  limite       timestamptz,
  annule_at    timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create table if not exists public.sortie_inscrits (
  sortie        uuid not null references public.sorties(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  statut        text not null check (statut in ('inscrit', 'attente')),
  autorisation_recue boolean not null default false,
  promu_at      timestamptz,
  created_at    timestamptz not null default now(),
  primary key (sortie, user_id)
);
alter table public.sorties enable row level security;
alter table public.sortie_inscrits enable row level security;
drop policy if exists "sorties: bureau gère" on public.sorties;
create policy "sorties: bureau gère" on public.sorties for all to authenticated using (public.is_bureau()) with check (public.is_bureau());
drop policy if exists "sortie inscrits: bureau lit et coche" on public.sortie_inscrits;
create policy "sortie inscrits: bureau lit et coche" on public.sortie_inscrits for select to authenticated using (public.is_bureau());
drop policy if exists "sortie inscrits: bureau coche" on public.sortie_inscrits;
create policy "sortie inscrits: bureau coche" on public.sortie_inscrits for update to authenticated using (public.is_bureau()) with check (public.is_bureau());

create or replace function public.sorties_liste()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'id', s.id, 'titre', s.titre, 'description', s.description, 'lieu', s.lieu, 'quand', s.quand, 'retour', s.retour, 'rdv', s.rdv,
    'places', s.places, 'autorisation', s.autorisation, 'limite', s.limite, 'annule', s.annule_at is not null,
    'inscrits', (select count(*) from public.sortie_inscrits i where i.sortie = s.id and i.statut = 'inscrit'),
    'attente', (select count(*) from public.sortie_inscrits i where i.sortie = s.id and i.statut = 'attente'),
    'mon_statut', (select i.statut from public.sortie_inscrits i where i.sortie = s.id and i.user_id = auth.uid()),
    'ma_position', (select count(*) + 1 from public.sortie_inscrits i, public.sortie_inscrits m where m.sortie = s.id and m.user_id = auth.uid() and m.statut = 'attente' and i.sortie = s.id and i.statut = 'attente' and i.created_at < m.created_at),
    'mon_autorisation', (select i.autorisation_recue from public.sortie_inscrits i where i.sortie = s.id and i.user_id = auth.uid()),
    'liste', case when public.is_bureau() then coalesce((select json_agg(json_build_object('id', p.id, 'nom', p.prenom || ' ' || p.nom, 'classe', p.classe, 'statut', i.statut, 'autorisation', i.autorisation_recue) order by i.statut, i.created_at)
               from public.sortie_inscrits i join public.profiles p on p.id = i.user_id where i.sortie = s.id), '[]') end
  ) order by (s.quand < now()), s.quand), '[]')
  from public.sorties s where (public.est_membre() or public.is_bureau()) and s.quand > now() - interval '60 days';
$$;

-- Inscription / désinscription avec liste d'attente ; renvoie l'id de la personne promue s'il y en a une
create or replace function public.sortie_inscription(p_sortie uuid, p_inscrire boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare s public.sorties; n int; promu uuid; etait text;
begin
  if not public.est_membre() then raise exception 'reserve_aux_membres'; end if;
  select * into s from public.sorties where id = p_sortie for update;
  if not found then raise exception 'introuvable'; end if;
  if s.annule_at is not null then raise exception 'annulee'; end if;
  if s.quand < now() then raise exception 'passee'; end if;
  if p_inscrire then
    if s.limite is not null and s.limite < now() then raise exception 'inscriptions_closes'; end if;
    select count(*) into n from public.sortie_inscrits where sortie = p_sortie and statut = 'inscrit';
    insert into public.sortie_inscrits (sortie, user_id, statut) values (p_sortie, auth.uid(), case when s.places is null or n < s.places then 'inscrit' else 'attente' end)
    on conflict do nothing;
    return null;
  end if;
  delete from public.sortie_inscrits where sortie = p_sortie and user_id = auth.uid() returning statut into etait;
  if etait = 'inscrit' and s.places is not null then
    select user_id into promu from public.sortie_inscrits where sortie = p_sortie and statut = 'attente' order by created_at limit 1;
    if promu is not null then update public.sortie_inscrits set statut = 'inscrit', promu_at = now() where sortie = p_sortie and user_id = promu; end if;
  end if;
  return promu;
end $$;

-- ── Boîte à idées anonyme (aucun lien avec l'auteur n'est enregistré) ──
create table if not exists public.idees (
  id         uuid primary key default gen_random_uuid(),
  texte      text not null check (char_length(texte) between 5 and 2000),
  categorie  text not null default 'Idée' check (categorie in ('Idée', 'Sujet de débat', 'Problème', 'Autre')),
  statut     text not null default 'nouvelle' check (statut in ('nouvelle', 'lue', 'retenue', 'archivee')),
  reponse    text check (reponse is null or char_length(reponse) <= 1000),
  created_at timestamptz not null default date_trunc('day', now())
);
create table if not exists public.idees_quota (user_id uuid not null, jour date not null, n int not null default 0, primary key (user_id, jour));
alter table public.idees enable row level security;
alter table public.idees_quota enable row level security;
drop policy if exists "idées: bureau lit et traite" on public.idees;
create policy "idées: bureau lit et traite" on public.idees for select to authenticated using (public.is_bureau());
drop policy if exists "idées: bureau traite" on public.idees;
create policy "idées: bureau traite" on public.idees for update to authenticated using (public.is_bureau()) with check (public.is_bureau());
drop policy if exists "idées: bureau supprime" on public.idees;
create policy "idées: bureau supprime" on public.idees for delete to authenticated using (public.is_bureau());

create or replace function public.deposer_idee(p_texte text, p_categorie text)
returns void language plpgsql security definer set search_path = public as $$
declare q int;
begin
  if not public.est_membre() then raise exception 'reserve_aux_membres'; end if;
  insert into public.idees_quota (user_id, jour, n) values (auth.uid(), current_date, 1)
  on conflict (user_id, jour) do update set n = public.idees_quota.n + 1 returning n into q;
  if q > 5 then raise exception 'trop_d_idees'; end if;
  insert into public.idees (texte, categorie) values (trim(p_texte), coalesce(nullif(p_categorie, ''), 'Idée'));
end $$;

-- Réponses publiques du bureau (visibles par tous les membres, toujours anonymes)
create or replace function public.idees_publiques()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('texte', texte, 'categorie', categorie, 'statut', statut, 'reponse', reponse, 'date', created_at) order by created_at desc), '[]')
  from (select * from public.idees where reponse is not null and statut <> 'archivee' order by created_at desc limit 20) x
  where public.est_membre() or public.is_bureau();
$$;

-- ── Contacter un membre du bureau : liste des destinataires possibles ──
create or replace function public.bureau_contacts()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', id, 'nom', prenom || ' ' || left(nom, 1) || '.', 'poste', poste) order by poste nulls last, prenom), '[]')
  from public.profiles where role in ('bureau', 'admin') and not coalesce(banni, false) and (public.est_membre() or public.is_bureau());
$$;

-- Purges : idées et quotas
create or replace function public.purge_idees() returns void language sql security definer set search_path = public as $$
  delete from public.idees_quota where jour < current_date - 7;
  delete from public.idees where created_at < now() - interval '1 year';
  delete from public.sondages where created_at < now() - interval '2 years';
$$;

revoke all on function public.sondages_liste(), public.repondre_sondage(uuid, int[]), public.sorties_liste(), public.sortie_inscription(uuid, boolean),
  public.deposer_idee(text, text), public.idees_publiques(), public.bureau_contacts(), public.purge_idees() from public, anon;
grant execute on function public.sondages_liste(), public.repondre_sondage(uuid, int[]), public.sorties_liste(), public.sortie_inscription(uuid, boolean),
  public.deposer_idee(text, text), public.idees_publiques(), public.bureau_contacts() to authenticated;

-- Limite d'envoi des messages « contacter un membre du bureau » (5 par jour et par membre)
create table if not exists public.contact_bureau_log (user_id uuid not null references public.profiles(id) on delete cascade, at timestamptz not null default now());
create index if not exists contact_bureau_log_user on public.contact_bureau_log (user_id, at);
alter table public.contact_bureau_log enable row level security;
create or replace function public.purge_idees() returns void language sql security definer set search_path = public as $$
  delete from public.idees_quota where jour < current_date - 7;
  delete from public.idees where created_at < now() - interval '1 year';
  delete from public.sondages where created_at < now() - interval '2 years';
  delete from public.contact_bureau_log where at < now() - interval '7 days';
$$;
