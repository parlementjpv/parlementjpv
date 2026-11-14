-- 008 — Salles de préparation par camp
-- Accès par jeton personnel (lien privé envoyé par email) : fonctionne avec ou sans compte.
-- Aucune table n'est lisible directement : tout passe par des fonctions qui vérifient le jeton et le camp.

alter table public.event_signups add column if not exists jeton uuid not null default gen_random_uuid();
create unique index if not exists event_signups_jeton on public.event_signups (jeton);

create table if not exists public.camp_posts (
  id          uuid primary key default gen_random_uuid(),
  event_key   text not null,
  camp        text not null,
  kind        text not null check (kind in ('argument', 'objection', 'message')),
  auteur      uuid references public.event_signups(id) on delete set null,
  auteur_nom  text not null,
  titre       text check (char_length(titre) <= 200),
  contenu     text not null check (char_length(contenu) between 1 and 3000),
  source      text check (char_length(source) <= 500),
  reponse     text check (char_length(reponse) <= 3000),
  retenu      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists camp_posts_salle on public.camp_posts (event_key, camp, kind, created_at);

create table if not exists public.camp_votes (
  post_id   uuid not null references public.camp_posts(id) on delete cascade,
  signup_id uuid not null references public.event_signups(id) on delete cascade,
  primary key (post_id, signup_id)
);

create table if not exists public.camp_roles (
  event_key text not null,
  camp      text not null,
  role      text not null,
  signup_id uuid not null references public.event_signups(id) on delete cascade,
  primary key (event_key, camp, role)
);

alter table public.camp_posts enable row level security;
alter table public.camp_votes enable row level security;
alter table public.camp_roles enable row level security;
drop policy if exists "salles: bureau lit" on public.camp_posts;
create policy "salles: bureau lit" on public.camp_posts for select using (public.is_bureau());
drop policy if exists "salles: bureau supprime" on public.camp_posts;
create policy "salles: bureau supprime" on public.camp_posts for delete using (public.is_bureau());

-- Suppression d'un événement => suppression de ses salles
create or replace function public.events_cleanup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.camp_roles where event_key = old.id::text;
  delete from public.camp_posts where event_key = old.id::text;
  delete from public.event_signups where event_key = old.id::text;
  return old;
end $$;

-- Rôles de prise de parole proposés dans chaque salle
create or replace function public.salle_roles_liste() returns text[] language sql immutable as $$
  select array['Ouverture', 'Argument 1', 'Argument 2', 'Argument 3', 'Réfutation', 'Conclusion'];
$$;

-- Participant correspondant à un jeton (doit venir et avoir un camp)
create or replace function public.salle_moi(p_jeton uuid)
returns public.event_signups language plpgsql stable security definer set search_path = public as $$
declare s public.event_signups;
begin
  select * into s from public.event_signups where jeton = p_jeton and reponse = 'oui' and camp is not null;
  if not found then raise exception 'acces_refuse'; end if;
  return s;
end $$;

-- État complet d'une salle (vue participant ou bureau)
create or replace function public.salle_contenu(p_event text, p_camp text, p_moi uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'evenement', (select json_build_object('id', e.id, 'titre', e.title, 'type', e.type, 'debut', e.starts_at, 'fin', e.ends_at, 'lieu', e.location, 'description', e.description, 'camps', e.camps)
                  from public.events e where e.id::text = p_event),
    'camp', p_camp,
    'equipe', coalesce((select json_agg(json_build_object('id', s.id, 'prenom', s.prenom, 'nom', left(s.nom, 1) || '.', 'classe', s.classe, 'moi', s.id = p_moi) order by s.created_at)
                        from public.event_signups s where s.event_key = p_event and s.camp = p_camp and s.reponse = 'oui'), '[]'),
    'posts', coalesce((select json_agg(json_build_object('id', p.id, 'kind', p.kind, 'auteur', p.auteur_nom, 'mien', p.auteur = p_moi, 'titre', p.titre, 'contenu', p.contenu,
                        'source', p.source, 'reponse', p.reponse, 'retenu', p.retenu, 'date', p.created_at,
                        'votes', (select count(*) from public.camp_votes v where v.post_id = p.id),
                        'mon_vote', exists (select 1 from public.camp_votes v where v.post_id = p.id and v.signup_id = p_moi)) order by p.created_at)
                       from public.camp_posts p where p.event_key = p_event and p.camp = p_camp), '[]'),
    'roles', coalesce((select json_agg(json_build_object('role', r.role, 'prenom', s.prenom, 'moi', r.signup_id = p_moi))
                       from public.camp_roles r join public.event_signups s on s.id = r.signup_id where r.event_key = p_event and r.camp = p_camp), '[]'),
    'roles_liste', public.salle_roles_liste()
  );
$$;
revoke all on function public.salle_contenu(text, text, uuid) from public, anon, authenticated;

create or replace function public.salle_etat(p_jeton uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare s public.event_signups := public.salle_moi(p_jeton);
begin
  return public.salle_contenu(s.event_key, s.camp, s.id)::jsonb || jsonb_build_object('moi', s.prenom);
end $$;

-- Vue bureau (lecture) d'une salle
create or replace function public.salle_etat_bureau(p_event text, p_camp text)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_bureau() then raise exception 'acces_refuse'; end if;
  return public.salle_contenu(p_event, p_camp, null)::jsonb || jsonb_build_object('bureau', true);
end $$;

create or replace function public.salle_poster(p_jeton uuid, p_kind text, p_contenu text, p_titre text default null, p_source text default null, p_reponse text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare s public.event_signups := public.salle_moi(p_jeton); new_id uuid;
begin
  if p_kind not in ('argument', 'objection', 'message') then raise exception 'type invalide'; end if;
  if (select count(*) from public.camp_posts where auteur = s.id and created_at > now() - interval '1 minute') >= 10 then raise exception 'trop_rapide'; end if;
  insert into public.camp_posts (event_key, camp, kind, auteur, auteur_nom, titre, contenu, source, reponse)
  values (s.event_key, s.camp, p_kind, s.id, s.prenom, nullif(trim(p_titre), ''), trim(p_contenu), nullif(trim(p_source), ''), nullif(trim(p_reponse), ''))
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.salle_modifier(p_jeton uuid, p_post uuid, p_champ text, p_valeur text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare s public.event_signups := public.salle_moi(p_jeton); p public.camp_posts;
begin
  select * into p from public.camp_posts where id = p_post and event_key = s.event_key and camp = s.camp;
  if not found then raise exception 'acces_refuse'; end if;
  if p_champ = 'retenu' then
    update public.camp_posts set retenu = not retenu where id = p_post;
  elsif p_champ = 'reponse' and p.kind = 'objection' then
    update public.camp_posts set reponse = nullif(trim(left(p_valeur, 3000)), '') where id = p_post;
  elsif p_champ = 'supprimer' and p.auteur = s.id then
    delete from public.camp_posts where id = p_post;
  else
    raise exception 'action_invalide';
  end if;
end $$;

create or replace function public.salle_voter(p_jeton uuid, p_post uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare s public.event_signups := public.salle_moi(p_jeton);
begin
  if not exists (select 1 from public.camp_posts where id = p_post and event_key = s.event_key and camp = s.camp) then raise exception 'acces_refuse'; end if;
  if exists (select 1 from public.camp_votes where post_id = p_post and signup_id = s.id) then
    delete from public.camp_votes where post_id = p_post and signup_id = s.id;
  else
    insert into public.camp_votes (post_id, signup_id) values (p_post, s.id);
  end if;
end $$;

create or replace function public.salle_role(p_jeton uuid, p_role text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare s public.event_signups := public.salle_moi(p_jeton); r public.camp_roles;
begin
  if not (p_role = any(public.salle_roles_liste())) then raise exception 'role invalide'; end if;
  select * into r from public.camp_roles where event_key = s.event_key and camp = s.camp and role = p_role;
  if found then
    if r.signup_id = s.id then delete from public.camp_roles where event_key = s.event_key and camp = s.camp and role = p_role;
    else raise exception 'role_pris'; end if;
  else
    insert into public.camp_roles (event_key, camp, role, signup_id) values (s.event_key, s.camp, p_role, s.id);
  end if;
end $$;

grant execute on function public.salle_etat(uuid), public.salle_poster(uuid, text, text, text, text, text), public.salle_modifier(uuid, uuid, text, text),
  public.salle_voter(uuid, uuid), public.salle_role(uuid, text) to anon, authenticated;
grant execute on function public.salle_etat_bureau(text, text) to authenticated;
revoke execute on function public.salle_moi(uuid) from public, anon, authenticated;

-- Changement de camp ou « je ne viens pas » : on libère les rôles de prise de parole
create or replace function public.event_signups_liberer_roles() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reponse <> 'oui' or new.camp is distinct from old.camp then delete from public.camp_roles where signup_id = new.id; end if;
  return new;
end $$;
drop trigger if exists event_signups_liberer_roles on public.event_signups;
create trigger event_signups_liberer_roles after update on public.event_signups for each row execute procedure public.event_signups_liberer_roles();

-- La réponse à un événement renvoie aussi le jeton de la salle
create or replace function public.repondre_evenement(
  p_event text, p_reponse text, p_prenom text, p_nom text, p_classe text, p_email text, p_telephone text default null)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r public.event_signups;
begin
  if p_reponse not in ('oui', 'non') then raise exception 'reponse invalide'; end if;
  if not exists (select 1 from public.events where id::text = p_event and published) then raise exception 'evenement introuvable'; end if;
  if uid is not null then
    select * into r from public.event_signups where event_key = p_event and user_id = uid;
    if found then
      update public.event_signups set reponse = p_reponse where id = r.id returning * into r;
      return json_build_object('statut', 'modifie', 'reponse', r.reponse, 'camp', r.camp, 'jeton', case when r.camp is not null then r.jeton end);
    end if;
  end if;
  begin
    insert into public.event_signups (event_key, reponse, prenom, nom, classe, email, telephone, user_id)
    values (p_event, p_reponse, trim(p_prenom), trim(p_nom), trim(p_classe), lower(trim(p_email)), nullif(trim(p_telephone), ''), uid)
    returning * into r;
  exception when unique_violation then
    return json_build_object('statut', 'deja');
  end;
  return json_build_object('statut', 'ok', 'reponse', r.reponse, 'camp', r.camp, 'jeton', case when r.camp is not null then r.jeton end);
end $$;

alter table public.event_signups add column if not exists lien_envoye_at timestamptz;
