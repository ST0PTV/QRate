// Scannen in der App (Kamera) oder Nummer eintippen. Zeigt an, wenn gerade eine Kiste verschoben wird.
import { startScanner, stopScanner } from '../core/scanner.js';
import { store } from '../core/store.js';
import { humanNumber } from '../core/code.js';
import { esc, icon, toast } from '../core/ui.js';

let cameraOn = false;

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
    return `
      ${moving ? `<div class="banner"><span>Jetzt das Orts-Etikett scannen. ${humanNumber('K', moving.number)} „${esc(moving.name)}“ kommt dorthin.</span>
        <button class="btn small" data-act="cancelMove">Abbrechen</button></div>` : ''}
      <div class="viewfinder${cameraOn ? ' on' : ''}">
        <video id="cam" playsinline muted></video>
        <div class="frame" aria-hidden="true"></div>
        ${cameraOn ? '' : `<button class="btn primary" data-act="camera">${icon('scan')} Kamera starten</button>`}
      </div>
      <p class="muted small" id="camMsg">Mit der normalen Handykamera geht es auch, das öffnet den Link aber im Browser statt in der installierten App.</p>
      <form class="card stack" data-form="manual">
        <label class="field"><span>Nummer oder Code eintippen</span>
          <input class="input" id="manual" placeholder="z. B. K-0003 oder 7KX2M9QD" autocomplete="off" autocapitalize="characters"></label>
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
    camera(_, ctx) { cameraOn = true; ctx.rerender(); },
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
