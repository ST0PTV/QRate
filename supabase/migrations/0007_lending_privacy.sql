-- QRate 0007: Ausleihen nachgeschärft (Befunde der unabhängigen Prüfung vom 2026-11-17).
-- 1. Wird eine Person gelöscht, verschwindet ihr Name auch aus dem Verlauf (bisher blieb er in events.detail).
--    Neue Einträge merken sich dazu die Personen-ID; ältere werden über die Ausleihen der Person gefunden.
-- 2. Eine zurückgegebene Ausleihe lässt sich nicht wieder öffnen oder umdatieren; die Rückgabezeit setzt der Server.

-- Verlauf: Name und Personen-ID (für das spätere Entfernen)
create or replace function public.log_lending_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare who text := (select p.name from public.borrowers p where p.id = new.borrower_id);
begin
  if tg_op = 'INSERT' then
    insert into public.events (household_id, box_id, actor_id, action, detail)
    values (new.household_id, new.box_id, auth.uid(), 'lent', jsonb_build_object('to', who, 'borrower', new.borrower_id));
  elsif new.returned_at is not null and old.returned_at is null then
    insert into public.events (household_id, box_id, actor_id, action, detail)
    values (new.household_id, new.box_id, auth.uid(), 'returned', jsonb_build_object('from', who, 'borrower', new.borrower_id));
  end if;
  return new;
end $$;

-- Person löschen: Namen aus dem Verlauf entfernen. Läuft vor dem Löschen, solange die Ausleihen noch auf die Person zeigen.
create or replace function public.borrowers_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.events e
     set detail = e.detail - 'to' - 'from' - 'borrower'
   where e.household_id = old.household_id
     and e.action in ('lent', 'returned')
     and (
       e.detail->>'borrower' = old.id::text
       or (e.detail->>'borrower' is null
           and coalesce(e.detail->>'to', e.detail->>'from') = old.name
           and e.box_id in (select l.box_id from public.lendings l where l.borrower_id = old.id))
     );
  return old;
end $$;
create trigger borrowers_before_delete before delete on public.borrowers
  for each row execute function public.borrowers_before_delete();

-- Ausleihe ändern: nur offen → zurück (Zeit vom Server) und das Erinnerungsdatum
create or replace function public.lendings_before_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.returned_at is not null and new.returned_at is distinct from old.returned_at then
    raise exception 'already_returned';
  end if;
  if old.returned_at is null and new.returned_at is not null then
    new.returned_at := now();
  end if;
  return new;
end $$;
create trigger lendings_before_update before update on public.lendings
  for each row execute function public.lendings_before_update();
