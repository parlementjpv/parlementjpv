-- 024 — On ne peut plus rejoindre l'instance sans compte : seule l'inscription (compte) crée une adhésion
drop policy if exists "adhesion: publique" on public.adhesions;
drop policy if exists "adhesion: son compte" on public.adhesions;
create policy "adhesion: son compte" on public.adhesions for insert to authenticated with check (user_id = auth.uid());
