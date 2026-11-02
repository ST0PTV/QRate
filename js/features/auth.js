// Anmelde-Schranke: Einrichtung fehlt, Login per E-Mail-Code, Haushalt gründen oder beitreten, Warten auf Bestätigung.
import { auth, createHousehold, acceptInvite } from '../core/api.js';
import { store } from '../core/store.js';
import { esc, icon, toast } from '../core/ui.js';

export const setupView = {
  id: 'setup',
  render(ctx) {
    ctx.setTitle('QRate', 'Einrichtung');
    return `<div class="card stack">
      <h2>Noch nicht eingerichtet</h2>
      <p class="muted">In <code>js/core/config.js</code> fehlen Adresse und öffentlicher Schlüssel des Supabase-Projekts.
      Die Schritte stehen in <code>docs/SETUP.md</code>.</p>
    </div>`;
  }
};

// ---------- Login ----------
let sentTo = '';

function redirectUrl() {
  return location.origin + location.pathname;
}

export const loginView = {
  id: 'login',
  render(ctx) {
    ctx.setTitle('QRate', 'Anmelden');
    const pending = store.pendingCode() || store.pendingInvite();
    if (sentTo) {
      return `<form class="card stack" data-form="verify">
        <h2>Code eingeben</h2>
        <p class="muted">Wir haben einen Code an <strong>${esc(sentTo)}</strong> geschickt. Du kannst auch direkt auf den Link in der E-Mail tippen.</p>
        <label class="field"><span>Code aus der E-Mail</span>
          <input class="input code-input" id="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required></label>
        <button class="btn primary" type="submit">Anmelden</button>
        <button class="btn ghost" type="button" data-act="restart">Andere E-Mail-Adresse</button>
      </form>`;
    }
    return `<form class="card stack" data-form="send">
      <div class="lock-ico">${icon('lock')}</div>
      <h2>${pending ? 'Privates Etikett' : 'Willkommen bei QRate'}</h2>
      <p class="muted">${pending
        ? 'Dieses Etikett gehört zu einem privaten Haushalt. Melde dich an, um den Inhalt zu sehen.'
        : 'Melde dich mit deiner E-Mail-Adresse an. Du bekommst einen Code, ein Passwort brauchst du nicht.'}</p>
      <label class="field"><span>E-Mail-Adresse</span>
        <input class="input" id="email" type="email" autocomplete="email" required value="${esc(store.email())}"></label>
      <button class="btn primary" type="submit">Code schicken</button>
    </form>`;
  },
  mounted() {
    document.getElementById(sentTo ? 'otp' : 'email')?.focus();
  },
  forms: {
    async send(f, ctx) {
      const email = f.querySelector('#email').value.trim();
      await auth.sendCode(email, redirectUrl());
      store.setEmail(email);
      sentTo = email;
      ctx.rerender();
    },
    async verify(f, ctx) {
      await auth.verifyCode(sentTo, f.querySelector('#otp').value.trim());
      sentTo = '';
      await ctx.reloadSession();
    }
  },
  actions: {
    restart(_, ctx) { sentTo = ''; ctx.rerender(); }
  }
};

// ---------- Haushalt gründen oder beitreten ----------
export const onboardingView = {
  id: 'onboarding',
  render(ctx) {
    const invite = store.pendingInvite();
    ctx.setTitle('QRate', invite ? 'Einladung' : 'Haushalt');
    if (invite) {
      return `<form class="card stack" data-form="join">
        <h2>Einladung annehmen</h2>
        <p class="muted">Du trittst einem Haushalt bei. Ein Admin bestätigt dich danach.</p>
        <label class="field"><span>Dein Name im Haushalt</span>
          <input class="input" id="displayName" maxlength="40" required autocomplete="given-name"></label>
        <input type="hidden" id="token" value="${esc(invite)}">
        <button class="btn primary" type="submit">Beitreten</button>
        <button class="btn ghost" type="button" data-act="dropInvite">Einladung verwerfen</button>
      </form>`;
    }
    return `<form class="card stack" data-form="create">
        <h2>Haushalt gründen</h2>
        <p class="muted">Du wirst Admin und kannst danach weitere Mitglieder einladen.</p>
        <label class="field"><span>Name des Haushalts</span>
          <input class="input" id="hhName" maxlength="80" required placeholder="z. B. Wohnung Lindenstraße"></label>
        <label class="field"><span>Dein Name im Haushalt</span>
          <input class="input" id="displayName" maxlength="40" required autocomplete="given-name"></label>
        <button class="btn primary" type="submit">Haushalt gründen</button>
      </form>
      <form class="card stack" data-form="joinCode">
        <h2>Ich habe eine Einladung</h2>
        <label class="field"><span>Einladungscode (16 Zeichen)</span>
          <input class="input mono" id="inviteCode" maxlength="40" required autocapitalize="characters" autocomplete="off"></label>
        <button class="btn" type="submit">Weiter</button>
      </form>
      <button class="btn ghost" data-act="signOut">Abmelden</button>`;
  },
  forms: {
    async create(f, ctx) {
      await createHousehold(f.querySelector('#hhName').value, f.querySelector('#displayName').value);
      toast('Haushalt angelegt');
      await ctx.reloadSession();
    },
    joinCode(f, ctx) {
      const raw = f.querySelector('#inviteCode').value.trim();
      const m = raw.match(/invite=([0-9A-Za-z]+)/);
      store.setPendingInvite((m ? m[1] : raw).toUpperCase().replace(/[^0-9A-Z]/g, ''));
      ctx.rerender();
    },
    async join(f, ctx) {
      const res = await acceptInvite(f.querySelector('#token').value, f.querySelector('#displayName').value);
      store.setPendingInvite(null);
      toast(`Anfrage an „${res.household_name}“ gesendet`);
      await ctx.reloadSession();
    }
  },
  actions: {
    dropInvite(_, ctx) { store.setPendingInvite(null); ctx.rerender(); },
    signOut: () => auth.signOut()
  }
};

// ---------- Warten auf Bestätigung ----------
export const pendingView = {
  id: 'pending',
  render(ctx) {
    ctx.setTitle('QRate', 'Wartet');
    const names = ctx.app.memberships.map(m => esc(m.households?.name ?? 'Haushalt')).join(', ');
    return `<div class="card stack">
      <h2>Fast geschafft</h2>
      <p class="muted">Deine Anfrage für <strong>${names}</strong> wartet auf die Bestätigung durch einen Admin.</p>
      <button class="btn primary" data-act="refresh">Erneut prüfen</button>
      <button class="btn ghost" data-act="signOut">Abmelden</button>
    </div>`;
  },
  actions: {
    refresh: (_, ctx) => ctx.reloadSession(),
    signOut: () => auth.signOut()
  }
};
