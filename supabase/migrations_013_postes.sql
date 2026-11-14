-- 013 — Postes du bureau (président, etc.) attribués par l'admin, affichés publiquement ; emails de résultats d'élection

alter table public.profiles add column if not exists poste text check (poste is null or poste in ('Président·e', 'Vice-président·e', 'Secrétaire général·e', 'Trésorier·e', 'Responsable Débat', 'Responsable Éloquence', 'Responsable Conférences', 'Responsable Visites', 'Responsable Communication'));
create unique index if not exists profiles_poste_unique on public.profiles (poste) where poste is not null;

-- Un membre ne peut modifier ni son rôle, ni son poste, ni son statut de bannissement, ni son compteur d'absences
drop policy if exists "profil: modification soi-même" on public.profiles;
create policy "profil: modification soi-même" on public.profiles for update using (auth.uid() = id)
  with check (auth.uid() = id
    and role  = (select role  from public.profiles where id = auth.uid())
    and banni = (select banni from public.profiles where id = auth.uid())
    and poste is not distinct from (select poste from public.profiles where id = auth.uid())
    and absences_depuis is not distinct from (select absences_depuis from public.profiles where id = auth.uid()));

-- Bureau affiché publiquement sur « Qui sommes-nous » (prénom, initiale du nom, classe, poste)
create or replace function public.bureau_public()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('poste', poste, 'prenom', prenom, 'nom', left(nom, 1) || '.', 'classe', classe)), '[]')
  from public.profiles where poste is not null and not coalesce(banni, false);
$$;
grant execute on function public.bureau_public() to anon, authenticated;

alter table public.elections add column if not exists resultats_envoyes_at timestamptz;

-- Le poste apparaît à côté des noms
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
    select p.id, p.prenom, left(p.nom, 1) || '.' as nom, p.classe, p.role, p.poste,
      count(*) filter (where pr.statut = 'present')::int as seances,
      coalesce(sum(cardinality(pr.roles)) filter (where pr.statut = 'present'), 0)::int as roles
    from public.profiles p join public.presences pr on pr.user_id = p.id
    where not coalesce(p.banni, false) and public.est_membre()
    group by p.id having count(*) filter (where pr.statut = 'present') > 0
  ) x;
$$;

create or replace function public.salle_contenu(p_event text, p_camp text, p_moi uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'evenement', (select json_build_object('id', e.id, 'titre', e.title, 'type', e.type, 'debut', e.starts_at, 'fin', e.ends_at, 'lieu', e.location, 'description', e.description, 'camps', e.camps)
                  from public.events e where e.id::text = p_event),
    'camp', p_camp,
    'equipe', coalesce((select json_agg(json_build_object('id', s.id, 'prenom', s.prenom, 'nom', left(s.nom, 1) || '.', 'classe', s.classe, 'poste', (select pp.poste from public.profiles pp where pp.id = s.user_id), 'moi', s.id = p_moi) order by s.created_at)
                        from public.event_signups s where s.event_key = p_event and s.camp = p_camp and s.reponse = 'oui'), '[]'),
    'posts', coalesce((select json_agg(json_build_object('id', p.id, 'kind', p.kind, 'auteur', p.auteur_nom, 'mien', p.auteur = p_moi, 'titre', p.titre, 'contenu', p.contenu,
                        'source', p.source, 'reponse', p.reponse, 'retenu', p.retenu, 'date', p.created_at,
                        'votes', (select count(*) from public.camp_votes v where v.post_id = p.id),
                        'mon_vote', exists (select 1 from public.camp_votes v where v.post_id = p.id and v.signup_id = p_moi)) order by p.created_at)
                       from public.camp_posts p where p.event_key = p_event and p.camp = p_camp), '[]'),
    'roles', coalesce((select json_agg(json_build_object('role', r.role, 'prenom', s.prenom, 'moi', r.signup_id = p_moi))
                       from public.camp_roles r join public.event_signups s on s.id = r.signup_id where r.event_key = p_event and r.camp = p_camp), '[]'),
    'roles_liste', public.salle_roles_liste(p_event, p_camp)
  );
$$;

drop function if exists public.motions_liste();
create or replace function public.motions_liste()
returns table (id uuid, texte text, contexte text, auteur_nom text, statut text, created_at timestamptz, votes int, mon_vote boolean, mienne boolean, auteur_poste text)
language sql stable security definer set search_path = public as $$
  select m.id, m.texte, m.contexte, m.auteur_nom, m.statut, m.created_at,
    (select count(*)::int from public.motion_votes v where v.motion_id = m.id),
    exists (select 1 from public.motion_votes v where v.motion_id = m.id and v.user_id = auth.uid()),
    m.auteur = auth.uid(),
    (select p.poste from public.profiles p where p.id = m.auteur)
  from public.motions m where public.est_membre();
$$;
grant execute on function public.motions_liste() to authenticated;
revoke all on function public.motions_liste() from anon;
revoke all on function public.motions_liste() from public, anon; grant execute on function public.motions_liste() to authenticated;
create or replace function public.bureau_membres() returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', id, 'prenom', prenom, 'nom', nom, 'role', role, 'poste', poste) order by prenom), '[]')
  from public.profiles where role in ('bureau', 'admin') and public.is_bureau();
$$;
