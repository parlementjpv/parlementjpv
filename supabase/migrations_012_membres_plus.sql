-- 012 — Espace membres : appel en séance (et exclusion automatique), profil d'orateur,
--       banque de motions, élection du bureau à bulletin secret, espace interne du bureau.

-- ───────────────────────── Commun ─────────────────────────
-- Membre = compte connecté, non banni
create or replace function public.est_membre() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and not coalesce(banni, false));
$$;

create table if not exists public.reglages (cle text primary key, valeur text not null);
insert into public.reglages (cle, valeur) values ('seuil_absences', '3') on conflict (cle) do nothing;
alter table public.reglages enable row level security;
drop policy if exists "reglages: bureau lit" on public.reglages;
create policy "reglages: bureau lit" on public.reglages for select using (public.is_bureau());
drop policy if exists "reglages: admin modifie" on public.reglages;
create policy "reglages: admin modifie" on public.reglages for update using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Les absences antérieures à cette date ne comptent plus (remise à zéro lors d'un débannissement)
alter table public.profiles add column if not exists absences_depuis timestamptz;

-- ───────────────────────── Appel ─────────────────────────
create table if not exists public.presences (
  event_key         text not null,
  email             text not null,
  user_id           uuid references public.profiles(id) on delete cascade,
  prenom            text not null default '',
  nom               text not null default '',
  classe            text not null default '',
  statut            text not null check (statut in ('present', 'absent', 'excuse')),
  camp              text,
  roles             text[] not null default '{}',
  arguments_retenus int not null default 0,
  pris_le           timestamptz not null default now(),
  primary key (event_key, email)
);
create index if not exists presences_user on public.presences (user_id);
alter table public.presences enable row level security;
drop policy if exists "presences: bureau ou soi" on public.presences;
create policy "presences: bureau ou soi" on public.presences for select using (public.is_bureau() or user_id = auth.uid());

create or replace function public.absences_comptees(p_user uuid) returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.presences pr join public.events e on e.id::text = pr.event_key
  where pr.user_id = p_user and pr.statut = 'absent'
    and e.starts_at > coalesce((select absences_depuis from public.profiles where id = p_user), '-infinity'::timestamptz);
$$;

-- Enregistre l'appel d'une séance (appelée par la fonction serveur « appel », après vérification du rôle bureau).
-- p_lignes : [{email, statut, user_id?, prenom?, nom?, classe?}]
create or replace function public.enregistrer_appel(p_event text, p_lignes jsonb)
returns json language plpgsql volatile security definer set search_path = public, auth as $$
declare
  l jsonb; s public.event_signups; uid uuid; seuil int := coalesce((select valeur::int from public.reglages where cle = 'seuil_absences'), 3);
  n int; out jsonb := '[]'; p public.profiles; em text;
begin
  if not exists (select 1 from public.events where id::text = p_event) then raise exception 'evenement introuvable'; end if;
  for l in select * from jsonb_array_elements(p_lignes) loop
    em := lower(trim(l->>'email'));
    if (l->>'statut') not in ('present', 'absent', 'excuse') then continue; end if;
    select * into s from public.event_signups where event_key = p_event and lower(email) = em limit 1;
    uid := coalesce(nullif(l->>'user_id', '')::uuid, s.user_id, (select user_id from public.adhesions where lower(email) = em limit 1));
    insert into public.presences (event_key, email, user_id, prenom, nom, classe, statut, camp, roles, arguments_retenus, pris_le)
    values (p_event, em, uid,
      coalesce(s.prenom, l->>'prenom', ''), coalesce(s.nom, l->>'nom', ''), coalesce(s.classe, l->>'classe', ''),
      l->>'statut', s.camp,
      coalesce((select array_agg(r.role order by r.role) from public.camp_roles r where r.signup_id = s.id), '{}'),
      coalesce((select count(*) from public.camp_posts cp where cp.auteur = s.id and cp.kind = 'argument' and cp.retenu), 0),
      now())
    on conflict (event_key, email) do update set statut = excluded.statut, user_id = coalesce(excluded.user_id, presences.user_id),
      camp = excluded.camp, roles = excluded.roles, arguments_retenus = excluded.arguments_retenus, pris_le = now();

    if uid is not null then
      select * into p from public.profiles where id = uid;
      n := public.absences_comptees(uid);
      if l->>'statut' = 'absent' and n > seuil and not p.banni and p.role <> 'admin' then
        update public.profiles set banni = true, role = 'membre', poste = null where id = uid;
        update auth.users set banned_until = now() + interval '100 years' where id = uid;
        out := out || jsonb_build_object('email', em, 'prenom', p.prenom, 'absences', n, 'action', 'exclu');
      elsif l->>'statut' = 'absent' and n = seuil and not p.banni then
        out := out || jsonb_build_object('email', em, 'prenom', p.prenom, 'absences', n, 'action', 'avertissement');
      end if;
    end if;
  end loop;
  return json_build_object('seuil', seuil, 'notifications', out);
end $$;
revoke all on function public.enregistrer_appel(text, jsonb) from public, anon, authenticated;
revoke all on function public.absences_comptees(uuid) from public, anon;
grant execute on function public.absences_comptees(uuid) to authenticated;

-- ───────────────────────── Banque de motions ─────────────────────────
create table if not exists public.motions (
  id         uuid primary key default gen_random_uuid(),
  texte      text not null check (char_length(texte) between 10 and 300),
  contexte   text check (char_length(contexte) <= 1000),
  auteur     uuid references public.profiles(id) on delete set null,
  auteur_nom text not null default '',
  statut     text not null default 'proposee' check (statut in ('proposee', 'retenue', 'debattue', 'ecartee')),
  created_at timestamptz not null default now()
);
create table if not exists public.motion_votes (
  motion_id uuid not null references public.motions(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  primary key (motion_id, user_id)
);
alter table public.motions enable row level security;
alter table public.motion_votes enable row level security;
drop policy if exists "motions: membres lisent" on public.motions;
create policy "motions: membres lisent" on public.motions for select using (public.est_membre());
drop policy if exists "motions: bureau gère" on public.motions;
create policy "motions: bureau gère" on public.motions for update using (public.is_bureau());
drop policy if exists "motions: bureau ou auteur supprime" on public.motions;
create policy "motions: bureau ou auteur supprime" on public.motions for delete using (public.is_bureau() or (auteur = auth.uid() and statut = 'proposee'));
drop policy if exists "votes motions: soi" on public.motion_votes;
create policy "votes motions: soi" on public.motion_votes for select using (user_id = auth.uid());

create or replace function public.motion_proposer(p_texte text, p_contexte text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare p public.profiles; id_ uuid;
begin
  if not public.est_membre() then raise exception 'reserve_aux_membres'; end if;
  select * into p from public.profiles where id = auth.uid();
  if (select count(*) from public.motions where auteur = p.id and created_at > now() - interval '1 day') >= 5 then raise exception 'trop_de_motions'; end if;
  insert into public.motions (texte, contexte, auteur, auteur_nom) values (trim(p_texte), nullif(trim(p_contexte), ''), p.id, p.prenom || ' ' || left(p.nom, 1) || '.')
  returning id into id_;
  insert into public.motion_votes values (id_, p.id);
  return id_;
end $$;

create or replace function public.motion_voter(p_motion uuid)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.est_membre() then raise exception 'reserve_aux_membres'; end if;
  if not exists (select 1 from public.motions where id = p_motion and statut in ('proposee', 'retenue')) then raise exception 'vote_ferme'; end if;
  if exists (select 1 from public.motion_votes where motion_id = p_motion and user_id = auth.uid()) then
    delete from public.motion_votes where motion_id = p_motion and user_id = auth.uid(); return false;
  end if;
  insert into public.motion_votes values (p_motion, auth.uid()); return true;
end $$;

create or replace function public.motions_liste()
returns table (id uuid, texte text, contexte text, auteur_nom text, statut text, created_at timestamptz, votes int, mon_vote boolean, mienne boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.texte, m.contexte, m.auteur_nom, m.statut, m.created_at,
    (select count(*)::int from public.motion_votes v where v.motion_id = m.id),
    exists (select 1 from public.motion_votes v where v.motion_id = m.id and v.user_id = auth.uid()),
    m.auteur = auth.uid()
  from public.motions m where public.est_membre();
$$;
revoke all on function public.motion_proposer(text, text), public.motion_voter(uuid), public.motions_liste() from public, anon;
grant execute on function public.motion_proposer(text, text), public.motion_voter(uuid), public.motions_liste() to authenticated;

-- ───────────────────────── Élections à bulletin secret ─────────────────────────
-- Secret du vote : on enregistre QUI a voté (election_votants) et des COMPTEURS de voix
-- (election_decompte), jamais de lien entre un électeur et son choix. Aucun bulletin individuel n'existe.
create table if not exists public.elections (
  id          uuid primary key default gen_random_uuid(),
  titre       text not null check (char_length(titre) between 3 and 120),
  poste       text,
  description text check (char_length(description) <= 2000),
  ouverture   timestamptz,
  fermeture   timestamptz,
  statut      text not null default 'brouillon' check (statut in ('brouillon', 'ouverte', 'close')),
  publiee     boolean not null default false,
  blancs      int not null default 0,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create table if not exists public.election_candidats (
  id                uuid primary key default gen_random_uuid(),
  election_id       uuid not null references public.elections(id) on delete cascade,
  user_id           uuid references public.profiles(id) on delete set null,
  nom               text not null check (char_length(nom) between 1 and 120),
  profession_de_foi text check (char_length(profession_de_foi) <= 3000),
  ordre             int not null default 0,
  voix              int not null default 0
);
create table if not exists public.election_votants (
  election_id uuid not null references public.elections(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  primary key (election_id, user_id)
);
alter table public.elections enable row level security;
alter table public.election_candidats enable row level security;
alter table public.election_votants enable row level security;  -- aucune politique : illisible hors fonctions
drop policy if exists "elections: bureau crée" on public.elections;
create policy "elections: bureau crée" on public.elections for insert with check (public.is_bureau() and statut = 'brouillon' and blancs = 0);
drop policy if exists "elections: bureau modifie brouillon" on public.elections;
create policy "elections: bureau modifie brouillon" on public.elections for update using (public.is_bureau() and statut = 'brouillon') with check (statut = 'brouillon' and blancs = 0);
drop policy if exists "elections: bureau supprime brouillon" on public.elections;
create policy "elections: bureau supprime brouillon" on public.elections for delete using (public.is_bureau() and statut = 'brouillon');
drop policy if exists "candidats: bureau gère en brouillon" on public.election_candidats;
create policy "candidats: bureau gère en brouillon" on public.election_candidats for all
  using (public.is_bureau() and exists (select 1 from public.elections e where e.id = election_id and e.statut = 'brouillon'))
  with check (public.is_bureau() and voix = 0 and exists (select 1 from public.elections e where e.id = election_id and e.statut = 'brouillon'));

-- Électeurs inscrits : membres non bannis dont le compte existait à l'ouverture du vote
create or replace function public.election_inscrits(p_election uuid) returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.profiles p join public.elections e on e.id = p_election
  where not coalesce(p.banni, false) and p.created_at < coalesce(e.ouverture, now());
$$;

create or replace function public.election_statut(e public.elections) returns text language sql stable as $$
  select case when e.statut = 'ouverte' and e.fermeture is not null and now() >= e.fermeture then 'close'
              when e.statut = 'ouverte' and e.ouverture is not null and now() < e.ouverture then 'programmee'
              else e.statut end;
$$;

create or replace function public.elections_liste()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.created_at desc), '[]') from (
    select e.id, e.titre, e.poste, e.description, e.ouverture, e.fermeture, e.created_at, public.election_statut(e) as statut, e.publiee,
      exists (select 1 from public.election_votants v where v.election_id = e.id and v.user_id = auth.uid()) as a_vote,
      (select p.created_at < coalesce(e.ouverture, now()) from public.profiles p where p.id = auth.uid()) as peut_voter,
      (e.blancs + coalesce((select sum(c.voix) from public.election_candidats c where c.election_id = e.id), 0))::int as votants,
      public.election_inscrits(e.id) as inscrits,
      (select json_agg(json_build_object('id', c.id, 'nom', c.nom, 'profession_de_foi', c.profession_de_foi, 'user_id', c.user_id,
          'voix', case when public.election_statut(e) = 'close' and (e.publiee or public.is_bureau()) then c.voix end) order by c.ordre, c.nom)
       from public.election_candidats c where c.election_id = e.id) as candidats,
      case when public.election_statut(e) = 'close' and (e.publiee or public.is_bureau()) then e.blancs end as blancs
    from public.elections e
    where (public.est_membre() and e.statut <> 'brouillon') or public.is_bureau()
  ) x;
$$;

create or replace function public.election_voter(p_election uuid, p_candidat uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare e public.elections;
begin
  if not public.est_membre() then raise exception 'reserve_aux_membres'; end if;
  select * into e from public.elections where id = p_election for update;
  if not found or public.election_statut(e) <> 'ouverte' then raise exception 'vote_ferme'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and created_at < coalesce(e.ouverture, now())) then raise exception 'non_inscrit'; end if;
  if p_candidat is not null and not exists (select 1 from public.election_candidats where id = p_candidat and election_id = p_election) then raise exception 'candidat_invalide'; end if;
  begin
    insert into public.election_votants (election_id, user_id) values (p_election, auth.uid());
  exception when unique_violation then raise exception 'deja_vote';
  end;
  if p_candidat is null then update public.elections set blancs = blancs + 1 where id = p_election;
  else update public.election_candidats set voix = voix + 1 where id = p_candidat; end if;
end $$;

create or replace function public.election_action(p_election uuid, p_action text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare e public.elections;
begin
  if not public.is_bureau() then raise exception 'reserve_au_bureau'; end if;
  select * into e from public.elections where id = p_election for update;
  if not found then raise exception 'introuvable'; end if;
  if p_action = 'ouvrir' then
    if e.statut <> 'brouillon' then raise exception 'deja_ouverte'; end if;
    if (select count(*) from public.election_candidats where election_id = p_election) < 1 then raise exception 'aucun_candidat'; end if;
    if e.fermeture is null or e.fermeture <= now() then raise exception 'fermeture_invalide'; end if;
    update public.elections set statut = 'ouverte', ouverture = coalesce(ouverture, now()) where id = p_election;
  elsif p_action = 'clore' then
    if e.statut <> 'ouverte' then raise exception 'pas_ouverte'; end if;
    update public.elections set statut = 'close', fermeture = least(coalesce(fermeture, now()), now()) where id = p_election;
  elsif p_action = 'publier' then
    if public.election_statut(e) <> 'close' then raise exception 'pas_close'; end if;
    update public.elections set statut = 'close', publiee = true where id = p_election;
  else raise exception 'action_invalide'; end if;
end $$;
revoke all on function public.elections_liste(), public.election_voter(uuid, uuid), public.election_action(uuid, text), public.election_inscrits(uuid) from public, anon;
grant execute on function public.elections_liste(), public.election_voter(uuid, uuid), public.election_action(uuid, text) to authenticated;

-- ───────────────────────── Profil d'orateur ─────────────────────────
create or replace function public.profil_orateur(p_user uuid default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare u uuid := coalesce(p_user, auth.uid()); p public.profiles; soi boolean;
begin
  if not public.est_membre() and not public.is_bureau() then raise exception 'reserve_aux_membres'; end if;
  select * into p from public.profiles where id = u;
  if not found then return null; end if;
  soi := u = auth.uid() or public.is_bureau();
  return json_build_object(
    'id', p.id, 'prenom', p.prenom, 'nom', case when soi then p.nom else left(p.nom, 1) || '.' end, 'classe', p.classe, 'role', p.role, 'membre_depuis', p.created_at,
    'seances', (select count(*) from public.presences where user_id = u and statut = 'present'),
    'debats', (select count(*) from public.presences pr join public.events e on e.id::text = pr.event_key where pr.user_id = u and pr.statut = 'present' and e.type = 'Débat'),
    'roles', coalesce((select json_object_agg(r, n) from (select unnest(roles) r, count(*) n from public.presences where user_id = u and statut = 'present' group by 1) x), '{}'),
    'arguments_retenus', (select coalesce(sum(arguments_retenus), 0) from public.presences where user_id = u and statut = 'present'),
    'camps', coalesce((select json_object_agg(camp, n) from (select camp, count(*) n from public.presences where user_id = u and statut = 'present' and camp is not null group by 1) x), '{}'),
    'motions_proposees', (select count(*) from public.motions where auteur = u),
    'motions_retenues', (select count(*) from public.motions where auteur = u and statut in ('retenue', 'debattue')),
    'votes_elections', case when soi then (select count(*) from public.election_votants where user_id = u) end,
    'absences', case when soi then public.absences_comptees(u) end,
    'excuses', case when soi then (select count(*) from public.presences where user_id = u and statut = 'excuse') end,
    'seuil_absences', case when soi then (select valeur::int from public.reglages where cle = 'seuil_absences') end,
    'historique', case when soi then coalesce((select json_agg(json_build_object('titre', e.title, 'type', e.type, 'date', e.starts_at, 'statut', pr.statut, 'camp', pr.camp, 'roles', pr.roles) order by e.starts_at desc)
                     from public.presences pr join public.events e on e.id::text = pr.event_key where pr.user_id = u), '[]') end,
    'moi', u = auth.uid()
  );
end $$;

create or replace function public.orateurs_classement()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.seances desc, x.prenom), '[]') from (
    select p.id, p.prenom, left(p.nom, 1) || '.' as nom, p.classe, p.role,
      count(*) filter (where pr.statut = 'present')::int as seances,
      coalesce(sum(cardinality(pr.roles)) filter (where pr.statut = 'present'), 0)::int as roles
    from public.profiles p join public.presences pr on pr.user_id = p.id
    where not coalesce(p.banni, false) and public.est_membre()
    group by p.id having count(*) filter (where pr.statut = 'present') > 0
  ) x;
$$;
revoke all on function public.profil_orateur(uuid), public.orateurs_classement() from public, anon;
grant execute on function public.profil_orateur(uuid), public.orateurs_classement() to authenticated;

-- ───────────────────────── Espace interne du bureau ─────────────────────────
create table if not exists public.bureau_taches (
  id         uuid primary key default gen_random_uuid(),
  titre      text not null check (char_length(titre) between 2 and 200),
  details    text check (char_length(details) <= 2000),
  assigne_a  uuid references public.profiles(id) on delete set null,
  echeance   date,
  statut     text not null default 'a_faire' check (statut in ('a_faire', 'en_cours', 'fait')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.bureau_messages (
  id         uuid primary key default gen_random_uuid(),
  auteur     uuid references public.profiles(id) on delete set null default auth.uid(),
  auteur_nom text not null,
  contenu    text not null check (char_length(contenu) between 1 and 2000),
  created_at timestamptz not null default now()
);
create table if not exists public.bureau_notes (
  id         uuid primary key default gen_random_uuid(),
  titre      text not null check (char_length(titre) between 1 and 200),
  contenu    text not null default '' check (char_length(contenu) <= 50000),
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.bureau_taches enable row level security;
alter table public.bureau_messages enable row level security;
alter table public.bureau_notes enable row level security;
drop policy if exists "bureau: taches" on public.bureau_taches;
create policy "bureau: taches" on public.bureau_taches for all using (public.is_bureau()) with check (public.is_bureau());
drop policy if exists "bureau: messages lire" on public.bureau_messages;
create policy "bureau: messages lire" on public.bureau_messages for select using (public.is_bureau());
drop policy if exists "bureau: messages écrire" on public.bureau_messages;
create policy "bureau: messages écrire" on public.bureau_messages for insert with check (public.is_bureau() and auteur = auth.uid());
drop policy if exists "bureau: messages supprimer les siens" on public.bureau_messages;
create policy "bureau: messages supprimer les siens" on public.bureau_messages for delete using (public.is_bureau() and auteur = auth.uid());
drop policy if exists "bureau: notes" on public.bureau_notes;
create policy "bureau: notes" on public.bureau_notes for all using (public.is_bureau()) with check (public.is_bureau());

-- Liste des membres du bureau (pour attribuer les tâches)
create or replace function public.bureau_membres() returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', id, 'prenom', prenom, 'nom', nom, 'role', role) order by prenom), '[]')
  from public.profiles where role in ('bureau', 'admin') and public.is_bureau();
$$;
revoke all on function public.bureau_membres() from public, anon;
grant execute on function public.bureau_membres() to authenticated;

-- ───────────────────────── Purge (compléments) ─────────────────────────
create or replace function public.purge_complements() returns void language plpgsql volatile security definer set search_path = public as $$
begin
  delete from public.presences where user_id is null and pris_le < now() - interval '12 months';
  delete from public.bureau_messages where created_at < now() - interval '1 year';
  delete from public.election_votants v using public.elections e where e.id = v.election_id and e.statut = 'close' and e.fermeture < now() - interval '30 days';
end $$;
revoke all on function public.purge_complements() from public, anon, authenticated;
select cron.unschedule('purge-complements') where exists (select 1 from cron.job where jobname = 'purge-complements');
select cron.schedule('purge-complements', '27 3 * * *', 'select public.purge_complements()');
create or replace function public.absences_comptees(p_user uuid) returns int language sql stable security definer set search_path = public as $$
  select case when auth.uid() is not null and p_user <> auth.uid() and not public.is_bureau() then null else (
    select count(*)::int from public.presences pr join public.events e on e.id::text = pr.event_key
    where pr.user_id = p_user and pr.statut = 'absent'
      and e.starts_at > coalesce((select absences_depuis from public.profiles where id = p_user), '-infinity'::timestamptz)) end;
$$;
-- Le bureau voit les brouillons (nécessaire pour les modifier) ; jamais les compteurs d'un vote en cours
drop policy if exists "elections: bureau lit brouillons" on public.elections;
create policy "elections: bureau lit brouillons" on public.elections for select using (public.is_bureau() and statut = 'brouillon');
