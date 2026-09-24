// Enough of a view layer to build a screen without a framework.
//
// Every screen here is a handful of elements and a couple of event listeners.
// React would be more code than the screens, and a template string would put the
// markup and the wiring in different places — this keeps them on the same line.

type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
type Child = Node | string | number | null | undefined | false;

/**
 * `el('button.tab.on', { onclick }, 'Poses')`, `el('nav#tabs.glass')`
 *
 * The tag carries its own id and classes, because that is what most of these
 * elements are and writing `{ class: '...' }` for every one of them buries the
 * structure. Keys starting with `on` are listeners; everything else is an
 * attribute, except `style`, which is set as written.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  spec: K | string, attrs: Attrs = {}, ...children: Child[]
): HTMLElement {
  /* Empty class segments are allowed on purpose: `button.` is what a caller
     with no classes to add produces, and a spec that fails to parse used to fall
     all the way back to a `div` — which turns a button into something nothing
     can click, silently. */
  const match = String(spec).match(/^([a-zA-Z0-9-]*)(?:#([^.]+))?((?:\.[^.#]*)*)$/);
  const [, tag = '', id = '', classList = ''] = match ?? [];
  const node = document.createElement(tag || 'div');
  if (id) node.id = id;
  const classes = classList.split('.').filter(Boolean);
  if (classes.length) node.className = classes.join(' ');
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value as EventListener);
    } else if (key === 'style' && typeof value === 'string') {
      node.setAttribute('style', value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false)
    .map((c) => (c instanceof Node ? c : document.createTextNode(String(c)))));
  return node;
}

/** Replace everything inside a node in one go. */
export function fill(node: HTMLElement, ...children: Child[]) {
  node.textContent = '';
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false)
    .map((c) => (c instanceof Node ? c : document.createTextNode(String(c)))));
  return node;
}

/** The line-art icon set. One stroke weight, one corner radius, no fills — the
 *  same drawing rules as the buttons they sit in. */
const PATHS: Record<string, string> = {
  outfits: 'M8 4 5 6 3 9l2.5 1.8L7 9v11h10V9l1.5 1.8L21 9l-2-3-3-2-2 2.2h-4z',
  poses: 'M12 4.6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2M12 8.6v5.2m0 0L9 20m3-6.2 3 6.2M7.5 10.6l4.5 1 4.5-1',
  mood: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17M8.8 10.2h.01M15.2 10.2h.01M8.4 14.4c.9 1.1 2.1 1.7 3.6 1.7s2.7-.6 3.6-1.7',
  emotes: 'M4.5 5.5h15v10h-9l-4 3.5v-3.5h-2z',
  rooms: 'M4 10.5 12 4l8 6.5V20H4zM9.5 20v-6h5v6',
  photos: 'M4 8h3l1.5-2h7L17 8h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',
  gallery: 'M4 5h16v14H4zM4 15.5 9 11l4.5 4M14 13l2.5-2.2L20 13.6M9 9h.01',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  grid: 'M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z',
  look: 'M12 4.2a7.8 7.8 0 1 0 0 15.6 7.8 7.8 0 0 0 0-15.6M12 4.2v15.6M15.3 5v14M18 7v10',
  home: 'M4 10.5 12 4l8 6.5V20h-5v-6H9v6H4z',
  style: 'M8 4 5 6 3 9l2.5 1.8L7 9v11h10V9l1.5 1.8L21 9l-2-3-3-2-2 2.2h-4z',
  back: 'M14.5 5.5 8 12l6.5 6.5',
  next: 'M9.5 5.5 16 12l-6.5 6.5',
  dance: 'M9 4.6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M9 7.8 7 12l2.5 1.5L8 20m1.5-6.5L13 19M7 9.5l3.4-1.2 3.1 2.2 2.5-.5M17 5.5v7.2M17 12.7a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8M17 5.5l3-.8v2.6l-3 .8',
  close: 'M6 6l12 12M18 6 6 18',
  gear: 'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6M19.4 13.5a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.6 1.1v.2a1.8 1.8 0 1 1-3.6 0v-.1a1.5 1.5 0 0 0-2.6-1.1l-.1.1A1.8 1.8 0 1 1 5.6 15l.1-.1a1.5 1.5 0 0 0-1.1-2.6h-.2a1.8 1.8 0 1 1 0-3.6h.1a1.5 1.5 0 0 0 1.1-2.6l-.1-.1A1.8 1.8 0 1 1 8.1 3.4l.1.1a1.5 1.5 0 0 0 1.7.3h.1a1.5 1.5 0 0 0 .9-1.4v-.2a1.8 1.8 0 1 1 3.6 0v.1a1.5 1.5 0 0 0 2.6 1.1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1.1 2.6h.2a1.8 1.8 0 1 1 0 3.6h-.1a1.5 1.5 0 0 0-1.4.9',
  check: 'M5 12.5 9.5 17 19 7.5',
  trash: 'M5 7h14M10 7V5h4v2M6.5 7l.8 12h9.4l.8-12M10.5 10.5v5M13.5 10.5v5',
  share: 'M12 15.5V4m0 0L8.5 7.5M12 4l3.5 3.5M5.5 13v6.5h13V13',
  shuffle: 'M4 7h3.5l9 10H20M4 17h3.5l3-3.4M14 8.6l2.5-1.6H20M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5',
  hold: 'M9 5.5v13M15 5.5v13',
  play: 'M7.5 5.5 18 12 7.5 18.5z',
  // An open book: the readings, which are the one thing in here made of words.
  read: 'M12 7.2C10.4 5.9 8.4 5.4 5.5 5.5v11c2.9-.1 4.9.4 6.5 1.7 1.6-1.3 3.6-1.8 6.5-1.7v-11c-2.9-.1-4.9.4-6.5 1.7zM12 7.2v10.9',
  plus: 'M12 5.5v13M5.5 12h13',
  mic: 'M12 4.5a2.6 2.6 0 0 1 2.6 2.6v4.6a2.6 2.6 0 0 1-5.2 0V7.1A2.6 2.6 0 0 1 12 4.5M6.5 11.2a5.5 5.5 0 0 0 11 0M12 16.7V20',
};

