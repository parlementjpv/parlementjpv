-- 023 — Classe structurée (niveau + numéro), onglet État (admins), tournoi d'éloquence

-- ── Classe : niveau + numéro ──
alter table public.profiles add column if not exists niveau text check (niveau is null or niveau in ('Seconde', 'Première', 'Terminale', 'Personnel', 'Autre'));
alter table public.profiles add column if not exists classe_num smallint check (classe_num is null or classe_num between 1 and 20);

-- Reprise des classes déjà saisies en texte libre (« 1re 4 », « Terminale », « 2nde3 »…)
update public.profiles set
  niveau = case
    when classe ~* '^\s*(2|seconde|2nde|2de)' then 'Seconde'
    when classe ~* '^\s*(1|premi|1re|1ère)' then 'Première'
    when classe ~* '^\s*(t|term)' then 'Terminale'
    when classe ~* 'personnel|prof|cpe|agent' then 'Personnel'
    when classe is not null and classe <> '' and classe <> '?' then 'Autre' end,
  classe_num = nullif(substring(classe from '(\d{1,2})\s*$'), '')::smallint
where niveau is null and classe is not null and coalesce(nullif(substring(classe from '(\d{1,2})\s*$'), '')::int, 1) between 1 and 20;

create or replace function public.libelle_classe(n text, num smallint)
returns text language sql immutable as $$
  select case when n in ('Seconde', 'Première', 'Terminale') then n || coalesce(' ' || num, '')
              when n = 'Personnel' then 'Personnel du lycée' else coalesce(n, '') end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  tel text := nullif(m->>'telephone', '');
  niv text := case when m->>'niveau' in ('Seconde', 'Première', 'Terminale', 'Personnel', 'Autre') then m->>'niveau' end;
  num smallint := case when (m->>'classe_num') ~ '^\d{1,2}$' and (m->>'classe_num')::int between 1 and 20 then (m->>'classe_num')::smallint end;
  cl text := coalesce(nullif(public.libelle_classe(niv, num), ''), nullif(m->>'classe', ''));
begin
  if tel is not null and tel !~ '^[+0-9 .()-]{8,20}$' then tel := null; end if;
  insert into public.profiles (id, prenom, nom, classe, niveau, classe_num, telephone)
  values (new.id, coalesce(m->>'prenom', ''), coalesce(m->>'nom', ''), cl, niv, num, tel)
  on conflict (id) do nothing;
  insert into public.adhesions (prenom, nom, classe, email, telephone, user_id, interets)
  values (
    coalesce(nullif(m->>'prenom', ''), '?'), coalesce(nullif(m->>'nom', ''), '?'), coalesce(cl, '?'),
    lower(new.email), tel, new.id,
    coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(m->'interets') = 'array' then m->'interets' else '[]'::jsonb end)), '{}')
  )
  on conflict ((lower(email))) do update set user_id = excluded.user_id, telephone = coalesce(public.adhesions.telephone, excluded.telephone);
  return new;
end $$;

-- ── Onglet État (administrateurs) : tous les membres avec leurs indicateurs ──
create or replace function public.etat_membres()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.est_admin() then raise exception 'reserve_aux_admins'; end if;
  return coalesce((select json_agg(json_build_object(
      'id', p.id, 'prenom', p.prenom, 'nom', p.nom, 'classe', p.classe, 'niveau', p.niveau, 'num', p.classe_num,
      'role', p.role, 'poste', p.poste, 'banni', p.banni, 'inscrit', p.created_at,
      'email', coalesce(a.email, u.email), 'telephone', coalesce(p.telephone, a.telephone),
      'seances', (select count(*) from public.presences pr where pr.user_id = p.id and pr.statut = 'present'),
      'absences', public.absences_comptees(p.id),
      'notifs', exists (select 1 from public.push_abonnements x where x.user_id = p.id),
      'signe', exists (select 1 from public.signatures s where s.user_id = p.id),
      'derniere', (select max(e.starts_at) from public.presences pr join public.events e on e.id::text = pr.event_key where pr.user_id = p.id and pr.statut = 'present')
    ) order by p.niveau, p.classe_num, p.nom)
    from public.profiles p left join auth.users u on u.id = p.id left join public.adhesions a on a.user_id = p.id), '[]');
end $$;
revoke all on function public.etat_membres() from public, anon;
grant execute on function public.etat_membres() to authenticated;

