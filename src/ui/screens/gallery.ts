// Everything that has been taken, out of IndexedDB.
//
// Object URLs are handed out per thumbnail and revoked when the screen goes,
// because a blob URL keeps its blob alive for the life of the document and a
// gallery that is opened twenty times would otherwise be holding twenty copies
// of every picture it has ever shown.
import { el, icon, button, fill } from '../dom';
import { sharePhoto, type Photo } from '../../photos';
import type { UiContext } from '../context';
import type { Screen } from '../shell';

export const gallery = (ctx: UiContext): Screen => {
  const urls: string[] = [];
  const url = (blob: Blob) => { const u = URL.createObjectURL(blob); urls.push(u); return u; };

  let photos: Photo[] = [];
  let selecting = false;
  const picked = new Set<string>();

  const grid = el('div.grid');
  const body = el('div.body', {}, el('div.empty', {}, 'Loading…'));
  const action = el('button.text', { type: 'button' }, 'Select');
  const title = el('div.title', {}, 'Gallery');

  const paint = () => {
    title.textContent = selecting
      ? (picked.size ? `${picked.size} selected` : 'Select photos')
      : 'Gallery';
    action.textContent = selecting ? 'Done' : 'Select';

    if (!photos.length) {
      fill(body, el('div.empty', {},
        'No photos yet. ',
        button('text', () => ctx.shell.go('camera'), 'Open the camera'),
        ' and take one.'));
      return;
    }

    fill(grid, ...photos.map((photo) => {
      const tile = el(`div.shot${picked.has(photo.id) ? '.picked' : ''}`, {},
        el('img', { src: url(photo.thumb), alt: '', loading: 'lazy' }));
      if (selecting) tile.appendChild(el('div.mark', {}, picked.has(photo.id) ? icon('check', 13) : null));
      tile.addEventListener('click', () => {
        if (!selecting) { open(photo); return; }
        if (picked.has(photo.id)) picked.delete(photo.id);
        else picked.add(photo.id);
        paint();
      });
      return tile;
    }));

    const bar = selecting && picked.size
      ? el('div.pills', { style: 'margin-top:14px' },
        button('action.quiet', () => { picked.clear(); paint(); }, 'Clear'),
        button('action', async () => {
          const ids = [...picked];
          await Promise.all(ids.map((id) => ctx.camera.remove(id)));
          picked.clear();
          ctx.shell.toast(`Deleted ${ids.length}`);
          await reload();
        }, icon('trash', 18), 'Delete'))
      : null;

    fill(body, grid, ...(bar ? [bar] : []));
  };

  const open = (photo: Photo) => {
    const viewer = el('div#viewer', {},
      el('header', {},
        button('chip', () => viewer.remove(), icon('close', 20)),
        el('div.title', {}, new Date(photo.at).toLocaleString(undefined,
          { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })),
        el('div.chip', { style: 'visibility:hidden' })),
      el('img', { src: url(photo.full), alt: '' }),
      el('div.bar', {},
        button('', async () => {
          const how = await sharePhoto(photo);
          ctx.shell.toast(how === 'shared' ? 'Sent to the share sheet' : 'Downloaded');
        }, icon('share', 22), el('span', {}, 'Save')),
        button('', async () => {
          await ctx.camera.remove(photo.id);
          viewer.remove();
          ctx.shell.toast('Deleted');
          await reload();
        }, icon('trash', 22), el('span', {}, 'Delete'))));
    // Onto the interface layer rather than into the scrolling list, so it covers
    // the header too.
    document.getElementById('ui')!.appendChild(viewer);
  };

  const reload = async () => {
    photos = await ctx.camera.list();
    if (!photos.length) { selecting = false; picked.clear(); }
    paint();
  };

  return {
    id: 'gallery',
    tabs: false,

    enter: () => { void reload(); },
    exit: () => {
      document.getElementById('viewer')?.remove();
      for (const u of urls) URL.revokeObjectURL(u);
      urls.length = 0;
    },

    cover: () => {
      action.onclick = () => {
        selecting = !selecting;
        if (!selecting) picked.clear();
        paint();
      };
      return el('div.cover', {},
        el('header', {},
          button('chip', () => ctx.shell.back(), icon('back', 20)),
          title,
          action),
        body);
    },
  };
};
