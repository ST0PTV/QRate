-- QRate – Funktionen für die App (RPC)
-- Alle sind "security definer" und prüfen Anmeldung und Mitgliedschaft selbst.
-- Fehlermeldungen beginnen mit einem festen Kürzel, das die App übersetzt.

create or replace function public.require_user()
returns uuid language plpgsql stable set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return u;
end $$;

create or replace function public.require_member(h uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.members m
    where m.household_id = h and m.user_id = public.require_user() and m.status = 'active'
  ) then
    raise exception 'no_access';
  end if;
end $$;

-- ---------- Haushalt ----------

create or replace function public.create_household(p_name text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); h uuid;
begin
  insert into public.households (name) values (trim(p_name)) returning id into h;
  insert into public.members (household_id, user_id, display_name, role, status)
  values (h, u, trim(p_display_name), 'admin', 'active');
  return h;
end $$;

-- Einladung: 16 Zeichen, 48 Stunden gültig, einmal verwendbar.
create or replace function public.create_invite(p_household uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); t text; exp timestamptz := now() + interval '48 hours';
begin
  if not public.is_admin(p_household) then raise exception 'admin_only'; end if;
  t := public.random_code(16);
  insert into public.invites (token, household_id, created_by, expires_at) values (t, p_household, u, exp);
  return jsonb_build_object('token', t, 'expires_at', exp);
end $$;

-- Nimmt eine Einladung an. Das neue Mitglied ist "pending", bis ein Admin es bestätigt.
create or replace function public.accept_invite(p_token text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := public.require_user(); inv public.invites; hname text;
begin
  select * into inv from public.invites where token = upper(trim(p_token)) for update;
  if not found or inv.used_at is not null or inv.expires_at < now() then
    raise exception 'invite_invalid';
  end if;
  update public.invites set used_by = u, used_at = now() where token = inv.token;
  insert into public.members (household_id, user_id, display_name, role, status)
  values (inv.household_id, u, trim(p_display_name), 'member', 'pending')
  on conflict (household_id, user_id) do nothing;
  select name into hname from public.households where id = inv.household_id;
  return jsonb_build_object('household_id', inv.household_id, 'household_name', hname);
end $$;

create or replace function public.set_member_status(p_member uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.members; admins int;
begin
  perform public.require_user();
  select * into m from public.members where id = p_member;
  if not found or not public.is_admin(m.household_id) then raise exception 'admin_only'; end if;
  if p_action = 'approve' then
    update public.members set status = 'active' where id = p_member;
  elsif p_action = 'remove' then
    select count(*) into admins from public.members
    where household_id = m.household_id and role = 'admin' and status = 'active';
    if m.role = 'admin' and admins <= 1 then raise exception 'last_admin'; end if;
    delete from public.members where id = p_member;
  else
    raise exception 'bad_action';
  end if;
end $$;

-- ---------- Etiketten ----------

-- Reserviert freie Etiketten mit fortlaufender Nummer und zufälligem Code.
create or replace function public.reserve_labels(p_household uuid, p_kind text, p_count int)
returns setof public.labels language plpgsql security definer set search_path = '' as $$
declare n int; i int; c text; r public.labels;
begin
  perform public.require_member(p_household);
  if p_kind not in ('K', 'O') or p_count not between 1 and 96 then raise exception 'bad_request'; end if;
  -- Sperre pro Haushalt, damit zwei gleichzeitige Aufrufe keine doppelte Nummer ziehen.
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

-- Ordnet ein freies Etikett einer neuen Kiste (K) oder einem neuen Ort (O) zu.
create or replace function public.claim_label(p_code text, p_name text, p_location uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.labels; new_id uuid; nm text := nullif(trim(coalesce(p_name, '')), '');
begin
  perform public.require_user();
  select * into l from public.labels where code = p_code for update;
  if not found or l.household_id not in (select public.my_households()) then raise exception 'no_access'; end if;
  if l.status <> 'free' then raise exception 'label_taken'; end if;
  if l.kind = 'K' then
    insert into public.boxes (household_id, label_code, name, location_id)
    values (l.household_id, l.code, coalesce(nm, 'Kiste K-' || lpad(l.number::text, 4, '0')), p_location)
    returning id into new_id;
  else
    if nm is null then raise exception 'name_required'; end if;
    insert into public.locations (household_id, label_code, name)
    values (l.household_id, l.code, nm) returning id into new_id;
  end if;
  update public.labels set status = 'active' where code = l.code;
  return jsonb_build_object('kind', l.kind, 'id', new_id);
end $$;

-- Sperrt ein Etikett (verloren, beschädigt). Die Kiste bleibt erhalten und kann ein neues bekommen.
create or replace function public.block_label(p_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.labels;
begin
  perform public.require_user();
  select * into l from public.labels where code = p_code;
  if not found or not public.is_admin(l.household_id) then raise exception 'admin_only'; end if;
  update public.labels set status = 'blocked' where code = p_code;
  update public.boxes set label_code = null where label_code = p_code;
  update public.locations set label_code = null where label_code = p_code;
end $$;

-- ---------- Scan ----------

-- Ein Aufruf pro Scan: prüft Mitgliedschaft und Status und liefert alles für die Anzeige.
-- Unbekannte und fremde Codes bekommen dieselbe Antwort, damit sich nichts ausforschen lässt.
create or replace function public.resolve_label(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l public.labels; b public.boxes; loc public.locations;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'signed_out'); end if;
  select * into l from public.labels
  where code = p_code and household_id in (select public.my_households());
  if not found or l.status = 'blocked' then return jsonb_build_object('status', 'denied'); end if;
  if l.status = 'free' then
    return jsonb_build_object('status', 'free', 'kind', l.kind, 'number', l.number, 'code', l.code, 'household_id', l.household_id);
  end if;

  if l.kind = 'K' then
    select * into b from public.boxes where label_code = l.code;
    return jsonb_build_object(
      'status', 'box',
      'box', jsonb_build_object(
        'id', b.id, 'name', b.name, 'number', l.number, 'code', l.code, 'household_id', b.household_id,
        'created_at', b.created_at, 'created_by_name', (select m.display_name from public.members m where m.household_id = b.household_id and m.user_id = b.created_by),
        'location', (select jsonb_build_object('id', o.id, 'name', o.name, 'number', ol.number)
                     from public.locations o left join public.labels ol on ol.code = o.label_code where o.id = b.location_id)),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id, 'name', i.name, 'qty', i.qty, 'note', i.note, 'created_at', i.created_at, 'by', m.display_name)
          order by i.created_at)
        from public.items i
        left join public.members m on m.household_id = i.household_id and m.user_id = i.created_by
        where i.box_id = b.id and i.removed_at is null), '[]'::jsonb));
  end if;

  select * into loc from public.locations where label_code = l.code;
  return jsonb_build_object(
    'status', 'location',
    'location', jsonb_build_object('id', loc.id, 'name', loc.name, 'number', l.number, 'code', l.code, 'household_id', loc.household_id),
    'boxes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'name', x.name, 'number', xl.number,
        'item_count', (select count(*) from public.items i where i.box_id = x.id and i.removed_at is null))
        order by xl.number)
      from public.boxes x left join public.labels xl on xl.code = x.label_code
      where x.location_id = loc.id), '[]'::jsonb));
