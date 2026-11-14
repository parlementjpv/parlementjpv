-- 009 — Annonce des séances, places par camp, annulation
alter table public.events add column if not exists places_par_camp int check (places_par_camp is null or places_par_camp > 0);
alter table public.events add column if not exists annonce_at timestamptz;
alter table public.events add column if not exists annule_at timestamptz;
alter table public.events add column if not exists annule_motif text check (char_length(annule_motif) <= 1000);

-- Tirage au sort parmi les camps les moins remplis qui ont encore de la place
create or replace function public.tirer_camp(p_event text)
returns text language sql volatile security definer set search_path = public as $$
  with e as (select camps, places_par_camp from public.events where id::text = p_event),
  c as (select unnest(e.camps) as camp from e),
  n as (select c.camp, (select count(*) from public.event_signups s where s.event_key = p_event and s.reponse = 'oui' and s.camp = c.camp) as nb from c),
  libres as (select * from n where (select places_par_camp from e) is null or nb < (select places_par_camp from e))
  select camp from libres where nb = (select min(nb) from libres) order by random() limit 1;
$$;

create or replace function public.event_signups_camp()
returns trigger language plpgsql security definer set search_path = public as $$
declare ev public.events;
begin
  select * into ev from public.events where id::text = new.event_key;
  if new.reponse = 'oui' then
    if ev.annule_at is not null then raise exception 'evenement_annule'; end if;
    if tg_op = 'INSERT' or old.reponse is distinct from 'oui' or new.camp is distinct from old.camp then
      if coalesce(cardinality(ev.camps), 0) > 0 then
        new.camp := public.tirer_camp(new.event_key);
        if new.camp is null then raise exception 'camps_complets'; end if;
      else
        new.camp := null;
      end if;
    end if;
  else
    new.camp := null;
  end if;
  return new;
end $$;

create or replace function public.repondre_evenement(
  p_event text, p_reponse text, p_prenom text, p_nom text, p_classe text, p_email text, p_telephone text default null)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r public.event_signups;
begin
  if p_reponse not in ('oui', 'non') then raise exception 'reponse invalide'; end if;
  if not exists (select 1 from public.events where id::text = p_event and published) then raise exception 'evenement introuvable'; end if;
  if exists (select 1 from public.events where id::text = p_event and annule_at is not null) then return json_build_object('statut', 'annule'); end if;
  begin
    if uid is not null then
      select * into r from public.event_signups where event_key = p_event and user_id = uid;
      if found then
        update public.event_signups set reponse = p_reponse where id = r.id returning * into r;
        return json_build_object('statut', 'modifie', 'reponse', r.reponse, 'camp', r.camp, 'jeton', r.jeton);
      end if;
    end if;
    insert into public.event_signups (event_key, reponse, prenom, nom, classe, email, telephone, user_id)
    values (p_event, p_reponse, trim(p_prenom), trim(p_nom), trim(p_classe), lower(trim(p_email)), nullif(trim(p_telephone), ''), uid)
    returning * into r;
  exception
    when unique_violation then return json_build_object('statut', 'deja');
    when raise_exception then
      if sqlerrm = 'camps_complets' then return json_build_object('statut', 'complet'); end if;
      raise;
  end;
  return json_build_object('statut', 'ok', 'reponse', r.reponse, 'camp', r.camp, 'jeton', r.jeton);
end $$;
