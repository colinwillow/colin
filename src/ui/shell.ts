// The app around him: which screen is up, and what each one is allowed to do.
//
// Every screen is a small object that says what goes in the four regions — the
// header, the space either side of him, the tray under him, and the tab bar —
// plus how the camera should frame him while it is open. A screen that wants the
// whole display instead returns a `cover`, and the regions are hidden under it.
//
// HE IS NEVER COVERED UP WITHOUT A REASON. That is the shape of the whole thing:
// the render is the page and the controls are arranged around it, so choosing a
// jacket happens while looking at the jacket. Only the screens that are genuinely
// not about him — the room list, the gallery, the settings — take the screen.
import type { ShotName } from '../shot';
import { el, fill, icon, button } from './dom';
import type { UiContext } from './context';

export interface Screen {
  id: string;
  /** Into the header. A screen with no header gets none, not an empty bar. */
  head?: () => Node | null;
  /** Either side of him — the hub on Home, the slot rail on Outfits. */
  body?: () => Node[];
  /** Under him, above the tab bar. */
  tray?: () => Node | null;
  /** Instead of all of the above. */
  cover?: () => HTMLElement;
  /** Default true. The camera screen and the gallery hide it. */
  tabs?: boolean;
  /** How to frame him here. `undefined` leaves the framing alone, which is what
   *  a screen that is not about looking at him should do. */
  shot?: ShotName | null;
  enter?: () => void;
  exit?: () => void;
  /** Per frame, while this screen is up — a scrubber, a level meter. */
  update?: (dt: number) => void;
}

export type ScreenFactory = (ctx: UiContext) => Screen;

export interface Shell {
  go: (route: string) => void;
  back: () => void;
  readonly route: string;
  toast: (message: string) => void;
  flash: () => void;
  update: (dt: number) => void;
  /** Rebuild the current screen in place — after a choice changes what it shows. */
  refresh: () => void;
}

interface Tab { id: string; label: string; icon: string }

const TABS: Tab[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'outfits', label: 'Style', icon: 'style' },
  { id: 'gallery', label: 'Gallery', icon: 'gallery' },
  { id: 'more', label: 'More', icon: 'more' },
];

export function createShell(
  root: HTMLElement,
  screens: Record<string, ScreenFactory>,
  context: Omit<UiContext, 'shell'>,
): Shell {
  const head = el('div#head');
  const body = el('div#body');
  const tray = el('div#tray');
  const tabs = el('nav#tabs.glass');
  const toastNode = el('div#toast');
  const flashNode = el('div#flash');

  /* The talking controls already exist in the document and are already wired to
     `talk.ts` by id. Moving the nodes rather than rebuilding them keeps every
     one of those listeners intact — and the microphone button becomes the middle
     of the tab bar, because talking to him is the point of the app and a thing
     the point of the app should not be three taps away. */
  const talk = document.getElementById('talk');
  const mic = document.getElementById('mic');

  root.append(head, body, tray);
  if (talk) root.append(talk);
  root.append(tabs, toastNode, flashNode);

  let current: Screen | null = null;
  let route = '';
  /** Where `back` goes, most recent last. Never more than a few deep. */
  const history: string[] = [];
  let cover: HTMLElement | null = null;

  const shell: Shell = {
    go, back, get route() { return route; }, toast, flash, update, refresh,
  };
  const ctx = { ...context, shell } as UiContext;

  function buildTabs() {
    const nodes: Node[] = [];
    for (const tab of TABS) {
      const node = button(`${route === tab.id ? 'on' : ''}`, () => go(tab.id),
        icon(tab.icon, 21), el('span', {}, tab.label));
      nodes.push(node);
      // The microphone goes in the middle of the row, between Style and Gallery.
      if (tab.id === 'outfits' && mic) nodes.push(mic);
    }
    fill(tabs, ...nodes);
  }

  function render() {
    if (!current) return;
    cover?.remove();
    cover = null;

    if (current.cover) {
      cover = current.cover();
      root.appendChild(cover);
      head.textContent = '';
      body.textContent = '';
      tray.textContent = '';
    } else {
      fill(head, current.head?.() ?? null);
      fill(body, ...(current.body?.() ?? []));
      fill(tray, current.tray?.() ?? null);
    }
    const showTabs = current.tabs !== false;
    tabs.classList.toggle('hide', !showTabs);
    if (talk) talk.style.display = showTabs ? '' : 'none';
    buildTabs();
    measure();
  }

  /**
   * Tell the camera how much of the screen this screen is sitting on.
   *
   * Measured rather than declared: the tray on Poses is three rows deep and the
   * one on Home is nothing at all, and every attempt to keep a number per screen
   * in step with the markup would be wrong by the second edit. After a layout,
   * the heights are right there to be read.
   */
  function measure() {
    requestAnimationFrame(() => {
      const height = window.innerHeight || 1;
      const under = (node: HTMLElement | null) =>
        (node && node.offsetParent !== null ? node.offsetHeight : 0);
      context.shots.safe.top = under(head) / height;
      context.shots.safe.bottom =
        (under(tray) + under(talk) + (cover ? 0 : under(tabs))) / height;
    });
  }

  function go(next: string) {
    const factory = screens[next];
    if (!factory) { console.warn(`ui: no screen "${next}"`); return; }
    if (next === route) { refresh(); return; }
    current?.exit?.();
    if (route && route !== next) {
      const at = history.indexOf(next);
      // Going back to something already in the trail truncates it rather than
      // growing a loop you can never walk out of.
      if (at >= 0) history.length = at;
      else history.push(route);
      if (history.length > 8) history.shift();
    }
    route = next;
    current = factory(ctx);
    if (current.shot !== undefined) context.stage.frame(current.shot);
    current.enter?.();
    render();
  }

  function back() {
    const previous = history.pop();
    // Nothing behind this screen is not an error; it just means Home.
    const to = previous ?? 'home';
    current?.exit?.();
    route = to;
    current = screens[to](ctx);
    if (current.shot !== undefined) context.stage.frame(current.shot);
    current.enter?.();
    render();
  }

  function refresh() {
    if (!current) return;
    // Rebuilt from the same factory, so a screen never has to diff itself: the
    // screens are small enough that throwing the DOM away is cheaper than
    // keeping track of what changed.
    const rebuilt = screens[route](ctx);
    rebuilt.enter = undefined;   // already entered; this is the same screen
    const { exit, update: tick } = current;
    current = { ...rebuilt, exit, update: tick ?? rebuilt.update };
    render();
  }

  let toastTimer = 0;
  function toast(message: string) {
    toastNode.textContent = message;
    toastNode.classList.add('on');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastNode.classList.remove('on'), 1900);
  }

  function flash() {
    flashNode.classList.remove('go');
    // Forcing a reflow is what lets the same animation run twice in a row.
    void flashNode.offsetWidth;
    flashNode.classList.add('go');
  }

  function update(dt: number) { current?.update?.(dt); }

  window.addEventListener('resize', measure);

  go('home');
  return shell;
}
