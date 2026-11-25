-- 030 — Réunions du bureau (ordre du jour, notes, décisions, tâches) + rappels des tâches
create table if not exists public.bureau_reunions (
  id            uuid primary key default gen_random_uuid(),
  titre         text not null check (char_length(titre) between 2 and 200),
  quand         timestamptz not null,
  lieu          text check (char_length(lieu) <= 200),
  ordre_du_jour text not null default '' check (char_length(ordre_du_jour) <= 10000),
  notes         text not null default '' check (char_length(notes) <= 50000),
  statut        text not null default 'prevue' check (statut in ('prevue', 'terminee')),
  convoque_at   timestamptz,
  rappel_at     timestamptz,
  cloturee_at   timestamptz,
  created_by    uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
create table if not exists public.bureau_decisions (
  id         uuid primary key default gen_random_uuid(),
  reunion_id uuid references public.bureau_reunions(id) on delete cascade,
  texte      text not null check (char_length(texte) between 2 and 1000),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.bureau_taches add column if not exists reunion_id uuid references public.bureau_reunions(id) on delete set null;
alter table public.bureau_taches add column if not exists rappel_veille_at timestamptz;
alter table public.bureau_taches add column if not exists rappel_retard_at timestamptz;
alter table public.bureau_reunions enable row level security;
alter table public.bureau_decisions enable row level security;
drop policy if exists "bureau: reunions" on public.bureau_reunions;
create policy "bureau: reunions" on public.bureau_reunions for all using (public.is_bureau()) with check (public.is_bureau());
drop policy if exists "bureau: decisions" on public.bureau_decisions;
create policy "bureau: decisions" on public.bureau_decisions for all using (public.is_bureau()) with check (public.is_bureau());
grant select, insert, update, delete on public.bureau_reunions, public.bureau_decisions to authenticated;

-- Alimente le registre (journal) : réunion programmée, décision prise, réunion clôturée
create or replace function public.reunion_journal() returns trigger language plpgsql security definer set search_path = public as $$
declare v_nom text; v_titre text;
begin
  select trim(coalesce(prenom, '') || ' ' || coalesce(nom, '')) into v_nom from public.profiles where id = auth.uid();
  if tg_table_name = 'bureau_decisions' then
    select titre into v_titre from public.bureau_reunions where id = new.reunion_id;
    insert into public.journal (acteur, acteur_nom, categorie, resume)
      values (auth.uid(), coalesce(v_nom, ''), 'Décision', new.texte || coalesce(' (réunion « ' || v_titre || ' »)', ''));
  elsif tg_op = 'INSERT' then
    insert into public.journal (acteur, acteur_nom, categorie, resume)
      values (auth.uid(), coalesce(v_nom, ''), 'Réunion du bureau', 'a programmé la réunion « ' || new.titre || ' » du ' || to_char(new.quand at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24"h"MI'));
  elsif new.statut = 'terminee' and old.statut is distinct from 'terminee' then
    insert into public.journal (acteur, acteur_nom, categorie, resume)
      values (auth.uid(), coalesce(v_nom, ''), 'Réunion du bureau', 'a clôturé la réunion « ' || new.titre || ' »');
  end if;
  return new;
end $$;
drop trigger if exists reunion_journal_ins on public.bureau_reunions;
create trigger reunion_journal_ins after insert on public.bureau_reunions for each row execute function public.reunion_journal();
drop trigger if exists reunion_journal_upd on public.bureau_reunions;
create trigger reunion_journal_upd after update of statut on public.bureau_reunions for each row execute function public.reunion_journal();
drop trigger if exists decision_journal on public.bureau_decisions;
create trigger decision_journal after insert on public.bureau_decisions for each row execute function public.reunion_journal();
-- Rappels du bureau (tâches à échéance, en retard, réunion du lendemain) : tous les jours à 7h13 UTC
-- select cron.schedule('bureau-rappels', '13 7 * * *', $$select net.http_post(url := '<SUPABASE_URL>/functions/v1/bureau-rappels', headers := '{"x-sauvegarde": "<BACKUP_SECRET>", "Content-Type": "application/json"}'::jsonb, body := '{}'::jsonb, timeout_milliseconds := 60000)$$);