-- ── Tournoi d'éloquence (élimination directe) ──
create table if not exists public.tournois (
  id               uuid primary key default gen_random_uuid(),
  nom              text not null check (char_length(nom) between 3 and 120),
  description      text not null default '' check (char_length(description) <= 2000),
  statut           text not null default 'inscriptions' check (statut in ('inscriptions', 'en_cours', 'termine')),
  fin_inscriptions timestamptz,
  max_participants int check (max_participants is null or max_participants between 2 and 64),
  champion         uuid references public.profiles(id) on delete set null,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create table if not exists public.tournoi_inscrits (
  tournoi    uuid not null references public.tournois(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tournoi, user_id)
);
create table if not exists public.tournoi_matchs (
  id       uuid primary key default gen_random_uuid(),
  tournoi  uuid not null references public.tournois(id) on delete cascade,
  tour     int not null check (tour >= 1),
  position int not null check (position >= 0),
  a        uuid references public.profiles(id) on delete set null,
  b        uuid references public.profiles(id) on delete set null,
  sujet    text check (sujet is null or char_length(sujet) <= 300),
  quand    timestamptz,
  lieu     text check (lieu is null or char_length(lieu) <= 120),
  gagnant  uuid references public.profiles(id) on delete set null,
  unique (tournoi, tour, position)
);
alter table public.tournois enable row level security;
alter table public.tournoi_inscrits enable row level security;
alter table public.tournoi_matchs enable row level security;
drop policy if exists "tournois: bureau gère" on public.tournois;
create policy "tournois: bureau gère" on public.tournois for all to authenticated using (public.is_bureau()) with check (public.is_bureau());
drop policy if exists "tournoi matchs: bureau modifie" on public.tournoi_matchs;
create policy "tournoi matchs: bureau modifie" on public.tournoi_matchs for update to authenticated using (public.is_bureau()) with check (public.is_bureau());
-- Lectures publiques et inscriptions : uniquement par les fonctions ci-dessous

create or replace function public.nom_court(u uuid)
returns text language sql stable security definer set search_path = public as $$
  select prenom || ' ' || left(nom, 1) || '.' from public.profiles where id = u;
$$;
revoke all on function public.nom_court(uuid) from public, anon, authenticated;

-- Liste publique des tournois (prénom + initiale seulement)
create or replace function public.tournois_liste()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'id', t.id, 'nom', t.nom, 'description', t.description, 'statut', t.statut, 'fin_inscriptions', t.fin_inscriptions,
    'max', t.max_participants, 'created_at', t.created_at, 'champion', public.nom_court(t.champion),
    'inscrits', (select count(*) from public.tournoi_inscrits i where i.tournoi = t.id),
    'moi_inscrit', exists (select 1 from public.tournoi_inscrits i where i.tournoi = t.id and i.user_id = auth.uid()),
    'participants', case when public.est_membre() or public.is_bureau() then coalesce((select json_agg(json_build_object('id', i.user_id, 'nom', public.nom_court(i.user_id)) order by i.created_at) from public.tournoi_inscrits i where i.tournoi = t.id), '[]') end,
    'matchs', coalesce((select json_agg(json_build_object('id', m.id, 'tour', m.tour, 'position', m.position,
        'a', m.a, 'b', m.b, 'a_nom', public.nom_court(m.a), 'b_nom', public.nom_court(m.b),
        'sujet', m.sujet, 'quand', m.quand, 'lieu', m.lieu, 'gagnant', m.gagnant) order by m.tour, m.position)
      from public.tournoi_matchs m where m.tournoi = t.id), '[]')
  ) order by (t.statut = 'termine'), t.created_at desc), '[]')
  from public.tournois t;
$$;

create or replace function public.tournoi_inscription(p_tournoi uuid, p_inscrire boolean)
returns void language plpgsql security definer set search_path = public as $$
declare t public.tournois;
begin
  if auth.uid() is null or not public.est_membre() then raise exception 'reserve_aux_membres'; end if;
  select * into t from public.tournois where id = p_tournoi for update;
  if not found then raise exception 'introuvable'; end if;
  if t.statut <> 'inscriptions' or (t.fin_inscriptions is not null and t.fin_inscriptions < now()) then raise exception 'inscriptions_closes'; end if;
  if p_inscrire then
    if t.max_participants is not null and (select count(*) from public.tournoi_inscrits where tournoi = p_tournoi) >= t.max_participants then raise exception 'complet'; end if;
    insert into public.tournoi_inscrits (tournoi, user_id) values (p_tournoi, auth.uid()) on conflict do nothing;
  else
    delete from public.tournoi_inscrits where tournoi = p_tournoi and user_id = auth.uid();
  end if;
end $$;

