// Scannen in der App (Kamera) oder Nummer eintippen. Zeigt an, wenn gerade etwas verschoben oder eingeräumt wird.
import { startScanner, stopScanner } from '../core/scanner.js';
import { store } from '../core/store.js';
import { esc, icon, toast } from '../core/ui.js';

let cameraOn = false;
let cameraFailed = false;

async function handle(text, ctx) {
  if (await ctx.openLabel(text)) return;
  toast('Das ist kein QRate-Etikett', 'error');
}

export default {
  id: 'scan',
  tab: 'scan',
  render(ctx) {
    ctx.setTitle('Scannen', 'Etikett vor die Kamera halten');
    const moving = store.moving();
    const stow = store.stow();
    // Beim Einräumen läuft die Kamera nach jedem Scan gleich weiter
    if (stow && !cameraFailed) cameraOn = true;
    return `
      ${stow ? `<div class="banner"><span>Einräumen in „${esc(stow.name)}“: alles scannen, was dorthin kommt.</span>
        <button class="btn small" data-act="stopStow">Fertig</button></div>
        ${stow.done.length ? `<section class="card"><div class="card-head"><h3>Gerade eingeräumt</h3><span class="muted small">${stow.done.length}</span></div>
          ${stow.done.map(d => `<div class="stow-row">${icon('check')}<span class="grow"><strong>${esc(d.name)}</strong>
            <span class="row-sub">${d.from ? `vorher: ${esc(d.from)}` : 'neu angelegt oder ohne Ort'}</span></span></div>`).join('')}</section>` : ''}` : ''}
      ${moving ? `<div class="banner"><span>Jetzt das Ziel scannen. „${esc(moving.name)}“ kommt dorthin.</span>
        <button class="btn small" data-act="cancelMove">Abbrechen</button></div>` : ''}
      <div class="viewfinder${cameraOn ? ' on' : ''}">
        <video id="cam" playsinline muted></video>
        <div class="frame" aria-hidden="true"></div>
        ${cameraOn ? '' : `<button class="btn primary" data-act="camera">${icon('scan')} Kamera starten</button>`}
      </div>
      <p class="muted small" id="camMsg">Mit der normalen Handykamera geht es auch, das öffnet den Link aber im Browser statt in der installierten App.</p>
      <form class="card stack" data-form="manual">
        <label class="field"><span>Nummer oder Code eintippen</span>
          <input class="input" id="manual" placeholder="z. B. #0042, K-0003 oder 7KX2M9QD" autocomplete="off" autocapitalize="characters"></label>
        <button class="btn" type="submit">Öffnen</button>
      </form>`;
  },
  mounted(ctx) {
    if (!cameraOn) return;
    const video = document.getElementById('cam');
    startScanner(video, {
      onCode: text => { cameraOn = false; stopScanner(); handle(text, ctx); },
      onError: msg => {
        cameraOn = false;
        cameraFailed = true;
        document.querySelector('.viewfinder')?.classList.remove('on');
        const m = document.getElementById('camMsg');
        if (m) m.textContent = msg;
      }
    });
  },
  leave() {
    cameraOn = false;
    stopScanner();
  },
  actions: {
    camera(_, ctx) { cameraOn = true; cameraFailed = false; ctx.rerender(); },
    stopStow(_, ctx) {
      const s = store.stow();
      store.setStow(null);
      cameraOn = false;
      toast(s?.done.length ? `${s.done.length} eingeräumt in „${s.name}“` : 'Einräumen beendet');
      ctx.go(s ? 'box/' + s.id : '');
    },
    cancelMove(_, ctx) { store.setMoving(null); ctx.rerender(); }
  },
  forms: {
    async manual(f, ctx) {
      const v = f.querySelector('#manual').value;
      if (!v.trim()) return;
      if (!(await ctx.openLabel(v))) toast('Kein Etikett mit dieser Nummer gefunden', 'error');
    }
  }
};
