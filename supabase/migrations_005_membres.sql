-- 005 — Téléphone, compte = membre de l'instance, bannissement, archives des candidatures

-- Téléphone (format souple : chiffres, espaces, + . - ( ), 8 à 20 caractères)
alter table public.profiles       add column if not exists telephone text check (telephone is null or telephone ~ '^[+0-9 .()-]{8,20}$');
alter table public.adhesions      add column if not exists telephone text check (telephone is null or telephone ~ '^[+0-9 .()-]{8,20}$');
alter table public.event_signups  add column if not exists telephone text check (telephone is null or telephone ~ '^[+0-9 .()-]{8,20}$');

-- Bannissement (le blocage réel est fait par Supabase Auth ; cette colonne sert à l'affichage)
alter table public.profiles add column if not exists banni boolean not null default false;

-- Date de décision (pour trier les archives)
alter table public.candidatures add column if not exists decided_at timestamptz;

-- À la création d'un compte : profil + adhésion automatique à l'instance
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  tel text := nullif(m->>'telephone', '');
begin
  if tel is not null and tel !~ '^[+0-9 .()-]{8,20}$' then tel := null; end if;
  insert into public.profiles (id, prenom, nom, classe, telephone)
  values (new.id, coalesce(m->>'prenom', ''), coalesce(m->>'nom', ''), nullif(m->>'classe', ''), tel)
  on conflict (id) do nothing;
  insert into public.adhesions (prenom, nom, classe, email, telephone, user_id, interets)
  values (
    coalesce(nullif(m->>'prenom', ''), '?'), coalesce(nullif(m->>'nom', ''), '?'), coalesce(nullif(m->>'classe', ''), '?'),
    lower(new.email), tel, new.id,
    coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(m->'interets') = 'array' then m->'interets' else '[]'::jsonb end)), '{}')
  )
  on conflict ((lower(email))) do update set user_id = excluded.user_id, telephone = coalesce(public.adhesions.telephone, excluded.telephone);
  return new;
end $$;

-- Rattrapage : les comptes existants deviennent membres
insert into public.adhesions (prenom, nom, classe, email, telephone, user_id)
select coalesce(nullif(p.prenom,''),'?'), coalesce(nullif(p.nom,''),'?'), coalesce(nullif(p.classe,''),'?'), lower(u.email), p.telephone, u.id
from auth.users u join public.profiles p on p.id = u.id
on conflict ((lower(email))) do update set user_id = excluded.user_id;

-- Un membre peut mettre à jour sa propre fiche d'adhésion (téléphone, classe…)
drop policy if exists "adhesion: mise à jour" on public.adhesions;
create policy "adhesion: mise à jour" on public.adhesions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Un utilisateur ne peut pas se « débannir » lui-même via son profil
drop policy if exists "profil: modification soi-même" on public.profiles;
create policy "profil: modification soi-même" on public.profiles for update using (auth.uid() = id)
  with check (auth.uid() = id
    and role  = (select role  from public.profiles where id = auth.uid())
    and banni = (select banni from public.profiles where id = auth.uid()));
