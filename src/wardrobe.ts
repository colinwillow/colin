// What he is wearing.
//
// The export decides this, not the code. Every mesh that is not part of his body
// is a wearable, and the slot it belongs to comes from its own name — so adding
// a second hoodie in Blender is an export away from appearing in the app, with
// nothing here to edit.
//
//   THE NAMING RULE, for anything exported from here on:
//     <slot>_<name>          top_flannel, shoes_vans, hat_beanie, jacket_puffer
//
// Names that predate the rule are mapped by hand in ALIASES below, so `converse`
// and `outfit` still land somewhere sensible. The fallback for anything
// unrecognised is its own slot, which keeps a new mesh visible and toggleable
// rather than silently lost.
//
// ONE ITEM PER SLOT IS VISIBLE. Choosing one hides the rest, which is what makes
// a slot a slot; slots marked `optional` can also be empty, since a hat is a
// decision and a pair of legs is not.
import * as THREE from 'three';

/** The body. Never a wearable, never hidden, never offered as a choice. */
const BODY = ['head', 'eyes', 'teeth', 'tongue', 'body', 'skin'];

export interface Slot {
  id: string;
  /** What the UI calls it. */
  name: string;
  /** May be empty — a hat is optional in a way that trousers are not. */
  optional: boolean;
}

/** The rail down the side of the Outfits screen, in order. */
export const SLOTS: Slot[] = [
  { id: 'top', name: 'Tops', optional: false },
  { id: 'bottom', name: 'Bottoms', optional: false },
  { id: 'shoes', name: 'Shoes', optional: false },
  { id: 'hat', name: 'Hats', optional: true },
  { id: 'headphones', name: 'Headphones', optional: true },
  { id: 'jacket', name: 'Jackets', optional: true },
];

/** Singular and plural both accepted, because Blender names go either way. */
const SLOT_IDS = new Map<string, string>();
for (const s of SLOTS) {
  SLOT_IDS.set(s.id, s.id);
  SLOT_IDS.set(`${s.id}s`, s.id);
}
SLOT_IDS.set('tops', 'top');
SLOT_IDS.set('bottoms', 'bottom');
SLOT_IDS.set('shoe', 'shoes');
SLOT_IDS.set('pants', 'bottom');
SLOT_IDS.set('trousers', 'bottom');

/** Meshes exported before the naming rule existed. */
const ALIASES: Record<string, { slot: string; name: string }> = {
  converse: { slot: 'shoes', name: 'Converse' },
  headphones: { slot: 'headphones', name: 'Cans' },
  // One mesh carrying the hoodie, the jacket and the jeans together. It sits in
  // `top` because that is where the eye goes first, and it is the reason the
  // other slots read as empty until the outfit is split up in Blender.
  outfit: { slot: 'top', name: 'The usual' },
};

export interface Wearable {
  id: string;
  name: string;
  slot: string;
  objects: THREE.Object3D[];
}

export interface Wardrobe {
  slots: Slot[];
  /** Everything found, in the order the model lists it. */
  items: Wearable[];
  itemsIn: (slot: string) => Wearable[];
  /** The chosen item in a slot, or null for none. */
  wornIn: (slot: string) => string | null;
  /** Choose one, or null to wear nothing in that slot. Persists. */
  wear: (slot: string, id: string | null) => void;
  /** Back to whatever the file ships as. */
  reset: () => void;
}

const KEY = 'colin.wardrobe.v1';

const titleCase = (s: string) =>
  s.replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** `top_flannel` → top / Flannel. Anything else falls back to its own name. */
function classify(raw: string): { slot: string; name: string } {
  const name = raw.trim();
  const known = ALIASES[name.toLowerCase()];
  if (known) return known;
  const cut = name.match(/^([A-Za-z]+)[_\-.](.+)$/);
  if (cut) {
    const slot = SLOT_IDS.get(cut[1].toLowerCase());
    if (slot) return { slot, name: titleCase(cut[2]) };
  }
  return { slot: 'other', name: titleCase(name) };
}

export function createWardrobe(model: THREE.Object3D): Wardrobe {
  const items: Wearable[] = [];
  const byId = new Map<string, Wearable>();

  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh && !(mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    /* The node is what carries the name — three names the geometry `Mesh.001`
       and the node `outfit`, and only one of those is worth reading. */
    const raw = (mesh.name || mesh.parent?.name || '').trim();
    if (!raw) return;
    if (BODY.includes(raw.toLowerCase())) return;
    const { slot, name } = classify(raw);
    const id = raw.toLowerCase();
    const existing = byId.get(id);
    if (existing) { existing.objects.push(mesh); return; }
    const item: Wearable = { id, name, slot, objects: [mesh] };
    byId.set(id, item);
    items.push(item);
  });

  /* A slot nothing landed in is still a slot: the screen shows it empty with a
     note about what to name the mesh, which is more use than hiding it. */
  const slots = SLOTS.slice();
  for (const item of items) {
    if (item.slot !== 'other' && !slots.some((s) => s.id === item.slot)) {
      slots.push({ id: item.slot, name: titleCase(item.slot), optional: true });
    }
  }
  if (items.some((i) => i.slot === 'other')) {
    slots.push({ id: 'other', name: 'Extras', optional: true });
  }

  const itemsIn = (slot: string) => items.filter((i) => i.slot === slot);

  /** What the file shipped as: whatever was visible when it was loaded. */
  const shipped = new Map<string, string | null>();
  for (const slot of slots) {
    const inSlot = itemsIn(slot.id);
    const on = inSlot.find((i) => i.objects.every((o) => o.visible));
    shipped.set(slot.id, on?.id ?? (inSlot[0]?.id ?? null));
  }

  const worn = new Map(shipped);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, string | null>;
    for (const [slot, id] of Object.entries(saved)) {
      // Only trust a saved choice that still exists — the model is the truth,
      // and a renamed mesh must not leave him standing there with no shoes.
      if (id === null || byId.has(id)) worn.set(slot, id);
    }
  } catch { /* no saved outfit, or a browser that will not have one */ }

  const apply = () => {
    for (const item of items) {
      const on = worn.get(item.slot) === item.id;
      for (const o of item.objects) o.visible = on;
    }
  };

  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(worn))); }
    catch { /* private mode; the outfit is still on, it just will not survive */ }
  };

  apply();

  return {
    slots,
    items,
    itemsIn,
    wornIn: (slot) => worn.get(slot) ?? null,
    wear: (slot, id) => { worn.set(slot, id); apply(); save(); },
    reset: () => { for (const [k, v] of shipped) worn.set(k, v); apply(); save(); },
  };
}
