import { test, expect, type Page } from '@playwright/test';
import { API_URL } from './config';
import {
  canvasImages,
  canvasObjectIds,
  createBoard,
  invite,
  makePng,
  openBoard,
  sendImageEvent,
  setViewport,
  signup,
  uploadRaw,
  type TestUser,
} from './helpers';

/**
 * Sprint 9 — images.
 *
 * Two halves that have to agree: the upload endpoint decides what is stored and
 * how it is served, and the canvas decides how it is loaded. The middle of that
 * is CORS, and it is where the whole feature quietly fails — an image that
 * renders perfectly can still have tainted the canvas, taking export and the
 * dashboard thumbnail down with it.
 */

let alice: TestUser;

test.beforeAll(async () => {
  alice = await signup('Alice');
});

/** Waits for the upload round trip to finish and the image to be on the canvas. */
async function waitForImages(page: Page, count = 1) {
  await expect.poll(async () => (await canvasImages(page)).length, { timeout: 20_000 }).toBe(count);
  return canvasImages(page);
}

// ---------------------------------------------------------------------------
// The upload endpoint
// ---------------------------------------------------------------------------

test('an upload is stored under an extension taken from its media type, not its filename', async () => {
  // Declared a PNG, named a document. If the name picks the extension this
  // lands in a statically served directory as `.html`, on the API's own origin,
  // and everyone who opens it runs whatever is inside.
  const { status, body } = await uploadRaw(alice, {
    bytes: makePng(4, 4),
    filename: 'evil.html',
    type: 'image/png',
  });

  expect(status).toBe(201);
  expect(body.path).toMatch(/^\/uploads\/[^/]+\.png$/);
  expect(body.path).not.toContain('.html');

  const served = await fetch(`${API_URL}${body.path}`);
  expect(served.status).toBe(200);
  expect(served.headers.get('content-type')).toBe('image/png');
});

test('uploads are served cross-origin, and marked not to be sniffed', async ({ browser }) => {
  const { body } = await uploadRaw(alice, {
    bytes: makePng(4, 4),
    filename: 'ok.png',
    type: 'image/png',
  });
  const served = await fetch(`${API_URL}${body.path}`);

  // What the header buys, from a page on the client's origin, asserted before
  // the header itself so a failure here says what actually broke. The canvas asks for
  // these in CORS mode, which Cross-Origin-Resource-Policy does not govern — so
  // the header is invisible there and only shows up for a plain `<img>`, which
  // is every other way an upload might be displayed. helmet defaults it to
  // same-origin, and the API is never on the client's origin.
  const page = await browser.newPage();
  await page.goto('/login');
  const loaded = await page.evaluate((src) => {
    return new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = src;
    });
  }, `${API_URL}${body.path}`);
  expect(loaded).toBe(true);
  await page.close();

  expect(served.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  expect(served.headers.get('x-content-type-options')).toBe('nosniff');
});

test('a file that is not an image is refused with a 400', async () => {
  const { status, body } = await uploadRaw(alice, {
    bytes: Buffer.from('<script>alert(1)</script>'),
    filename: 'note.txt',
    type: 'text/plain',
  });

  expect(status).toBe(400);
  expect(body.message).toMatch(/PNG, JPEG, GIF and WebP/);
});

test('an oversized image is refused with a 413, not a 500', async () => {
  // Just over the 10 MB limit, and incompressible, so nothing shrinks it back
  // under the line on the way up.
  const noise = Buffer.alloc(11 * 1024 * 1024);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) & 0xff;

  const { status, body } = await uploadRaw(alice, {
    bytes: noise,
    filename: 'huge.png',
    type: 'image/png',
  });

  expect(status).toBe(413);
  expect(body.message).toMatch(/under 10 MB/);
});

// ---------------------------------------------------------------------------
// Placing one on the canvas
// ---------------------------------------------------------------------------

test('the toolbar picker uploads an image and centres it in the viewport', async ({ browser }) => {
  const board = await createBoard(alice, 'Picker');
  const page = await openBoard(browser, alice, board._id);

  await page.getByTitle('Insert image', { exact: true }).click();
  await page
    .locator('[data-testid="image-input"]')
    .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: makePng(1000, 600) });

  const [image] = await waitForImages(page);

  // Scaled to the 480px cap on the longest edge: 480/1000.
  expect(image.width).toBe(1000);
  expect(image.scaleX).toBeCloseTo(0.48, 4);

  const centre = await page.evaluate(() => {
    const c = (window as any).__fabricCanvas;
    return { x: c.getWidth() / 2, y: c.getHeight() / 2 };
  });
  expect(image.left).toBe(Math.round(centre.x - (1000 * 0.48) / 2));
  expect(image.top).toBe(Math.round(centre.y - (600 * 0.48) / 2));

  expect(image.src).toContain(`${API_URL}/uploads/`);
  await page.close();
});

