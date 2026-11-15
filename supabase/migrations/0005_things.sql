-- QRate 0005: neutrale Etiketten und Typen. Alles mit Etikett ist jetzt ein „Ding“ in public.boxes:
-- Orte und Möbel (Raum, Regal, Ebene …), Behälter (Kiste, Koffer …) und Einzelstücke (Gerät, Möbel …).
-- Jedes Ding kann in einem anderen stecken (parent_id), z. B. Keller › Lastenregal › Ebene oben › Kiste.
-- Die bisherigen Orte werden mit gleicher ID zu Dingen vom Typ „room“, Kisten behalten Typ „box“.
-- Neue Etiketten haben die Art Q (neutral); der Typ wird erst beim ersten Scan gewählt.

-- ---------- Typen ----------
create or replace function public.thing_group(t text)
returns text language sql immutable set search_path = '' as $$
  select case
    when t in ('room', 'rack', 'cabinet', 'shelf', 'drawer', 'pegboard') then 'place'
    when t in ('box', 'bin', 'case', 'sack', 'folder', 'clothes') then 'container'
    when t in ('thing', 'tool', 'furniture', 'vehicle') then 'single'
  end
$$;

-- ---------- Etiketten: neutrale Art Q ----------
alter table public.labels drop constraint labels_kind_check;
alter table public.labels add constraint labels_kind_check check (kind in ('K', 'O', 'Q'));

-- ---------- Dinge ----------
alter table public.boxes
  add column type text not null default 'box',
  add column parent_id uuid references public.boxes (id) on delete set null,
  add column note text check (length(note) <= 500),
  add constraint boxes_type_check check (public.thing_group(type) is not null),
  add constraint boxes_not_own_parent check (parent_id <> id);
create index boxes_parent_idx on public.boxes (parent_id);

-- Orte übernehmen, ohne dabei Verlauf zu erzeugen
drop trigger boxes_log on public.boxes;
drop trigger boxes_before_write on public.boxes;
insert into public.boxes (id, household_id, label_code, name, type, created_by, created_at, updated_at)
  select id, household_id, label_code, name, 'room', created_by, created_at, updated_at from public.locations;
update public.boxes b set parent_id = l.parent_id from public.locations l where l.id = b.id and l.parent_id is not null;
update public.boxes set parent_id = location_id where location_id is not null;
alter table public.boxes drop column location_id;
drop table public.locations;
drop function public.locations_before_write();

-- Haushalt und Ersteller fest; das übergeordnete Ding muss im selben Haushalt liegen, darf kein Einzelstück sein
-- und darf nicht im Ding selbst stecken.
create or replace function public.boxes_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  elsif new.household_id <> old.household_id or new.created_by <> old.created_by then
    raise exception 'Haushalt, Etikett und Ersteller sind fest';
  end if;
  if new.parent_id is not null then
    if not exists (select 1 from public.boxes p where p.id = new.parent_id and p.household_id = new.household_id) then
      raise exception 'Ort gehört nicht zum Haushalt';
    end if;
    if (select public.thing_group(p.type) from public.boxes p where p.id = new.parent_id) = 'single' then
      raise exception 'parent_single';
    end if;
    if tg_op = 'UPDATE' and exists (
      with recursive up as (
        select p.id, p.parent_id from public.boxes p where p.id = new.parent_id
        union all
        select p.id, p.parent_id from public.boxes p join up on p.id = up.parent_id
      ) select 1 from up where up.id = new.id
    ) then
      raise exception 'cycle';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger boxes_before_write before insert or update on public.boxes
  for each row execute function public.boxes_before_write();

create or replace function public.log_box_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.events (household_id, box_id, actor_id, action, detail)
    values (new.household_id, new.id, auth.uid(), 'box_created', jsonb_build_object('name', new.name, 'type', new.type));
  else
    if new.parent_id is distinct from old.parent_id then
      insert into public.events (household_id, box_id, actor_id, action, detail)
      values (new.household_id, new.id, auth.uid(), 'box_moved', jsonb_build_object(
        'to', (select p.name from public.boxes p where p.id = new.parent_id)));
    end if;
    if new.name <> old.name then
      insert into public.events (household_id, box_id, actor_id, action, detail)
      values (new.household_id, new.id, auth.uid(), 'box_renamed', jsonb_build_object('name', new.name, 'from', old.name));
    end if;
    if new.type <> old.type then
      insert into public.events (household_id, box_id, actor_id, action, detail)
      values (new.household_id, new.id, auth.uid(), 'box_retyped', jsonb_build_object('type', new.type, 'from', old.type));
    end if;
  end if;
  return new;
end $$;
create trigger boxes_log after insert or update on public.boxes
  for each row execute function public.log_box_event();

