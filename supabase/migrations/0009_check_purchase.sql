-- QRate 0009: Prüfen und Kauf mit Garantie.
-- Prüfen: Wer eine Kiste durchsieht, bestätigt „stimmt so“. Die App merkt sich, wann und von wem.
-- Kauf: Kaufdatum, Preis, Händler, Seriennummer, Garantieende und ein Foto vom Beleg,
-- für ein Ding (z. B. ein Gerät mit eigenem Etikett) oder für einen Gegenstand in einer Kiste.
-- Belege liegen im Bucket box-photos unter <household_id>/receipts/<zufall>.jpg und zählen zur Speichergrenze aus 0008.

-- ---------- Prüfen ----------
alter table public.boxes
  add column checked_at timestamptz,
  add column checked_by uuid references auth.users (id) on delete set null;

-- Zeit und Person setzt der Server. Verlauf nur, wenn die letzte Prüfung über eine Stunde her ist.
create or replace function public.check_thing(p_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare b public.boxes; n int;
begin
  perform public.require_user();
  select * into b from public.boxes where id = p_id for update;
  if not found or b.household_id not in (select public.my_households()) then raise exception 'no_access'; end if;
  update public.boxes set checked_at = now(), checked_by = auth.uid() where id = p_id;
  if b.checked_at is null or b.checked_at < now() - interval '1 hour' then
    select count(*) into n from public.items i where i.box_id = p_id and i.removed_at is null;
    insert into public.events (household_id, box_id, actor_id, action, detail)
    values (b.household_id, b.id, auth.uid(), 'box_checked', jsonb_build_object('items', n));
  end if;
  return now();
end $$;

-- get_thing wie in 0005, dazu checked_at und Name der prüfenden Person
create or replace function public.get_thing(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.boxes; l public.labels;
begin
  select * into b from public.boxes where id = p_id and household_id in (select public.my_households());
  if not found then return null; end if;
  select * into l from public.labels where code = b.label_code;
  return jsonb_build_object(
    'box', jsonb_build_object(
      'id', b.id, 'name', b.name, 'type', b.type, 'note', b.note, 'kind', l.kind, 'number', l.number, 'code', b.label_code,
      'household_id', b.household_id, 'created_at', b.created_at,
      'created_by_name', (select m.display_name from public.members m where m.household_id = b.household_id and m.user_id = b.created_by),
      'checked_at', b.checked_at,
      'checked_by_name', (select m.display_name from public.members m where m.household_id = b.household_id and m.user_id = b.checked_by),
      'parent', (select jsonb_build_object('id', p.id, 'name', p.name, 'type', p.type) from public.boxes p where p.id = b.parent_id),
      'path', (with recursive up as (
          select x.id, x.name, x.type, x.parent_id, 0 as depth from public.boxes x where x.id = b.parent_id
          union all
          select x.id, x.name, x.type, x.parent_id, up.depth + 1 from up join public.boxes x on x.id = up.parent_id where up.depth < 20
        ) select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'type', type) order by depth desc), '[]'::jsonb) from up)),
    'children', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'type', c.type,
        'item_count', (select count(*) from public.items i where i.box_id = c.id and i.removed_at is null),
        'child_count', (select count(*) from public.boxes g where g.parent_id = c.id))
        order by public.thing_group(c.type) = 'place' desc, c.name)
      from public.boxes c where c.parent_id = b.id), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.name, 'qty', i.qty, 'note', i.note, 'created_at', i.created_at, 'by', m.display_name)
        order by i.created_at)
      from public.items i
      left join public.members m on m.household_id = i.household_id and m.user_id = i.created_by
      where i.box_id = b.id and i.removed_at is null), '[]'::jsonb));
end $$;

-- ---------- Kauf und Garantie ----------
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  box_id uuid unique references public.boxes (id) on delete cascade,
  item_id uuid unique references public.items (id) on delete cascade,
  bought_on date,
  price numeric(10, 2) check (price >= 0),
  shop text check (length(shop) <= 80),
  serial text check (length(serial) <= 80),
  warranty_until date,
  receipt_path text unique check (length(receipt_path) <= 200),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint purchases_one_target check ((box_id is null) <> (item_id is null))
);
create index purchases_household_warranty_idx on public.purchases (household_id, warranty_until);

-- Haushalt aus Ding oder Gegenstand; Ziel und Haushalt danach fest; Beleg nur im eigenen Ordner receipts/.
create or replace function public.purchases_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if new.box_id is not null then
      select b.household_id into new.household_id from public.boxes b where b.id = new.box_id;
    else
      select i.household_id into new.household_id from public.items i where i.id = new.item_id;
    end if;
  elsif new.household_id <> old.household_id or new.box_id is distinct from old.box_id
     or new.item_id is distinct from old.item_id or new.created_by is distinct from old.created_by then
    raise exception 'Ziel und Haushalt eines Kaufs sind fest';
  end if;
  if new.receipt_path is not null and new.receipt_path not like new.household_id::text || '/receipts/%' then
    raise exception 'Beleg-Pfad passt nicht zum Haushalt';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger purchases_before_write before insert or update on public.purchases
  for each row execute function public.purchases_before_write();

alter table public.purchases enable row level security;
create policy purchases_read on public.purchases for select to authenticated
  using (household_id in (select public.my_households()));
create policy purchases_insert on public.purchases for insert to authenticated
  with check (household_id in (select public.my_households()));
create policy purchases_update on public.purchases for update to authenticated
  using (household_id in (select public.my_households()))
  with check (household_id in (select public.my_households()));
create policy purchases_delete on public.purchases for delete to authenticated
  using (household_id in (select public.my_households()));

-- ---------- Rechte ----------
revoke all on public.purchases from anon, authenticated;
grant select, delete on public.purchases to authenticated;
grant insert (box_id, item_id, bought_on, price, shop, serial, warranty_until, receipt_path) on public.purchases to authenticated;
grant update (bought_on, price, shop, serial, warranty_until, receipt_path) on public.purchases to authenticated;
revoke execute on function public.check_thing(uuid), public.purchases_before_write() from public, anon;
grant execute on function public.check_thing(uuid) to authenticated;
