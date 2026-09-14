// Taking a picture of him, and keeping it.
//
// The shot is the WebGL drawing buffer, which is only readable in the same tick
// as the render that filled it — the browser throws the buffer away at the end
// of the frame unless the context was made with `preserveDrawingBuffer`, and
// asking for that costs a full-screen copy on every single frame for the sake of
// one button. So a capture is a flag: the render loop calls `afterRender` and
// that is where the pixels are read, synchronously, in the one place they exist.
//
// Nothing in the DOM is in the picture, which is the point — the buttons, the
// captions and the chrome are all overlays, so the canvas is already the clean
// shot with no chrome to hide first.
//
// They live in IndexedDB rather than localStorage: a phone screenshot is a
// megabyte or two, and localStorage gives you five in total and stores them as
// strings, which costs another third on top.

export interface Photo {
  id: string;
  /** Epoch millis. */
  at: number;
  /** Full size, as taken. */
  full: Blob;
  /** A small one for the grid, so a gallery is not twenty full frames. */
  thumb: Blob;
  width: number;
  height: number;
  /** Where it was taken, for the caption under it. */
  scene?: string;
}

const DB = 'colin.photos';
const STORE = 'shots';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('at', 'at');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const run = async <T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>) => {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = body(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
};

/** The longest edge a stored full-size shot may have. A phone at 3× renders
 *  well past 3000px, and nothing looks better for it at four times the bytes. */
const MAX_EDGE = 2048;
const THUMB_EDGE = 420;

async function scaled(source: HTMLImageElement, edge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, edge / Math.max(source.width, source.height));
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', quality));
}

const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('could not decode the capture'));
  img.src = url;
});

export interface Camera {
  /** Take one. Resolves once the next frame has been rendered and stored. */
  capture: (scene?: string) => Promise<Photo>;
  /** Call at the very end of the render loop, after the last `render`. */
  afterRender: () => void;
  /** Newest first. */
  list: () => Promise<Photo[]>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
  /** True between the shutter and the pixels being read. */
  readonly pending: boolean;
}

export function createCamera(canvas: HTMLCanvasElement): Camera {
  let waiting: { scene?: string; resolve: (p: Photo) => void; reject: (e: unknown) => void } | null = null;

  const afterRender = () => {
    if (!waiting) return;
    const shot = waiting;
    waiting = null;
    let url: string;
    try {
      // Synchronous, and deliberately so: this is the one moment the drawing
      // buffer still holds the frame.
      url = canvas.toDataURL('image/jpeg', 0.94);
    } catch (err) { shot.reject(err); return; }

    void (async () => {
      try {
        const img = await load(url);
        const [full, thumb] = await Promise.all([
          scaled(img, MAX_EDGE, 0.9),
          scaled(img, THUMB_EDGE, 0.8),
        ]);
        const photo: Photo = {
          id: `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
          at: Date.now(),
          full,
          thumb,
          width: img.width,
          height: img.height,
          scene: shot.scene,
        };
        await run('readwrite', (store) => store.put(photo));
        shot.resolve(photo);
      } catch (err) { shot.reject(err); }
    })();
  };

  return {
    capture: (scene) => new Promise<Photo>((resolve, reject) => {
      // One at a time. A second tap before the first frame has been read would
      // otherwise drop the first promise on the floor.
      if (waiting) { reject(new Error('already taking one')); return; }
      waiting = { scene, resolve, reject };
    }),
    afterRender,
    list: async () => {
      const all = await run<Photo[]>('readonly', (store) => store.getAll() as IDBRequest<Photo[]>);
      return all.sort((a, b) => b.at - a.at);
    },
    remove: async (id) => { await run('readwrite', (store) => store.delete(id) as unknown as IDBRequest<void>); },
    clear: async () => { await run('readwrite', (store) => store.clear() as unknown as IDBRequest<void>); },
    get pending() { return waiting !== null; },
  };
}

/**
 * Hand one to the operating system.
 *
 * The share sheet is the only route to the camera roll on iOS — a download
 * attribute on an anchor is ignored there, and a blob URL opened in a tab shows
 * a picture with no way to keep it. Everywhere else, a download is exactly
 * right, so both are here and the sheet is tried first.
 */
export async function sharePhoto(photo: Photo): Promise<'shared' | 'downloaded'> {
  const name = `colin-${new Date(photo.at).toISOString().slice(0, 19).replace(/[:T]/g, '')}.jpg`;
  const file = new File([photo.full], name, { type: 'image/jpeg' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      // A cancelled sheet is not a failure and must not fall through to a
      // download the person just declined.
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
    }
  }
  const url = URL.createObjectURL(photo.full);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