/** An icon, or nothing at all if the name is unknown — a missing glyph should
 *  never take a button with it. */
export function icon(name: string, size = 22): SVGElement | null {
  const d = PATHS[name];
  if (!d) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

export interface SliderOptions {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** How the number reads. Defaults to two decimals. */
  format?: (value: number) => string;
  onInput: (value: number) => void;
  /**
   * On release rather than while dragging.
   *
   * For anything where acting on every intermediate value is wrong — seeking a
   * reading refetches and re-decodes audio, so a drag across a twenty-minute
   * essay would fire a hundred of them. `onInput` moves the readout, this does
   * the work.
   */
  onChange?: (value: number) => void;
  /** Read back later, to follow something that is moving on its own. */
  ref?: (input: HTMLInputElement) => void;
}

/**
 * A labelled range, with its value showing.
 *
 * `input` rather than `change`, because the whole point of a look control is
 * watching him change while your thumb is on it — and `touch-action: none` on
 * the track, or the browser treats the drag as a scroll and the slider only
 * moves if you happen to start vertically.
 */
export function slider(options: SliderOptions): HTMLElement {
  const format = options.format ?? ((v: number) => v.toFixed(2));
  const readout = el('b', {}, format(options.value));
  const input = el('input', {
    type: 'range',
    min: String(options.min),
    max: String(options.max),
    step: String(options.step),
    value: String(options.value),
  }) as HTMLInputElement;
  input.addEventListener('input', () => {
    const value = Number(input.value);
    readout.textContent = format(value);
    options.onInput(value);
  });
  if (options.onChange) {
    input.addEventListener('change', () => options.onChange!(Number(input.value)));
  }
  /* Handed back so a caller can write to it as well as read from it — the
     readout has to move with the value, and nothing else knows where it is. */
  options.ref?.(Object.assign(input, { readout }) as HTMLInputElement & { readout: HTMLElement });
  return el('label.slider', {},
    el('div.cap', {}, el('span', {}, options.label), readout),
    input);
}

/** A tap that cannot be a scroll or a text selection — every button here. */
export function button(spec: string, onTap: () => void, ...children: Child[]) {
  const classes = spec.replace(/^button\.?/, '').replace(/^\.+|\.+$/g, '');
  const node = el(classes ? `button.${classes}` : 'button', { type: 'button' }, ...children);
  node.addEventListener('click', (e) => { e.preventDefault(); onTap(); });
  return node;
}
