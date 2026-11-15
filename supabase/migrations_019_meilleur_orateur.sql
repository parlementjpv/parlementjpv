-- 019 — Vote du meilleur orateur après chaque séance, par les présents
-- Vote anonyme : personne (bureau compris) ne voit qui a voté pour qui, seulement le résultat.
-- Ouvert dès que l'appel est fait, jusqu'à 3 jours après le début de la séance.

create table if not exists public.votes_orateur (
  event_key  text not null,
  votant     uuid not null references public.profiles(id) on delete cascade,
  orateur    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_key, votant),
  check (votant <> orateur)
);
alter table public.votes_orateur enable row level security;   -- aucune policy : accès uniquement par les fonctions ci-dessous

create or replace function public.vote_orateur_fin(p_event text)
returns timestamptz language sql stable security definer set search_path = public as $$
  select e.starts_at + interval '3 days' from public.events e where e.id::text = p_event;
$$;

-- Lauréats d'une séance close (ex aequo possibles, au moins une voix)
create or replace function public.laureats_orateur(p_event text)
returns setof uuid language sql stable security definer set search_path = public as $$
  with t as (select orateur, count(*) n from public.votes_orateur where event_key = p_event group by orateur)
  select orateur from t where n = (select max(n) from t) and public.vote_orateur_fin(p_event) < now();
$$;

create or replace function public.titres_orateur(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from (select distinct event_key from public.votes_orateur) v
  where p_user in (select public.laureats_orateur(v.event_key));
$$;

-- Votes en cours pour moi : séances où j'étais présent, encore ouvertes
create or replace function public.votes_orateur_ouverts()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'event', e.id, 'titre', e.title, 'date', e.starts_at, 'fin', e.starts_at + interval '3 days',
    'mon_vote', (select v.orateur from public.votes_orateur v where v.event_key = e.id::text and v.votant = auth.uid()),
    'candidats', coalesce((select json_agg(json_build_object('id', p.id, 'prenom', p.prenom, 'nom', left(p.nom, 1) || '.', 'classe', p.classe, 'camp', pr2.camp) order by p.prenom)
                  from public.presences pr2 join public.profiles p on p.id = pr2.user_id
                  where pr2.event_key = e.id::text and pr2.statut = 'present' and p.id <> auth.uid()), '[]')
  ) order by e.starts_at desc), '[]')
  from public.presences pr join public.events e on e.id::text = pr.event_key
  where pr.user_id = auth.uid() and pr.statut = 'present' and now() < e.starts_at + interval '3 days';
$$;

create or replace function public.voter_meilleur_orateur(p_event text, p_orateur uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'non_connecte'; end if;
  if p_orateur = auth.uid() then raise exception 'pas_soi_meme'; end if;
  if coalesce(public.vote_orateur_fin(p_event), now()) <= now() then raise exception 'vote_clos'; end if;
  if not exists (select 1 from public.presences where event_key = p_event and user_id = auth.uid() and statut = 'present') then raise exception 'pas_present'; end if;
  if not exists (select 1 from public.presences where event_key = p_event and user_id = p_orateur and statut = 'present') then raise exception 'orateur_absent'; end if;
  insert into public.votes_orateur (event_key, votant, orateur) values (p_event, auth.uid(), p_orateur)
  on conflict (event_key, votant) do update set orateur = excluded.orateur, created_at = now();
end $$;

-- Derniers lauréats (séances closes), pour Mon espace et le profil
create or replace function public.derniers_meilleurs_orateurs(p_limite int default 5)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.date desc), '[]') from (
    select e.id as event, e.title as titre, e.starts_at as date,
      (select json_agg(json_build_object('id', p.id, 'prenom', p.prenom, 'nom', left(p.nom, 1) || '.', 'voix', (select count(*) from public.votes_orateur v2 where v2.event_key = e.id::text and v2.orateur = p.id)))
         from public.profiles p where p.id in (select public.laureats_orateur(e.id::text))) as laureats
    from public.events e
    where exists (select 1 from public.votes_orateur v where v.event_key = e.id::text) and e.starts_at + interval '3 days' < now()
    order by e.starts_at desc limit greatest(1, least(p_limite, 20))
  ) x where public.est_membre() or public.is_bureau();
