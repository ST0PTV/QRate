// Prüfrunde: gehört zu einem Haushalt und endet von selbst nach 12 Stunden, falls niemand „Fertig“ tippt.
import { store } from '../core/store.js';

const MAX_AGE = 12 * 3600e3;

export function startRound(household) {
  store.setStow(null);
  store.setMoving(null);
  store.setCheckRound({ household, at: Date.now(), done: [] });
}

// Laufende Runde des aktuellen Haushalts oder null; eine fremde oder alte Runde wird verworfen
export function activeRound(ctx) {
  const r = store.checkRound();
  if (!r) return null;
  if (r.household !== ctx?.app?.household || !(Date.now() - r.at < MAX_AGE)) {
    store.setCheckRound(null);
    return null;
  }
  return r;
}