end $$;

-- ---------- Suche ----------

-- Tippfehlertolerant über Gegenstände und Kistennamen. Läuft mit den Rechten des Aufrufers (RLS greift).
create or replace function public.search(p_household uuid, p_q text)
returns table (kind text, box_id uuid, box_number int, box_name text, location_name text, item_id uuid, item_name text, qty int, score real)
language sql stable set search_path = '' as $$
  with q as (select lower(trim(p_q)) as t)
  select * from (
    select 'item'::text, b.id, l.number, b.name, o.name, i.id, i.name, i.qty,
           greatest(extensions.word_similarity(q.t, lower(i.name)), case when lower(i.name) like '%' || q.t || '%' then 1 else 0 end)::real as score
    from q, public.items i
    join public.boxes b on b.id = i.box_id
    left join public.labels l on l.code = b.label_code
    left join public.locations o on o.id = b.location_id
    where i.household_id = p_household and i.removed_at is null and length(q.t) > 0
      and (lower(i.name) like '%' || q.t || '%' or extensions.word_similarity(q.t, lower(i.name)) > 0.45)
    union all
    select 'box'::text, b.id, l.number, b.name, o.name, null, null, null,
           greatest(extensions.word_similarity(q.t, lower(b.name)), case when lower(b.name) like '%' || q.t || '%' then 1 else 0 end)::real
    from q, public.boxes b
    left join public.labels l on l.code = b.label_code
    left join public.locations o on o.id = b.location_id
    where b.household_id = p_household and length(q.t) > 0
      and (lower(b.name) like '%' || q.t || '%' or extensions.word_similarity(q.t, lower(b.name)) > 0.45)
  ) r
  order by score desc, 3
  limit 50
$$;

-- ---------- Rechte ----------

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_household(text, text), public.create_invite(uuid), public.accept_invite(text, text),
  public.set_member_status(uuid, text), public.reserve_labels(uuid, text, int),
  public.claim_label(text, text, uuid), public.block_label(text), public.resolve_label(text),
  public.search(uuid, text), public.my_households(), public.is_admin(uuid)
to authenticated;