test('a placed image loads with CORS, so the canvas stays exportable', async ({ browser }) => {
  const board = await createBoard(alice, 'Export');
  const page = await openBoard(browser, alice, board._id);

  await page
    .locator('[data-testid="image-input"]')
    .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: makePng(200, 200) });
  const [image] = await waitForImages(page);

  expect(image.crossOrigin).toBe('anonymous');

  // The real assertion. A cross-origin image drawn without CORS taints the
  // canvas, and every toDataURL after it throws — which is all export and the
  // dashboard thumbnail are.
  const result = await page.evaluate(() => {
    try {
      (window as any).__fabricCanvas.toDataURL({ format: 'png' });
      return 'ok';
    } catch (err) {
      return String(err);
    }
  });
  expect(result).toBe('ok');
  await page.close();
});

test('an image reaches everyone else on the board, and survives a reload', async ({ browser }) => {
  const bob = await signup('Bob');
  const board = await createBoard(alice, 'Shared images');
  await invite(alice, board._id, bob.user.email, 'editor');

  const alicePage = await openBoard(browser, alice, board._id);
  const bobPage = await openBoard(browser, bob, board._id);

  await alicePage
    .locator('[data-testid="image-input"]')
    .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: makePng(120, 90) });
  const [mine] = await waitForImages(alicePage);

  const [theirs] = await waitForImages(bobPage);
  expect(theirs.objectId).toBe(mine.objectId);
  expect(theirs.src).toBe(mine.src);
  // Fabric serializes crossOrigin next to src. Without it the receiving client
  // re-loads the same image *without* CORS and taints its own canvas instead.
  expect(theirs.crossOrigin).toBe('anonymous');

  await alicePage.close();
  await bobPage.close();

  const reopened = await openBoard(browser, alice, board._id);
  const [reloaded] = await waitForImages(reopened);
  expect(reloaded.src).toBe(mine.src);
  await reopened.close();
});

test('a dropped image lands where it was dropped, not where the board is panned to', async ({
  browser,
}) => {
  const board = await createBoard(alice, 'Drop');
  const page = await openBoard(browser, alice, board._id);

  // Panned away from the origin: the drop point in scene coordinates is 300,150
  // further along than the pixel it was dropped on.
  await setViewport(page, [1, 0, 0, 1, -300, -150]);
  await sendImageEvent(page, 'drop', makePng(100, 100), { x: 400, y: 250 });

  const [image] = await waitForImages(page);
  expect(image.left).toBe(700 - 50);
  expect(image.top).toBe(400 - 50);
  await page.close();
});

test('a pasted image is placed on the board', async ({ browser }) => {
  const board = await createBoard(alice, 'Paste');
  const page = await openBoard(browser, alice, board._id);

  await sendImageEvent(page, 'paste', makePng(64, 64));

  const [image] = await waitForImages(page);
  expect(image.src).toContain('/uploads/');
  await page.close();
});

test('dropping something that is not an image is left alone', async ({ browser }) => {
  const board = await createBoard(alice, 'Rejected');
  const page = await openBoard(browser, alice, board._id);

  await page.evaluate(() => {
    const file = new File(['not an image'], 'note.txt', { type: 'text/plain' });
    const dt = new DataTransfer();
    dt.items.add(file);
    document
      .querySelector('canvas.upper-canvas')!
      .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });

  await page.waitForTimeout(1_000);
  expect(await canvasImages(page)).toHaveLength(0);
  // And nothing was said about it either. A .txt dropped on a whiteboard is not
  // addressed to the board at all — it should not cost an upload round trip and
  // an error message. Anything reaching the server would surface here.
  await expect(page.locator('[data-testid="board-notice"]')).toHaveCount(0);
  await page.close();
});

test('a viewer has no image button, and a paste does nothing', async ({ browser }) => {
  const carol = await signup('Carol');
  const board = await createBoard(alice, 'Read only images');
  await invite(alice, board._id, carol.user.email, 'viewer');

  const page = await openBoard(browser, carol, board._id);
  await expect(page.getByTitle('Insert image', { exact: true })).toHaveCount(0);

  // The button is gone, but the file input it clicks is still in the document —
  // so the check that matters is the one on the way in, not the hidden control.
  // Placing it locally anyway is the Sprint 7 failure again: the socket drops
  // the write, and the viewer finds out only when they reload.
  await page
    .locator('[data-testid="image-input"]')
    .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: makePng(60, 60) });
  await page.waitForTimeout(1_500);
  expect(await canvasImages(page)).toHaveLength(0);

  await sendImageEvent(page, 'paste', makePng(50, 50));
  await page.waitForTimeout(1_500);
  expect(await canvasImages(page)).toHaveLength(0);
  expect(await canvasObjectIds(page)).toHaveLength(0);
  await page.close();
});
