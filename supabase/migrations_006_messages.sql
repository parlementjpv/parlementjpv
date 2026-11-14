-- 006 — Historique des messages envoyés par le bureau aux membres
create table if not exists public.member_messages (
  id          uuid primary key default gen_random_uuid(),
  subject     text not null check (char_length(subject) between 1 and 200),
  body        text not null check (char_length(body) between 1 and 10000),
  recipients  text[] not null default '{}',
  sent_count  int not null default 0,
  sender_id   uuid references public.profiles(id) on delete set null,
  sender_name text,
  created_at  timestamptz not null default now()
);
alter table public.member_messages enable row level security;
drop policy if exists "messages membres: bureau lit" on public.member_messages;
create policy "messages membres: bureau lit" on public.member_messages for select using (public.is_bureau());
-- écriture uniquement par la fonction serveur (service role)