-- Place un vainqueur dans le duel suivant (et propage les qualifiés d'office)
create or replace function public.tournoi_avancer(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.tournoi_matchs; nb_tours int;
begin
  select * into m from public.tournoi_matchs where id = p_match;
  select max(tour) into nb_tours from public.tournoi_matchs where tournoi = m.tournoi;
  if m.tour = nb_tours then
    update public.tournois set statut = case when m.gagnant is null then 'en_cours' else 'termine' end, champion = m.gagnant where id = m.tournoi;
    return;
  end if;
  if m.position % 2 = 0 then
    update public.tournoi_matchs set a = m.gagnant where tournoi = m.tournoi and tour = m.tour + 1 and position = m.position / 2;
  else
    update public.tournoi_matchs set b = m.gagnant where tournoi = m.tournoi and tour = m.tour + 1 and position = m.position / 2;
  end if;
end $$;
revoke all on function public.tournoi_avancer(uuid) from public, anon, authenticated;

-- Tirage au sort : tableau à la puissance de 2 supérieure, qualifiés d'office au premier tour si besoin
create or replace function public.tournoi_tirage(p_tournoi uuid)
returns int language plpgsql security definer set search_path = public as $$
declare ids uuid[]; n int; taille int := 2; tours int := 1; i int; r int; m uuid;
begin
  if not public.is_bureau() then raise exception 'reserve_au_bureau'; end if;
  select array_agg(user_id order by random()) into ids from public.tournoi_inscrits where tournoi = p_tournoi;
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then raise exception 'pas_assez'; end if;
  if (select statut from public.tournois where id = p_tournoi) <> 'inscriptions' then raise exception 'deja_tire'; end if;
  while taille < n loop taille := taille * 2; tours := tours + 1; end loop;
  for r in 1..tours loop
    for i in 0..(taille / (2 ^ r))::int - 1 loop
      insert into public.tournoi_matchs (tournoi, tour, position) values (p_tournoi, r, i);
    end loop;
  end loop;
  -- Premier tour : les qualifiés d'office (exempts) sont répartis pour ne jamais se rencontrer entre eux
  for i in 0..taille / 2 - 1 loop
    update public.tournoi_matchs set a = ids[i + 1], b = case when i + 1 + taille / 2 <= n then ids[i + 1 + taille / 2] end
      where tournoi = p_tournoi and tour = 1 and position = i returning id into m;
    if (select b from public.tournoi_matchs where id = m) is null then
      update public.tournoi_matchs set gagnant = a where id = m;
      perform public.tournoi_avancer(m);
    end if;
  end loop;
  update public.tournois set statut = 'en_cours' where id = p_tournoi;
  return taille;
end $$;

-- Résultat d'un duel (corrigeable tant que le duel suivant n'est pas joué)
create or replace function public.tournoi_resultat(p_match uuid, p_gagnant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.tournoi_matchs; suivant public.tournoi_matchs;
begin
  if not public.is_bureau() then raise exception 'reserve_au_bureau'; end if;
  select * into m from public.tournoi_matchs where id = p_match for update;
  if not found then raise exception 'introuvable'; end if;
  if p_gagnant is not null and p_gagnant not in (m.a, m.b) then raise exception 'pas_dans_le_duel'; end if;
  if m.a is null or m.b is null then raise exception 'duel_incomplet'; end if;
  select * into suivant from public.tournoi_matchs where tournoi = m.tournoi and tour = m.tour + 1 and position = m.position / 2;
  if found and suivant.gagnant is not null then raise exception 'suivant_deja_joue'; end if;
  update public.tournoi_matchs set gagnant = p_gagnant where id = p_match;
  perform public.tournoi_avancer(p_match);
end $$;

revoke all on function public.tournois_liste(), public.tournoi_inscription(uuid, boolean), public.tournoi_tirage(uuid), public.tournoi_resultat(uuid, uuid) from public;
grant execute on function public.tournois_liste() to anon, authenticated;
grant execute on function public.tournoi_inscription(uuid, boolean), public.tournoi_tirage(uuid), public.tournoi_resultat(uuid, uuid) to authenticated;

-- Journal du bureau
create or replace function public.journal_tournoi() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_bureau() then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then perform public.journaliser('Tournoi', 'a créé le tournoi « ' || new.nom || ' »');
  elsif tg_op = 'DELETE' then perform public.journaliser('Tournoi', 'a supprimé le tournoi « ' || old.nom || ' »');
  elsif old.statut <> new.statut then perform public.journaliser('Tournoi', case new.statut when 'en_cours' then 'a lancé le tirage du tournoi « ' when 'termine' then 'a clos le tournoi « ' else 'a rouvert le tournoi « ' end || new.nom || ' »');
  elsif (to_jsonb(old) - 'champion') <> (to_jsonb(new) - 'champion') then perform public.journaliser('Tournoi', 'a modifié le tournoi « ' || new.nom || ' »');
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists journal_tournois on public.tournois;
create trigger journal_tournois after insert or update or delete on public.tournois for each row execute function public.journal_tournoi();

-- Profil d'orateur : tournois gagnés et finales
create or replace function public.tournoi_palmares(p_user uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'gagnes', (select count(*) from public.tournois where champion = p_user),
    'finales', (select count(*) from public.tournoi_matchs m where (m.a = p_user or m.b = p_user) and m.tour = (select max(tour) from public.tournoi_matchs x where x.tournoi = m.tournoi) and m.a is not null and m.b is not null),
    'duels_gagnes', (select count(*) from public.tournoi_matchs where gagnant = p_user and a is not null and b is not null));
$$;
revoke all on function public.tournoi_palmares(uuid) from public, anon;
grant execute on function public.tournoi_palmares(uuid) to authenticated;
