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
//
// AND THE DEFAULT IS ALMOST NOTHING. The app opens on `stage`, which is him in
// his room with a microphone and one chip in the corner. Everything else is a
// place you go on purpose. A tab bar along the bottom of the first thing you see
// makes it an app with a character in it; this way round it is a character, with
// an app folded up behind him.
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
  /**
   * What sits along the bottom.
   *
   *   app    the tab row on its glass panel — the workshop screens
   *   bare   the microphone and one chip, floating, nothing behind them
   *   none   nothing at all — the screens that take the whole display
   */
  chrome?: 'app' | 'bare' | 'none';
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
  const captions = document.getElementById('captions');

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

  function buildTabs(mode: 'app' | 'bare') {
    if (mode === 'bare') {
      /* Two things, held apart: the way back into the app on the left, the
         microphone in the middle where a thumb already is. Nothing is drawn
         behind them — on this screen the room is the background. */
      /* Three slots, and the outer two are both doors rather than controls: the
         app on the left, the transcript on the right. The captions chip lives
         here rather than floating above the text, because with the captions off
         — which is the default — there is no text for it to float above. */
      fill(tabs,
        button('chip.glass', () => go('home'), icon('grid', 19)),
        ...(mic ? [mic] : []),
        ...(captions ? [captions] : [el('div.chip', { style: 'visibility:hidden' })]));
      return;
    }
    /* Back where it came from. `fill` above empties the dock, so a chip left in
       it on the last screen would simply cease to exist on this one — moving a
       node is not the same as copying it, and this is the price of reusing the
       one the conversation already has its listeners on. */
    if (captions && talk) talk.insertBefore(captions, document.getElementById('wave'));
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
    const chrome = current.chrome ?? 'app';
    tabs.classList.toggle('hide', chrome === 'none');
    tabs.classList.toggle('bare', chrome === 'bare');
    if (talk) talk.style.display = chrome === 'none' ? 'none' : '';
    if (chrome !== 'none') buildTabs(chrome);
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
    /* `exit` is the ORIGINAL one, because it may close over something the
       original `enter` set up and this rebuild never ran an `enter`.
       `update` is the REBUILT one, and that is not a detail: a per-frame hook
       exists to write to an element — a scrubber following playback — and the
       element it closed over was thrown away by this very rebuild. Keeping the
       old hook leaves it writing to detached DOM for ever, which looks exactly
       like a screen that has quietly stopped ticking. */
    const { exit } = current;
    current = { ...rebuilt, exit };
    render();
  }

  /**
   * The front door.
   *
   * Not a splash screen — a gesture collector with a face on it. Audio cannot
   * start without a tap, the microphone cannot open without a tap, and the
   * speech recogniser cannot start without a tap, so there has to BE a tap; the
   * only choice is whether it is a button labelled "talk" tucked in a corner or
   * the first thing you see. Making it the first thing you see is what turns
   * "open the app, find the control, press it" into "open the app and he says
   * hello", which is the entire feeling being aimed at.
   *
   * It shows every time. That is not a missing "remember me": the browser will
   * not carry an audio grant across a page load, so there is nothing to
   * remember — and a person who wanted to be talked to is not annoyed by being
   * asked whether they want to be talked to.
   */
  function buildIntro() {
    const canTalk = !!mic && !(mic as HTMLButtonElement).disabled;
    const intro = el('div#intro');
    const dismiss = () => {
      intro.classList.add('gone');
      // Removed rather than hidden: it covers the whole screen, and a covering
      // element that is merely transparent still eats every tap behind it.
      setTimeout(() => intro.remove(), 600);
    };

    intro.append(
      el('div.mark', { style: `background-image: url(${import.meta.env.BASE_URL}icons/apple-touch-icon.png)` }),
      el('h1', {}, 'Colin'),
      el('p', {}, canTalk
        ? 'He is in the kitchen. He does not know who you are.'
        : 'This browser has no speech recognition, so he cannot hear you — but he is still in there.'),
      canTalk
        ? button('action', () => { (mic as HTMLButtonElement).click(); dismiss(); },
          icon('mic', 19), 'Say hello')
        : button('action', dismiss, 'Have a look'),
    );
    if (canTalk) intro.appendChild(button('text', dismiss, 'Just look around'));
    root.appendChild(intro);
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

  /* Him first. The hub is one chip away and nothing is lost by starting behind
     it; starting IN it would make the app the thing and him the content. */
  go('stage');
  buildIntro();
  return shell;
}
