-- 027 — Message WhatsApp automatique : à chaque publication, modification ou annulation d'un événement,
-- la fonction whatsapp-annonce envoie au Parlement le texte prêt à poster dans le groupe.
-- Le secret est lu dans le coffre (vault) : select vault.create_secret('<BACKUP_SECRET>', 'backup_secret');
create or replace function public.evenement_whatsapp() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text; v_action text;
begin
  if not new.published then return new; end if;
  if tg_op = 'INSERT' then v_action := 'nouveau';
  elsif not old.published then v_action := 'nouveau';
  elsif new.annule_at is not null and old.annule_at is null then v_action := 'annule';
  elsif new.annule_at is null and (new.title, new.type, new.starts_at, new.ends_at, new.location, new.description, new.camps)
        is distinct from (old.title, old.type, old.starts_at, old.ends_at, old.location, old.description, old.camps) then v_action := 'modifie';
  else return new; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'backup_secret' limit 1;
  if v_secret is null then return new; end if;
  perform net.http_post(url := 'https://waqaeyclhwhnnmvlfoau.supabase.co/functions/v1/whatsapp-annonce',
    headers := jsonb_build_object('x-sauvegarde', v_secret, 'Content-Type', 'application/json'),
    body := jsonb_build_object('id', new.id, 'action', v_action), timeout_milliseconds := 30000);
  return new;
exception when others then return new; -- ne jamais bloquer l'enregistrement de l'événement
end $$;
revoke all on function public.evenement_whatsapp() from public, anon, authenticated;
drop trigger if exists evenement_whatsapp on public.events;
create trigger evenement_whatsapp after insert or update on public.events
  for each row execute function public.evenement_whatsapp();