$$;

-- Profil d'orateur : + titres de meilleur orateur
create or replace function public.profil_orateur(p_user uuid default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare u uuid := coalesce(p_user, auth.uid()); p public.profiles; soi boolean;
begin
  if not public.est_membre() and not public.is_bureau() then raise exception 'reserve_aux_membres'; end if;
  select * into p from public.profiles where id = u;
  if not found then return null; end if;
  soi := u = auth.uid() or public.is_bureau();
  return json_build_object(
    'id', p.id, 'prenom', p.prenom, 'nom', case when soi then p.nom else left(p.nom, 1) || '.' end, 'classe', p.classe, 'role', p.role, 'poste', p.poste, 'membre_depuis', p.created_at,
    'seances', (select count(*) from public.presences where user_id = u and statut = 'present'),
    'debats', (select count(*) from public.presences pr join public.events e on e.id::text = pr.event_key where pr.user_id = u and pr.statut = 'present' and e.type = 'Débat'),
    'roles', coalesce((select json_object_agg(r, n) from (select unnest(roles) r, count(*) n from public.presences where user_id = u and statut = 'present' group by 1) x), '{}'),
    'arguments_retenus', (select coalesce(sum(arguments_retenus), 0) from public.presences where user_id = u and statut = 'present'),
    'camps', coalesce((select json_object_agg(camp, n) from (select camp, count(*) n from public.presences where user_id = u and statut = 'present' and camp is not null group by 1) x), '{}'),
    'motions_proposees', (select count(*) from public.motions where auteur = u),
    'motions_retenues', (select count(*) from public.motions where auteur = u and statut in ('retenue', 'debattue')),
    'meilleur_orateur', public.titres_orateur(u),
    'votes_orateur', case when soi then (select count(*) from public.votes_orateur where votant = u) end,
    'votes_elections', case when soi then (select count(*) from public.election_votants where user_id = u) end,
    'absences', case when soi then public.absences_comptees(u) end,
    'excuses', case when soi then (select count(*) from public.presences where user_id = u and statut = 'excuse') end,
    'seuil_absences', case when soi then (select valeur::int from public.reglages where cle = 'seuil_absences') end,
    'historique', case when soi then coalesce((select json_agg(json_build_object('titre', e.title, 'type', e.type, 'date', e.starts_at, 'statut', pr.statut, 'camp', pr.camp, 'roles', pr.roles,
                       'meilleur', u in (select public.laureats_orateur(pr.event_key))) order by e.starts_at desc)
                     from public.presences pr join public.events e on e.id::text = pr.event_key where pr.user_id = u), '[]') end,
    'moi', u = auth.uid()
  );
end $$;

-- Classement : titres de meilleur orateur d'abord, puis séances
create or replace function public.orateurs_classement()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.titres desc, x.seances desc, x.prenom), '[]') from (
    select p.id, p.prenom, left(p.nom, 1) || '.' as nom, p.classe, p.role, p.poste,
      count(*) filter (where pr.statut = 'present')::int as seances,
      coalesce(sum(cardinality(pr.roles)) filter (where pr.statut = 'present'), 0)::int as roles,
      public.titres_orateur(p.id) as titres
    from public.profiles p join public.presences pr on pr.user_id = p.id
    where not coalesce(p.banni, false) and public.est_membre()
    group by p.id having count(*) filter (where pr.statut = 'present') > 0
  ) x;
$$;

revoke all on function public.vote_orateur_fin(text), public.laureats_orateur(text), public.titres_orateur(uuid) from public, anon, authenticated;
revoke all on function public.votes_orateur_ouverts(), public.voter_meilleur_orateur(text, uuid), public.derniers_meilleurs_orateurs(int),
  public.profil_orateur(uuid), public.orateurs_classement() from public, anon;
grant execute on function public.votes_orateur_ouverts(), public.voter_meilleur_orateur(text, uuid), public.derniers_meilleurs_orateurs(int),
  public.profil_orateur(uuid), public.orateurs_classement() to authenticated;

alter table public.events add column if not exists vote_orateur_annonce_at timestamptz;
