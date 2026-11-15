// Typen von Dingen mit Etikett. Die Gruppe entscheidet, was ein Ding kann:
// place = hier steht etwas (Einräumen), container = hier ist etwas drin, single = ein einzelnes Ding.
// Muss zu public.thing_group() in supabase/migrations/0005_things.sql passen.
export const GROUPS = [
  { key: 'place', title: 'Orte und Möbel', hint: 'hier steht etwas' },
  { key: 'container', title: 'Behälter', hint: 'hier ist etwas drin' },
  { key: 'single', title: 'Einzelstücke', hint: 'ein Ding' }
];

export const TYPES = [
  { key: 'room', label: 'Raum / Bereich', icon: 'home', group: 'place' },
  { key: 'rack', label: 'Regal', icon: 'rack', group: 'place' },
  { key: 'cabinet', label: 'Schrank', icon: 'cabinet', group: 'place' },
  { key: 'shelf', label: 'Ebene / Brett', icon: 'shelf', group: 'place' },
  { key: 'drawer', label: 'Fach / Schublade', icon: 'drawer', group: 'place' },
  { key: 'pegboard', label: 'Lochwand / Haken', icon: 'pegboard', group: 'place' },
  { key: 'box', label: 'Kiste', icon: 'box', group: 'container' },
  { key: 'bin', label: 'Box klein', icon: 'bin', group: 'container' },
  { key: 'case', label: 'Koffer / Tasche', icon: 'case', group: 'container' },
  { key: 'sack', label: 'Beutel / Sack', icon: 'sack', group: 'container' },
  { key: 'folder', label: 'Ordner / Mappe', icon: 'folder', group: 'container' },
  { key: 'clothes', label: 'Kleiderständer', icon: 'hanger', group: 'container' },
  { key: 'thing', label: 'Gegenstand', icon: 'thing', group: 'single' },
  { key: 'tool', label: 'Gerät / Werkzeug', icon: 'tool', group: 'single' },
  { key: 'furniture', label: 'Möbel', icon: 'chair', group: 'single' },
  { key: 'vehicle', label: 'Fahrrad / Fahrzeug', icon: 'bike', group: 'single' }
];

const BY_KEY = new Map(TYPES.map(t => [t.key, t]));
export const typeOf = key => BY_KEY.get(key) ?? BY_KEY.get('box');
export const typeLabel = key => typeOf(key).label;
export const typeIcon = key => typeOf(key).icon;
export const groupOf = key => typeOf(key).group;
// Orte und Behälter nehmen Gegenstände und andere Dinge auf, Einzelstücke nicht.
export const canHold = key => groupOf(key) !== 'single';
export const isPlace = key => groupOf(key) === 'place';

// Baum aus der flachen Liste (id, parent_id): Pfad über einem Ding, alles darunter, Wurzeln.
export function buildTree(list) {
  const byId = new Map(list.map(t => [t.id, t]));
  const kids = new Map();
  for (const t of list) {
    const k = t.parent_id && byId.has(t.parent_id) ? t.parent_id : null;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(t);
  }
  return {
    byId,
    roots: kids.get(null) ?? [],
    children: id => kids.get(id) ?? [],
    path(id) {
      const names = [];
      let cur = byId.get(byId.get(id)?.parent_id);
      for (let i = 0; cur && i < 20; i++, cur = byId.get(cur.parent_id)) names.unshift(cur.name);
      return names.join(' › ');
    },
    descendants(id) {
      const out = new Set();
      const walk = x => { for (const c of kids.get(x) ?? []) if (!out.has(c.id)) { out.add(c.id); walk(c.id); } };
      walk(id);
      return out;
    }
  };
}
