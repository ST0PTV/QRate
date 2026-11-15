// Schlanker Nachbau von Supabase-Auth für PGlite (Node-Tests und Browser-Testumgebung).
// auth.uid() liest wie bei Supabase die Einstellung request.jwt.claim.sub.
export const AUTH_STUB = `
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;

  -- Storage: nur Buckets, Objekte und storage.foldername() wie bei Supabase (RLS ist dort schon an).
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
    name text not null, owner uuid default auth.uid(), created_at timestamptz default now(), unique (bucket_id, name));
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  alter table storage.objects enable row level security;
`;

export const AUTH_GRANTS = `
  grant usage on schema public, auth, extensions, storage to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant select, insert, delete on storage.objects to authenticated;
  grant execute on function storage.foldername(text) to authenticated;
`;

export const MIGRATIONS = ['0001_schema.sql', '0002_functions.sql', '0003_photos.sql'];
