-- QRate 0003: Fotos pro Kiste und schnelle Liste „Gerade entnommen“.
-- Dateien liegen im privaten Storage-Bucket box-photos unter <household_id>/<box_id>/<zufall>.jpg.
-- Die Tabelle box_photos verweist darauf; Lesen und Schreiben regeln wie überall die Haushalte (my_households()).

-- ---------- Speicher ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('box-photos', 'box-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

-- Erster Ordner im Pfad = Haushalt. Nur Mitglieder dieses Haushalts sehen, laden hoch und löschen.
create policy box_photos_files_read on storage.objects for select to authenticated
  using (bucket_id = 'box-photos'
    and (storage.foldername(name))[1] in (select h::text from public.my_households() h));
create policy box_photos_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'box-photos'
    and (storage.foldername(name))[1] in (select h::text from public.my_households() h));
create policy box_photos_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'box-photos'
    and (storage.foldername(name))[1] in (select h::text from public.my_households() h));

-- ---------- Tabelle ----------
create table public.box_photos (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  box_id uuid not null references public.boxes (id) on delete cascade,
  path text not null unique check (length(path) <= 200),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);
create index box_photos_box_idx on public.box_photos (box_id, created_at);

-- Haushalt aus der Kiste, Ersteller aus der Anmeldung, Pfad muss zur Kiste passen, höchstens 8 Fotos pro Kiste.
create or replace function public.box_photos_before_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_by := auth.uid();
  select b.household_id into new.household_id from public.boxes b where b.id = new.box_id;
  if new.path not like new.household_id::text || '/' || new.box_id::text || '/%' then
    raise exception 'Foto-Pfad passt nicht zur Kiste';
  end if;
  if (select count(*) from public.box_photos p where p.box_id = new.box_id) >= 8 then
    raise exception 'photo_limit';
  end if;
  return new;
end $$;
create trigger box_photos_before_insert before insert on public.box_photos
  for each row execute function public.box_photos_before_insert();

alter table public.box_photos enable row level security;
create policy box_photos_read on public.box_photos for select to authenticated
  using (household_id in (select public.my_households()));
create policy box_photos_insert on public.box_photos for insert to authenticated
  with check (household_id in (select public.my_households()));
create policy box_photos_delete on public.box_photos for delete to authenticated
  using (household_id in (select public.my_households()));

revoke all on public.box_photos from anon, authenticated;
grant select, delete on public.box_photos to authenticated;
grant insert (box_id, path) on public.box_photos to authenticated;

-- ---------- Übersicht „Gerade entnommen“ ----------
create index items_removed_idx on public.items (household_id, removed_at desc) where removed_at is not null;