-- ---------- Gegenstände dürfen umziehen (innerhalb des Haushalts) ----------
create or replace function public.items_before_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.household_id <> old.household_id or new.created_by <> old.created_by then
    raise exception 'Haushalt und Ersteller eines Gegenstands sind fest';
  end if;
  if new.box_id <> old.box_id and not exists (
    select 1 from public.boxes b where b.id = new.box_id and b.household_id = old.household_id
  ) then
    raise exception 'Ort gehört nicht zum Haushalt';
  end if;
  if new.box_id <> old.box_id and (select public.thing_group(b.type) from public.boxes b where b.id = new.box_id) = 'single' then
    raise exception 'parent_single';
  end if;
  if new.removed_at is not null and old.removed_at is null then new.removed_by := auth.uid(); end if;
  if new.removed_at is null then new.removed_by := null; end if;
  new.updated_at := now();
  return new;
end $$;

-- Neue Gegenstände nur in Orte und Behälter, nicht in Einzelstücke
create or replace function public.items_before_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_by := auth.uid();
  select b.household_id into new.household_id from public.boxes b where b.id = new.box_id;
  if (select public.thing_group(b.type) from public.boxes b where b.id = new.box_id) = 'single' then
    raise exception 'parent_single';
  end if;
  return new;
end $$;

create or replace function public.log_item_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a text;
begin
  if tg_op = 'INSERT' then a := 'item_added';
  elsif new.box_id <> old.box_id then a := 'item_moved';
    update public.item_photos set box_id = new.box_id where item_id = new.id;
  elsif new.removed_at is not null and old.removed_at is null then a := 'item_removed';
  elsif new.removed_at is null and old.removed_at is not null then a := 'item_restored';
  elsif new.name <> old.name or new.qty <> old.qty then a := 'item_changed';
  else return new;
  end if;
  insert into public.events (household_id, box_id, actor_id, action, detail)
  values (new.household_id, new.box_id, auth.uid(), a, jsonb_build_object('item_id', new.id, 'name', new.name, 'qty', new.qty));
  return new;
end $$;

-- ---------- Funktionen ----------
create or replace function public.reserve_labels(p_household uuid, p_kind text, p_count int)
returns setof public.labels language plpgsql security definer set search_path = '' as $$
declare n int; i int; c text; r public.labels;
begin
  perform public.require_member(p_household);
  if p_kind not in ('K', 'O', 'Q') or p_count not between 1 and 96 then raise exception 'bad_request'; end if;
  perform 1 from public.households where id = p_household for update;
  select coalesce(max(number), 0) into n from public.labels where household_id = p_household and kind = p_kind;
  for i in 1 .. p_count loop
    loop
      c := public.random_code(8);
      exit when not exists (select 1 from public.labels where code = c);
    end loop;
    insert into public.labels (code, household_id, kind, number) values (c, p_household, p_kind, n + i)
    returning * into r;
    return next r;
  end loop;
end $$;

