-- Kistenwerk – Schema 1
-- Alles hängt an household_id. Lesen und Schreiben regelt Row-Level-Security über my_households().
-- Funktionen mit "security definer" prüfen die Mitgliedschaft selbst, weil sie RLS umgehen.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------- Hilfsfunktionen ----------

-- Zufallscode in Crockford-Base32 (ohne I, L, O, U). Quelle: gen_random_uuid() nutzt einen starken Zufallsgenerator.
-- Je UUID nur die Bytes ohne Versions- und Variantenbits (0–5, 9–15).
create or replace function public.random_code(n int)
returns text language plpgsql volatile set search_path = '' as $$
declare
  alph constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  b bytea := ''::bytea;
  u bytea;
  res text := '';
  i int;
begin
  while length(b) < n loop
    u := uuid_send(gen_random_uuid());
    b := b || substring(u from 1 for 6) || substring(u from 10 for 7);
  end loop;
  for i in 0 .. n - 1 loop
    res := res || substr(alph, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return res;
end $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- Tabellen ----------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 40),
  role text not null default 'member' check (role in ('admin', 'member', 'guest')),
  status text not null default 'pending' check (status in ('active', 'pending')),
  created_at timestamptz not null default now(),
  unique (household_id, user_id)
);
create index members_user_idx on public.members (user_id, household_id) where status = 'active';

create table public.invites (
  token text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz
);

