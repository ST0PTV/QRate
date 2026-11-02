// Schlanker Nachbau von Supabase-Auth für PGlite (Node-Tests und Browser-Testumgebung).
// auth.uid() liest wie bei Supabase die Einstellung request.jwt.claim.sub.
export const AUTH_STUB = `
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
`;

export const AUTH_GRANTS = `
  grant usage on schema public, auth, extensions to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

export const MIGRATIONS = ['0001_schema.sql', '0002_functions.sql'];
