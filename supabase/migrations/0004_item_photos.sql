-- QRate 0004: ein Foto pro Gegenstand, meist freigestellt (PNG mit transparentem Hintergrund).
-- Freigestellt wird auf dem iPhone mit Apples „Auswahl kopieren“, nicht auf dem Server.
-- Dateien liegen im selben Bucket box-photos unter <household_id>/<box_id>/items/<zufall>.png (oder .jpg).
-- Die Speicher-Policies aus 0003 gelten damit unverändert: erster Ordner = Haushalt.

-- ---------- Speicher: PNG erlauben, etwas mehr Platz für Transparenz ----------
update storage.buckets
  set allowed_mime_types = array['image/jpeg', 'image/png'], file_size_limit = 3145728
  where id = 'box-photos';

-- ---------- Tabelle ----------
create table public.item_photos (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  box_id uuid not null references public.boxes (id) on delete cascade,
  item_id uuid not null unique references public.items (id) on delete cascade,
  path text not null unique check (length(path) <= 200),
  cutout boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);
create index item_photos_box_idx on public.item_photos (box_id);

-- Haushalt und Kiste aus dem Gegenstand, Ersteller aus der Anmeldung, Pfad muss zur Kiste passen.
create or replace function public.item_photos_before_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_by := auth.uid();
  select i.household_id, i.box_id into new.household_id, new.box_id from public.items i where i.id = new.item_id;
  if new.path not like new.household_id::text || '/' || new.box_id::text || '/items/%' then
    raise exception 'Foto-Pfad passt nicht zum Gegenstand';
  end if;
  return new;
end $$;
create trigger item_photos_before_insert before insert on public.item_photos
  for each row execute function public.item_photos_before_insert();

alter table public.item_photos enable row level security;
create policy item_photos_read on public.item_photos for select to authenticated
  using (household_id in (select public.my_households()));
create policy item_photos_insert on public.item_photos for insert to authenticated
  with check (household_id in (select public.my_households()));
create policy item_photos_delete on public.item_photos for delete to authenticated
  using (household_id in (select public.my_households()));

revoke all on public.item_photos from anon, authenticated;
grant select, delete on public.item_photos to authenticated;
grant insert (item_id, path, cutout) on public.item_photos to authenticated;
