-- 007 — Camps de débat : 2 à 4 camps par événement, attribution aléatoire et équilibrée par le serveur

alter table public.events add column if not exists camps text[] not null default '{}'
  check (cardinality(camps) = 0 or cardinality(camps) between 2 and 4);
alter table public.event_signups add column if not exists camp text;

-- Tirage : parmi les camps les moins remplis de l'événement, un au hasard
create or replace function public.tirer_camp(p_event text)
returns text language sql volatile security definer set search_path = public as $$
  with c as (
    select unnest(e.camps) as camp from public.events e where e.id::text = p_event
  ), n as (
    select c.camp, (select count(*) from public.event_signups s where s.event_key = p_event and s.reponse = 'oui' and s.camp = c.camp) as nb from c
  )
  select camp from n where nb = (select min(nb) from n) order by random() limit 1;
$$;

-- Le camp est toujours fixé par le serveur : impossible de le choisir soi-même
create or replace function public.event_signups_camp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reponse = 'oui' then
    if tg_op = 'INSERT' or old.reponse is distinct from 'oui' or new.camp is distinct from old.camp then
      new.camp := public.tirer_camp(new.event_key);
    end if;
  else
    new.camp := null;
  end if;
  return new;
end $$;
drop trigger if exists event_signups_camp on public.event_signups;
create trigger event_signups_camp before insert or update on public.event_signups
  for each row execute procedure public.event_signups_camp();

-- Réponse à un événement (avec ou sans compte) : renvoie le camp attribué
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
      return json_build_object('statut', 'modifie', 'reponse', r.reponse, 'camp', r.camp);
    end if;
  end if;
  begin
    insert into public.event_signups (event_key, reponse, prenom, nom, classe, email, telephone, user_id)
    values (p_event, p_reponse, trim(p_prenom), trim(p_nom), trim(p_classe), lower(trim(p_email)), nullif(trim(p_telephone), ''), uid)
    returning * into r;
  exception when unique_violation then
    return json_build_object('statut', 'deja');
  end;
  return json_build_object('statut', 'ok', 'reponse', r.reponse, 'camp', r.camp);
end $$;
grant execute on function public.repondre_evenement(text, text, text, text, text, text, text) to anon, authenticated;

-- Compteurs publics, avec le nombre de participants par camp (sans données personnelles)
drop function if exists public.event_counts();
create function public.event_counts()
returns table(event_key text, oui bigint, non bigint, par_camp json) language sql stable security definer set search_path = public as $$
  select s.event_key,
         count(*) filter (where s.reponse = 'oui'),
         count(*) filter (where s.reponse = 'non'),
         coalesce((select json_object_agg(x.camp, x.nb) from (select camp, count(*) nb from public.event_signups where event_key = s.event_key and reponse = 'oui' and camp is not null group by camp) x), '{}'::json)
  from public.event_signups s group by s.event_key;
$$;
grant execute on function public.event_counts() to anon, authenticated;
