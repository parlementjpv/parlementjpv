-- 031 — Sondages : qui a répondu / qui n'a pas répondu (bureau), relance automatique des retardataires
alter table public.sondages add column if not exists relance_at timestamptz;
create or replace function public.sondage_participation(p_id uuid)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', p.id, 'prenom', p.prenom, 'nom', p.nom, 'classe', coalesce(p.classe, ''), 'a_repondu', r.user_id is not null, 'quand', r.created_at)
    order by (r.user_id is not null), p.nom, p.prenom), '[]')
  from (select distinct user_id from public.adhesions where user_id is not null) a
  join public.profiles p on p.id = a.user_id and not coalesce(p.banni, false)
  left join public.sondage_reponses r on r.sondage = p_id and r.user_id = p.id
  where public.is_bureau();
$$;
revoke all on function public.sondage_participation(uuid) from public, anon;
grant execute on function public.sondage_participation(uuid) to authenticated;
