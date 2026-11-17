// Haushalt: Mitglieder, Einladungen, Bestätigen und Entfernen, Darstellung, Haushalt wechseln, Abmelden.
import { CONFIG } from '../core/config.js';
import { members, createInvite, setMemberStatus, renameHousehold, auth, borrowers, deleteBorrower, exportHousehold, householdStorage } from '../core/api.js';
import { inviteUrl } from '../core/code.js';
import { store } from '../core/store.js';
import { esc, qrSvg, toast, copyText, fmtTime, applyTheme, downloadText } from '../core/ui.js';

let invite = null;      // { token, expires_at }
let armed = null;       // Mitglied, dessen Entfernen auf Bestätigung wartet
let renaming = false;
let armedPerson = null; // Person, deren Löschen auf Bestätigung wartet

const ROLE = { admin: 'Admin', member: 'Mitglied', guest: 'Gast' };
const THEMES = [['system', 'System'], ['dark', 'Dunkel'], ['light', 'Hell']];

export default {
  id: 'household',
  tab: 'house',
  async render(ctx) {
    const { app } = ctx;
    const hhName = app.membership.households?.name ?? 'Haushalt';
    ctx.setTitle(hhName, `${ROLE[app.membership.role]} · ${app.membership.display_name}`);
    const [list, people, space] = await Promise.all([members(app.household), borrowers(app.household).catch(() => []),
      householdStorage(app.household).catch(() => null)]);
    const pending = list.filter(m => m.status === 'pending');
    const active = list.filter(m => m.status === 'active');
    const others = app.memberships.filter(m => m.status === 'active' && m.household_id !== app.household);
    const url = invite ? inviteUrl(CONFIG.APP_URL, invite.token) : '';

    const row = m => `<div class="member">
      <span class="avatar">${esc(m.display_name.slice(0, 1).toUpperCase())}</span>
      <div class="grow"><strong>${esc(m.display_name)}</strong>${m.user_id === app.user.id ? ' <span class="pill">du</span>' : ''}
        <div class="muted small">${m.status === 'pending' ? 'wartet auf Bestätigung' : ROLE[m.role]}</div></div>
      ${app.isAdmin && m.status === 'pending' ? `<button class="btn small primary" data-act="approve" data-id="${m.id}">Bestätigen</button>` : ''}
      ${app.isAdmin && m.user_id !== app.user.id
        ? `<button class="btn small ghost${armed === m.id ? ' danger' : ''}" data-act="remove" data-id="${m.id}">${armed === m.id ? 'Wirklich?' : (m.status === 'pending' ? 'Ablehnen' : 'Entfernen')}</button>` : ''}
    </div>`;

    return `
      ${pending.length && app.isAdmin ? `<section class="card"><h3 class="card-title">Anfragen</h3>${pending.map(row).join('')}</section>` : ''}
      <section class="card"><h3 class="card-title">Mitglieder</h3>${active.map(row).join('')}</section>
      ${app.isAdmin ? `<section class="card stack">
        <h3>Mitglied einladen</h3>
        ${invite ? `<div class="invite">
            <div class="invite-qr">${qrSvg(url)}</div>
            <p class="mono center">${esc(invite.token)}</p>
            <p class="muted small center">Gilt einmal, bis ${fmtTime(invite.expires_at)}. Danach bestätigst du das neue Mitglied hier.</p>
            <div class="btn-row center"><button class="btn" data-act="copy" data-url="${esc(url)}">Link kopieren</button>
            <button class="btn ghost" data-act="dropInvite">Schließen</button></div></div>`
          : `<p class="muted small">Das neue Mitglied scannt den Code mit dem eigenen Handy oder öffnet den Link.</p>
            <button class="btn primary" data-act="invite">Einladung erzeugen</button>`}
      </section>` : ''}
      ${people.length ? `<section class="card">
        <h3 class="card-title">Personen zum Ausleihen</h3>
        <p class="muted small">Nur Name und Telefon, sichtbar für Mitglieder dieses Haushalts. Beim Löschen bleibt der Ausleih-Verlauf ohne Namen.</p>
        ${people.map(p => `<div class="member"><span class="avatar">${esc(p.name.slice(0, 1).toUpperCase())}</span>
          <div class="grow"><strong>${esc(p.name)}</strong>${p.phone ? `<div class="muted small">${esc(p.phone)}</div>` : ''}</div>
          <button class="btn small ghost${armedPerson === p.id ? ' danger' : ''}" data-act="deletePerson" data-id="${p.id}">${armedPerson === p.id ? 'Wirklich löschen?' : 'Löschen'}</button>
        </div>`).join('')}
      </section>` : ''}
      ${space ? storageCard(space) : ''}
      <section class="card stack">
        <h3>Sicherung</h3>
        <p class="muted small">Alle Dinge, Gegenstände, Etiketten, Ausleihen und der Verlauf als Datei. Fotos sind nicht enthalten.</p>
        <button class="btn" data-act="backup">Sicherung herunterladen</button>
      </section>
      <section class="card stack">
        <h3>Darstellung</h3>
        <div class="seg seg-wide" role="group" aria-label="Darstellung">
          ${THEMES.map(([v, label]) => `<button type="button" data-act="theme" data-v="${v}" aria-pressed="${store.theme() === v}">${label}</button>`).join('')}
        </div>
        <p class="muted small">Gilt nur auf diesem Gerät. „System“ folgt der Einstellung des Handys.</p>
      </section>
      <section class="card stack">
        <h3>Einstellungen</h3>
        ${renaming ? `<form class="stack" data-form="rename"><label class="field"><span>Name des Haushalts</span>
            <input class="input" id="hhName" maxlength="80" required value="${esc(hhName)}"></label>
            <div class="btn-row"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" type="button" data-act="toggleRename">Abbrechen</button></div></form>`
          : (app.isAdmin ? '<button class="btn" data-act="toggleRename">Haushalt umbenennen</button>' : '')}
        ${others.map(m => `<button class="btn" data-act="switch" data-id="${m.household_id}">Wechseln zu „${esc(m.households?.name)}“</button>`).join('')}
        <button class="btn ghost" data-act="signOut">Abmelden</button>
        <p class="muted small">Angemeldet mit ${esc(app.user.email)}</p>
      </section>`;
  },
  actions: {
    async deletePerson(el, ctx) {
      if (armedPerson !== el.dataset.id) { armedPerson = el.dataset.id; await ctx.rerender(); return; }
      armedPerson = null;
      await deleteBorrower(el.dataset.id);
      toast('Person gelöscht');
      await ctx.rerender();
    },
    async invite(_, ctx) {
      invite = await createInvite(ctx.app.household);
      await ctx.rerender();
    },
    dropInvite(_, ctx) { invite = null; ctx.rerender(); },
    async copy(el) {
      toast((await copyText(el.dataset.url)) ? 'Link kopiert' : 'Kopieren nicht möglich, bitte den Code abschreiben');
    },
    async approve(el, ctx) {
      await setMemberStatus(el.dataset.id, 'approve');
      await refreshNames(ctx);
      toast('Mitglied bestätigt');
    },
    async remove(el, ctx) {
      if (armed !== el.dataset.id) { armed = el.dataset.id; await ctx.rerender(); return; }
      armed = null;
      await setMemberStatus(el.dataset.id, 'remove');
      await refreshNames(ctx);
    },
    async backup(_, ctx) {
      const data = await exportHousehold(ctx.app.household);
      const file = { app: 'qrate', schemaVersion: 7, exportedAt: new Date().toISOString(), household: ctx.app.membership.households?.name ?? null, data };
      downloadText(`qrate-sicherung-${new Date().toISOString().slice(0, 10)}.json`, 'application/json', JSON.stringify(file, null, 1));
      const n = data.boxes.length + data.items.length;
      toast(`Sicherung erstellt: ${n} Einträge`);
    },
    toggleRename(_, ctx) { renaming = !renaming; ctx.rerender(); },
    theme(el, ctx) {
      store.setTheme(el.dataset.v);
      applyTheme(el.dataset.v);
      ctx.rerender();
    },
    switch: (el, ctx) => ctx.switchHousehold(el.dataset.id),
    async signOut() {
      store.clearAll();
      await auth.signOut();
    }
  },
  forms: {
    async rename(f, ctx) {
      await renameHousehold(ctx.app.household, f.querySelector('#hhName').value.trim());
      renaming = false;
      await ctx.reloadSession();
    }
  }
};

async function refreshNames(ctx) {
  const list = await members(ctx.app.household);
  ctx.app.names = new Map(list.map(m => [m.user_id, m.display_name]));
  await ctx.rerender();
}

// Fotospeicher: belegt von erlaubt, ab 80 % ein Hinweis
const mb = b => (b / 1048576).toLocaleString('de-DE', { maximumFractionDigits: b < 10485760 ? 1 : 0 });
function storageCard(s) {
  const share = Math.max(s.used_bytes / s.limit_bytes, s.files / s.limit_files);
  const pct = Math.min(100, Math.round(share * 100));
  return `<section class="card stack">
    <h3>Fotospeicher</h3>
    <div class="meter${share >= 0.8 ? ' warn' : ''}" role="meter" aria-label="Fotospeicher belegt" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
    <p class="muted small">${s.used_bytes > 0 && s.used_bytes < 1048576 ? 'Unter 1' : mb(s.used_bytes)} von ${mb(s.limit_bytes)} MB belegt, ${s.files} von ${s.limit_files} Fotos.</p>
    ${share >= 0.8 ? `<p class="small">${share >= 1 ? 'Voll: Neue Fotos gehen erst, wenn alte gelöscht sind.' : 'Fast voll. Alte Fotos löschen schafft Platz.'}</p>` : ''}
  </section>`;
}
