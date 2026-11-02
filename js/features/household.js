// Haushalt: Mitglieder, Einladungen, Bestätigen und Entfernen, Haushalt wechseln, Abmelden.
import { CONFIG } from '../core/config.js';
import { members, createInvite, setMemberStatus, renameHousehold, auth } from '../core/api.js';
import { inviteUrl } from '../core/code.js';
import { store } from '../core/store.js';
import { esc, qrSvg, toast, copyText, fmtTime } from '../core/ui.js';

let invite = null;      // { token, expires_at }
let armed = null;       // Mitglied, dessen Entfernen auf Bestätigung wartet
let renaming = false;

const ROLE = { admin: 'Admin', member: 'Mitglied', guest: 'Gast' };

export default {
  id: 'household',
  tab: 'house',
  async render(ctx) {
    const { app } = ctx;
    const hhName = app.membership.households?.name ?? 'Haushalt';
    ctx.setTitle(hhName, `${ROLE[app.membership.role]} · ${app.membership.display_name}`);
    const list = await members(app.household);
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
    toggleRename(_, ctx) { renaming = !renaming; ctx.rerender(); },
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