-- Freies Etikett einem neuen Ding zuordnen. K-Etiketten sind ohne Angabe eine Kiste, O-Etiketten ein Raum,
-- neutrale Q-Etiketten brauchen einen Typ.
drop function public.claim_label(text, text, uuid);
create or replace function public.claim_label(p_code text, p_name text, p_type text default null, p_parent uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.labels; new_id uuid; t text; nm text := nullif(trim(coalesce(p_name, '')), '');
begin
  perform public.require_user();
  select * into l from public.labels where code = p_code for update;
  if not found or l.household_id not in (select public.my_households()) then raise exception 'no_access'; end if;
  if l.status <> 'free' then raise exception 'label_taken'; end if;
  t := coalesce(p_type, case l.kind when 'K' then 'box' when 'O' then 'room' end);
  if public.thing_group(t) is null then raise exception 'bad_request'; end if;
  if p_parent is not null and not exists (select 1 from public.boxes p where p.id = p_parent and p.household_id = l.household_id) then
    raise exception 'no_access';
  end if;
  insert into public.boxes (household_id, label_code, name, type, parent_id)
  values (l.household_id, l.code, coalesce(nm, case l.kind
      when 'K' then 'Kiste K-' || lpad(l.number::text, 4, '0')
      when 'O' then 'Ort O-' || lpad(l.number::text, 3, '0')
      else '#' || lpad(l.number::text, 4, '0') end), t, p_parent)
  returning id into new_id;
  update public.labels set status = 'active' where code = l.code;
  return jsonb_build_object('kind', l.kind, 'id', new_id, 'type', t);
end $$;

create or replace function public.block_label(p_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.labels;
begin
  perform public.require_user();
  select * into l from public.labels where code = p_code;
  if not found or not public.is_admin(l.household_id) then raise exception 'admin_only'; end if;
  update public.labels set status = 'blocked' where code = p_code;
  update public.boxes set label_code = null where label_code = p_code;
end $$;

-- Pfad über einem Ding, z. B. „Keller › Lastenregal › Ebene oben“ (ohne das Ding selbst). Läuft mit den Rechten des Aufrufers.
create or replace function public.thing_path(p_id uuid)
returns text language sql stable set search_path = '' as $$
  with recursive up as (
    select b.parent_id, 0 as depth from public.boxes b where b.id = p_id
    union all
    select p.parent_id, up.depth + 1 from up join public.boxes p on p.id = up.parent_id where up.depth < 20
  )
  select string_agg(p.name, ' › ' order by up.depth desc)
  from up join public.boxes p on p.id = up.parent_id
$$;

-- Alles für die Ansicht eines Dings: Kopf, Pfad, was darin steckt, Gegenstände. Nur für Mitglieder, sonst null.
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

-- Ein Aufruf pro Scan. Unbekannte und fremde Codes bekommen dieselbe Antwort.
create or replace function public.resolve_label(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l public.labels; id uuid;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'signed_out'); end if;
  select * into l from public.labels
  where code = p_code and household_id in (select public.my_households());
  if not found or l.status = 'blocked' then return jsonb_build_object('status', 'denied'); end if;
  if l.status = 'free' then
    return jsonb_build_object('status', 'free', 'kind', l.kind, 'number', l.number, 'code', l.code, 'household_id', l.household_id);
  end if;
  select b.id into id from public.boxes b where b.label_code = l.code;
  if id is null then return jsonb_build_object('status', 'denied'); end if;
  return jsonb_build_object('status', 'box') || public.get_thing(id);
end $$;

-- Typ ändern. Wird ein Behälter oder Ort zum Einzelstück, wandern Inhalt und darin steckende Dinge eine Ebene höher.
create or replace function public.change_type(p_id uuid, p_type text)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.boxes;
begin
  perform public.require_user();
  select * into b from public.boxes where id = p_id for update;
  if not found or b.household_id not in (select public.my_households()) then raise exception 'no_access'; end if;
  if public.thing_group(p_type) is null then raise exception 'bad_request'; end if;
  if public.thing_group(p_type) = 'single' and (
    exists (select 1 from public.items i where i.box_id = p_id) or exists (select 1 from public.boxes c where c.parent_id = p_id)
  ) then
    if b.parent_id is null then raise exception 'type_needs_parent'; end if;
    update public.items set box_id = b.parent_id where box_id = p_id;
    update public.boxes set parent_id = b.parent_id where parent_id = p_id;
  end if;
  update public.boxes set type = p_type where id = p_id;
end $$;

-- Suche mit Pfad statt Ortsname
drop function public.search(uuid, text);
create or replace function public.search(p_household uuid, p_q text)
returns table (kind text, box_id uuid, box_number int, box_name text, box_type text, location_name text, item_id uuid, item_name text, qty int, score real)
language sql stable set search_path = '' as $$
  with q as (select lower(trim(p_q)) as t)
  select * from (
    select 'item'::text, b.id, l.number, b.name, b.type, public.thing_path(b.id), i.id, i.name, i.qty,
           greatest(extensions.word_similarity(q.t, lower(i.name)), case when lower(i.name) like '%' || q.t || '%' then 1 else 0 end)::real as score
    from q, public.items i
    join public.boxes b on b.id = i.box_id
    left join public.labels l on l.code = b.label_code
    where i.household_id = p_household and i.removed_at is null and length(q.t) > 0
      and (lower(i.name) like '%' || q.t || '%' or extensions.word_similarity(q.t, lower(i.name)) > 0.45)
    union all
    select 'box'::text, b.id, l.number, b.name, b.type, public.thing_path(b.id), null, null, null,
           greatest(extensions.word_similarity(q.t, lower(b.name)), case when lower(b.name) like '%' || q.t || '%' then 1 else 0 end)::real
    from q, public.boxes b
    left join public.labels l on l.code = b.label_code
    where b.household_id = p_household and length(q.t) > 0
      and (lower(b.name) like '%' || q.t || '%' or extensions.word_similarity(q.t, lower(b.name)) > 0.45)
  ) r
  order by score desc, 3
  limit 50
$$;

-- ---------- Rechte ----------
revoke update on public.boxes from authenticated;
grant update (name, parent_id, note) on public.boxes to authenticated;
grant update (box_id) on public.items to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_household(text, text), public.create_invite(uuid), public.accept_invite(text, text),
  public.set_member_status(uuid, text), public.reserve_labels(uuid, text, int),
  public.claim_label(text, text, text, uuid), public.block_label(text), public.resolve_label(text),
  public.get_thing(uuid), public.change_type(uuid, text), public.thing_path(uuid), public.thing_group(text),
  public.search(uuid, text), public.my_households(), public.is_admin(uuid)
to authenticated;
