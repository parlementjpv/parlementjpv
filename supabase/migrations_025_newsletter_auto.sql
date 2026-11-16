-- 025 — Newsletter : à l'inscription, l'abonnement est confirmé en même temps que l'adresse email (plus d'email séparé)
create or replace function public.newsletter_a_confirmation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null
     and coalesce((new.raw_user_meta_data->>'newsletter')::boolean, false) then
    insert into public.newsletter_subscribers (email, confirmed, confirmed_at)
    values (lower(new.email), true, now())
    on conflict (email) do update set confirmed = true, confirmed_at = coalesce(public.newsletter_subscribers.confirmed_at, now()), unsubscribed_at = null;
    update public.profiles set newsletter = true where id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists newsletter_a_confirmation on auth.users;
create trigger newsletter_a_confirmation after update of email_confirmed_at on auth.users for each row execute function public.newsletter_a_confirmation();
