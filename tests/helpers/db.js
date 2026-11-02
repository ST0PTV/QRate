// Testdatenbank: PGlite (Postgres im Prozess) mit dem Auth-Nachbau aus auth-stub.js.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { AUTH_STUB, AUTH_GRANTS, MIGRATIONS } from './auth-stub.js';

const DIR = join(import.meta.dirname, '..', '..', 'supabase', 'migrations');

export async function createDb() {
  const onDisk = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
  if (onDisk.join() !== MIGRATIONS.join()) throw new Error('MIGRATIONS in auth-stub.js passt nicht zu supabase/migrations');
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB);
  for (const f of MIGRATIONS) await db.exec(readFileSync(join(DIR, f), 'utf8'));
  await db.exec(AUTH_GRANTS);
  return db;
}

export async function createUser(db) {
  const id = randomUUID();
  await db.query('insert into auth.users (id) values ($1)', [id]);
  return id;
}

// Führt fn als angemeldeter Nutzer aus (oder als "anon", wenn userId null ist).
// Ein Fehler setzt die Rolle trotzdem zurück, damit der nächste Test sauber startet.
export async function as(db, userId, fn) {
  const sub = userId ?? '';
  await db.exec(`set request.jwt.claim.sub = '${sub}'; set role ${userId ? 'authenticated' : 'anon'};`);
  try {
    return await fn({
      q: async (sql, params) => (await db.query(sql, params)).rows,
      rpc: async (name, args = {}) => {
        const keys = Object.keys(args);
        const sql = `select * from public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
        return (await db.query(sql, keys.map(k => args[k]))).rows;
      }
    });
  } finally {
    await db.exec('reset role; reset request.jwt.claim.sub;');
  }
}

export async function rejects(promise, code) {
  try {
    await promise;
  } catch (e) {
    if (code && !String(e.message).includes(code)) throw new Error(`Erwartet "${code}", bekommen: ${e.message}`);
    return e;
  }
  throw new Error(`Erwartet Fehler${code ? ` "${code}"` : ''}, aber der Aufruf ging durch`);
}