create table public.labels (
  code text primary key check (code ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  household_id uuid not null references public.households (id) on delete cascade,
  kind text not null check (kind in ('K', 'O')),
  number int not null check (number > 0),
  status text not null default 'free' check (status in ('free', 'active', 'blocked')),
  created_at timestamptz not null default now(),
  unique (household_id, kind, number)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  label_code text unique references public.labels (code) on delete set null,
  name text not null check (length(name) between 1 and 80),
  parent_id uuid references public.locations (id) on delete set null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index locations_household_idx on public.locations (household_id);

create table public.boxes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  label_code text unique references public.labels (code) on delete set null,
  name text not null check (length(name) between 1 and 80),
  location_id uuid references public.locations (id) on delete set null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index boxes_household_idx on public.boxes (household_id);
create index boxes_location_idx on public.boxes (location_id);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  box_id uuid not null references public.boxes (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  qty int not null default 1 check (qty between 1 and 99999),
  note text check (length(note) <= 500),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users (id)
);
create index items_box_active_idx on public.items (box_id, created_at) where removed_at is null;
create index items_name_trgm_idx on public.items using gin (name extensions.gin_trgm_ops) where removed_at is null;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  box_id uuid references public.boxes (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index events_box_idx on public.events (box_id, at desc);
create index events_household_idx on public.events (household_id, at desc);

-- ---------- Mitgliedschaft ----------

-- Liefert die Haushalte des angemeldeten Nutzers. In Policies als "(select …)" verwendet,
-- damit Postgres sie einmal pro Abfrage auswertet statt einmal pro Zeile.
create or replace function public.my_households()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.household_id from public.members m
  where m.user_id = auth.uid() and m.status = 'active'
$$;

create or replace function public.is_admin(h uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.household_id = h and m.user_id = auth.uid() and m.status = 'active' and m.role = 'admin'
  )
$$;

-- ---------- Konsistenz-Trigger ----------

-- Ersteller immer aus der Anmeldung, Haushalt der Gegenstände immer aus ihrer Kiste.
create or replace function public.items_before_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_by := auth.uid();
  select b.household_id into new.household_id from public.boxes b where b.id = new.box_id;
  return new;
end $$;
create trigger items_before_insert before insert on public.items
  for each row execute function public.items_before_insert();

create or replace function public.items_before_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.box_id <> old.box_id or new.household_id <> old.household_id or new.created_by <> old.created_by then
    raise exception 'Kiste, Haushalt und Ersteller eines Gegenstands sind fest';
  end if;
  if new.removed_at is not null and old.removed_at is null then new.removed_by := auth.uid(); end if;
  if new.removed_at is null then new.removed_by := null; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger items_before_update before update on public.items
  for each row execute function public.items_before_update();

create or replace function public.boxes_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  elsif new.household_id <> old.household_id or new.created_by <> old.created_by
     then
    raise exception 'Haushalt, Etikett und Ersteller einer Kiste sind fest';
  end if;
  if new.location_id is not null and not exists (
    select 1 from public.locations l where l.id = new.location_id and l.household_id = new.household_id
  ) then
    raise exception 'Ort gehört nicht zum Haushalt';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger boxes_before_write before insert or update on public.boxes
  for each row execute function public.boxes_before_write();

create or replace function public.locations_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  elsif new.household_id <> old.household_id or new.created_by <> old.created_by
     then
    raise exception 'Haushalt, Etikett und Ersteller eines Orts sind fest';
  end if;
  if new.parent_id is not null and not exists (
    select 1 from public.locations l where l.id = new.parent_id and l.household_id = new.household_id
  ) then
    raise exception 'Übergeordneter Ort gehört nicht zum Haushalt';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger locations_before_write before insert or update on public.locations
  for each row execute function public.locations_before_write();

-- ---------- Verlauf ----------

create or replace function public.log_item_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a text;
begin
  if tg_op = 'INSERT' then a := 'item_added';
  elsif new.removed_at is not null and old.removed_at is null then a := 'item_removed';
  elsif new.removed_at is null and old.removed_at is not null then a := 'item_restored';
  elsif new.name <> old.name or new.qty <> old.qty then a := 'item_changed';
  else return new;
  end if;
  insert into public.events (household_id, box_id, actor_id, action, detail)
  values (new.household_id, new.box_id, auth.uid(), a, jsonb_build_object('item_id', new.id, 'name', new.name, 'qty', new.qty));
  return new;
end $$;
create trigger items_log after insert or update on public.items
  for each row execute function public.log_item_event();

create or replace function public.log_box_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.events (household_id, box_id, actor_id, action, detail)
    values (new.household_id, new.id, auth.uid(), 'box_created', jsonb_build_object('name', new.name));
  elsif new.location_id is distinct from old.location_id then
    insert into public.events (household_id, box_id, actor_id, action, detail)
    values (new.household_id, new.id, auth.uid(), 'box_moved', jsonb_build_object(
      'to', (select l.name from public.locations l where l.id = new.location_id)));
  elsif new.name <> old.name then
    insert into public.events (household_id, box_id, actor_id, action, detail)
    values (new.household_id, new.id, auth.uid(), 'box_renamed', jsonb_build_object('name', new.name, 'from', old.name));
  end if;
  return new;
end $$;
create trigger boxes_log after insert or update on public.boxes
  for each row execute function public.log_box_event();

-- ---------- Row-Level-Security ----------

alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.labels enable row level security;
alter table public.locations enable row level security;
alter table public.boxes enable row level security;
alter table public.items enable row level security;
alter table public.events enable row level security;

create policy households_read on public.households for select to authenticated
  using (id in (select public.my_households()));
create policy households_rename on public.households for update to authenticated
  using (public.is_admin(id)) with check (public.is_admin(id));

-- Eigene Zeile immer sichtbar (auch "pending"), sonst nur Mitglieder des eigenen Haushalts.
create policy members_read on public.members for select to authenticated
  using (user_id = (select auth.uid()) or household_id in (select public.my_households()));

-- Etiketten, Einladungen und Mitgliedschaften werden nur über die Funktionen unten geschrieben.
create policy labels_read on public.labels for select to authenticated
  using (household_id in (select public.my_households()));

create policy locations_read on public.locations for select to authenticated
  using (household_id in (select public.my_households()));
create policy locations_update on public.locations for update to authenticated
  using (household_id in (select public.my_households()))
  with check (household_id in (select public.my_households()));
create policy locations_delete on public.locations for delete to authenticated
  using (public.is_admin(household_id));

create policy boxes_read on public.boxes for select to authenticated
  using (household_id in (select public.my_households()));
create policy boxes_update on public.boxes for update to authenticated
  using (household_id in (select public.my_households()))
  with check (household_id in (select public.my_households()));
create policy boxes_delete on public.boxes for delete to authenticated
  using (public.is_admin(household_id));

create policy items_read on public.items for select to authenticated
  using (household_id in (select public.my_households()));
create policy items_insert on public.items for insert to authenticated
  with check (household_id in (select public.my_households()));
create policy items_update on public.items for update to authenticated
  using (household_id in (select public.my_households()))
  with check (household_id in (select public.my_households()));

create policy events_read on public.events for select to authenticated
  using (household_id in (select public.my_households()));

-- Supabase vergibt standardmäßig alle Rechte an anon/authenticated; hier auf das Nötige zurückschneiden.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.households, public.members, public.labels, public.locations,
  public.boxes, public.items, public.events to authenticated;
grant update (name) on public.households to authenticated;
grant update (name, parent_id) on public.locations to authenticated;
grant update (name, location_id) on public.boxes to authenticated;
grant insert (box_id, name, qty, note) on public.items to authenticated;
grant update (name, qty, note, removed_at) on public.items to authenticated;
grant delete on public.locations, public.boxes to authenticated;
