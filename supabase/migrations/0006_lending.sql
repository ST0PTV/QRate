-- QRate 0006: Ausleihen. Personen, denen man etwas leiht, haben keinen Zugang zur App.
-- Gespeichert wird nur ein Name und auf Wunsch eine Telefonnummer, sichtbar nur für Mitglieder des Haushalts.
-- Wird eine Person gelöscht, bleibt der Ausleih-Verlauf ohne Namen erhalten.

create table public.borrowers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  phone text check (length(phone) <= 40),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);
create index borrowers_household_idx on public.borrowers (household_id, name);

create table public.lendings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  box_id uuid not null references public.boxes (id) on delete cascade,
  borrower_id uuid references public.borrowers (id) on delete set null,
  lent_at timestamptz not null default now(),
  remind_at date,
  returned_at timestamptz,
  note text check (length(note) <= 500),
  created_by uuid not null default auth.uid() references auth.users (id)
);
-- Ein Ding kann nur einmal gleichzeitig verliehen sein
create unique index lendings_open_idx on public.lendings (box_id) where returned_at is null;
create index lendings_household_idx on public.lendings (household_id, returned_at, remind_at);

-- Haushalt aus dem Ding, Ersteller aus der Anmeldung. Orte und Möbel lassen sich nicht verleihen,
-- die Person muss zum selben Haushalt gehören.
create or replace function public.lendings_before_insert()
returns trigger language plpgsql set search_path = '' as $$
declare t text;
begin
  new.created_by := auth.uid();
  new.lent_at := now();
  new.returned_at := null;
  select b.household_id, b.type into new.household_id, t from public.boxes b where b.id = new.box_id;
  if public.thing_group(t) = 'place' then raise exception 'not_lendable'; end if;
  if new.borrower_id is not null and not exists (
    select 1 from public.borrowers p where p.id = new.borrower_id and p.household_id = new.household_id
  ) then
    raise exception 'no_access';
  end if;
  return new;
end $$;
create trigger lendings_before_insert before insert on public.lendings
  for each row execute function public.lendings_before_insert();

-- Verlauf: verliehen und zurück
create or replace function public.log_lending_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare who text := (select p.name from public.borrowers p where p.id = new.borrower_id);
begin
  if tg_op = 'INSERT' then
    insert into public.events (household_id, box_id, actor_id, action, detail)
    values (new.household_id, new.box_id, auth.uid(), 'lent', jsonb_build_object('to', who));
  elsif new.returned_at is not null and old.returned_at is null then
    insert into public.events (household_id, box_id, actor_id, action, detail)
    values (new.household_id, new.box_id, auth.uid(), 'returned', jsonb_build_object('from', who));
  end if;
  return new;
end $$;
create trigger lendings_log after insert or update on public.lendings
  for each row execute function public.log_lending_event();

alter table public.borrowers enable row level security;
alter table public.lendings enable row level security;

create policy borrowers_read on public.borrowers for select to authenticated
  using (household_id in (select public.my_households()));
create policy borrowers_insert on public.borrowers for insert to authenticated
  with check (household_id in (select public.my_households()));
create policy borrowers_update on public.borrowers for update to authenticated
  using (household_id in (select public.my_households()))
  with check (household_id in (select public.my_households()));
create policy borrowers_delete on public.borrowers for delete to authenticated
  using (household_id in (select public.my_households()));

create policy lendings_read on public.lendings for select to authenticated
  using (household_id in (select public.my_households()));
create policy lendings_insert on public.lendings for insert to authenticated
  with check (household_id in (select public.my_households()));
create policy lendings_update on public.lendings for update to authenticated
  using (household_id in (select public.my_households()))
  with check (household_id in (select public.my_households()));

revoke all on public.borrowers, public.lendings from anon, authenticated;
grant select, delete on public.borrowers to authenticated;
grant insert (household_id, name, phone) on public.borrowers to authenticated;
grant update (name, phone) on public.borrowers to authenticated;
grant select on public.lendings to authenticated;
grant insert (box_id, borrower_id, remind_at, note) on public.lendings to authenticated;
grant update (returned_at, remind_at) on public.lendings to authenticated;
