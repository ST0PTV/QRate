-- QRate 0008: Speichergrenzen für Fotos.
-- Der kostenlose Supabase-Tarif hat 1 GB Dateispeicher für alle Haushalte zusammen.
-- Damit ein Haushalt den Platz nicht allein aufbraucht, gilt pro Haushalt eine Grenze
-- und für den ganzen Bucket eine zweite, die unter 1 GB bleibt.
-- Geprüft wird beim Hochladen in storage.objects, also auch für Dateien ohne Tabellenzeile.

-- ---------- Grenzen an einer Stelle ----------
create or replace function public.photo_limits(
  out household_bytes bigint, out household_files int, out total_bytes bigint)
language sql immutable set search_path = '' as $$
  select 250::bigint * 1024 * 1024, 1000, 800::bigint * 1024 * 1024
$$;

-- Größe einer Datei. Fehlt sie (Hochladen läuft noch), zählt die größte erlaubte Datei.
create or replace function public.photo_size(o storage.objects)
returns bigint language sql stable set search_path = '' as $$
  select coalesce((o.metadata ->> 'size')::bigint,
    (select b.file_size_limit from storage.buckets b where b.id = o.bucket_id), 3145728)
$$;

-- Verbrauch eines Haushalts, nur für Mitglieder.
create or replace function public.household_storage(p_household uuid)
returns table (used_bytes bigint, files int, limit_bytes bigint, limit_files int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_member(p_household);
  return query
    select coalesce(sum(public.photo_size(o)) filter (where o.id is not null), 0)::bigint, count(o.id)::int,
      l.household_bytes, l.household_files
    from public.photo_limits() l
    left join storage.objects o on o.bucket_id = 'box-photos'
      and (storage.foldername(o.name))[1] = p_household::text
    group by l.household_bytes, l.household_files;
end $$;

-- Prüfung beim Hochladen. Nur für den eigenen Haushalt: Fremde erfahren nichts über volle Haushalte.
-- Die neue Datei ist noch nicht mitgezählt; sie darf die Grenze also um höchstens eine Datei überschreiten.
create or replace function public.photo_room(p_folder text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  l record;
  used bigint;
  n int;
  total bigint;
begin
  if p_folder is null or p_folder not in (select h::text from public.my_households() h) then
    return false;
  end if;
  select * into l from public.photo_limits();
  select coalesce(sum(public.photo_size(o)), 0), count(*) into used, n
    from storage.objects o
    where o.bucket_id = 'box-photos' and (storage.foldername(o.name))[1] = p_folder;
  if used >= l.household_bytes or n >= l.household_files then
    raise exception 'storage_limit';
  end if;
  select coalesce(sum(public.photo_size(o)), 0) into total
    from storage.objects o where o.bucket_id = 'box-photos';
  if total >= l.total_bytes then
    raise exception 'storage_full';
  end if;
  return true;
end $$;

-- ---------- Hochladen nur mit freiem Platz ----------
drop policy box_photos_files_insert on storage.objects;
create policy box_photos_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'box-photos'
    and (storage.foldername(name))[1] in (select h::text from public.my_households() h)
    and public.photo_room((storage.foldername(name))[1]));

-- ---------- Rechte ----------
revoke execute on function public.photo_limits(), public.photo_size(storage.objects),
  public.household_storage(uuid), public.photo_room(text) from public, anon;
grant execute on function public.photo_limits(), public.photo_size(storage.objects),
  public.household_storage(uuid), public.photo_room(text) to authenticated;
