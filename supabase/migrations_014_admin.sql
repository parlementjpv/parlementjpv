-- 014 — L'administrateur peut supprimer ou archiver une élection
alter table public.elections add column if not exists archivee boolean not null default false;

create or replace function public.est_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and not coalesce(banni, false));
$$;

create or replace function public.election_admin(p_election uuid, p_action text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.est_admin() then raise exception 'reserve_admin'; end if;
  if p_action = 'supprimer' then delete from public.elections where id = p_election;
  elsif p_action = 'archiver' then update public.elections set archivee = true where id = p_election;
  elsif p_action = 'desarchiver' then update public.elections set archivee = false where id = p_election;
  else raise exception 'action_invalide'; end if;
  if not found then raise exception 'introuvable'; end if;
end $$;
revoke all on function public.election_admin(uuid, text), public.est_admin() from public, anon;
grant execute on function public.election_admin(uuid, text), public.est_admin() to authenticated;

create or replace function public.elections_liste()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.created_at desc), '[]') from (
    select e.id, e.archivee, e.titre, e.poste, e.description, e.ouverture, e.fermeture, e.created_at, public.election_statut(e) as statut, e.publiee,
      exists (select 1 from public.election_votants v where v.election_id = e.id and v.user_id = auth.uid()) as a_vote,
      (select p.created_at < coalesce(e.ouverture, now()) from public.profiles p where p.id = auth.uid()) as peut_voter,
      (e.blancs + coalesce((select sum(c.voix) from public.election_candidats c where c.election_id = e.id), 0))::int as votants,
      public.election_inscrits(e.id) as inscrits,
      (select json_agg(json_build_object('id', c.id, 'nom', c.nom, 'profession_de_foi', c.profession_de_foi, 'user_id', c.user_id,
          'voix', case when public.election_statut(e) = 'close' and (e.publiee or public.is_bureau()) then c.voix end) order by c.ordre, c.nom)
       from public.election_candidats c where c.election_id = e.id) as candidats,
      case when public.election_statut(e) = 'close' and (e.publiee or public.is_bureau()) then e.blancs end as blancs
    from public.elections e
    where (public.est_membre() and e.statut <> 'brouillon' and not e.archivee) or public.is_bureau()
  ) x;
$$;
