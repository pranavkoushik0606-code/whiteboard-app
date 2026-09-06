import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import {
  signup,
  createBoard,
  invite,
  openBoard,
  apiRaw,
  canvasObjectIds,
  selectTool,
  dragOnCanvas,
  type TestUser,
} from './helpers';

/**
 * Sprint 5 — the first sprint whose results are visible without knowing what to
 * look for: board thumbnails, PDF export, a clear-canvas button, and a canvas
 * that follows the theme.
 */
test.describe('board tools', () => {
  let alice: TestUser;
  let bob: TestUser;
  let boardId: string;

  test.beforeEach(async () => {
    alice = await signup('Alice');
    bob = await signup('Bob');
    const board = await createBoard(alice, 'Tooled Board');
    boardId = board._id;
    await invite(alice, boardId, bob.user.email, 'editor');
  });

  const drawRect = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
    await selectTool(page, 'Rectangle');
    await dragOnCanvas(page, from, to);
    await selectTool(page, 'Select');
  };

  test('clear canvas empties the board for everyone', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    const bobPage = await openBoard(browser, bob, boardId);

    await drawRect(alicePage, { x: 120, y: 120 }, { x: 240, y: 240 });
    await drawRect(alicePage, { x: 300, y: 120 }, { x: 400, y: 220 });
    await expect.poll(() => canvasObjectIds(bobPage)).toHaveLength(2);

    await alicePage.getByTitle('Clear canvas', { exact: true }).click();
    await expect(alicePage.getByText('Clear this board?')).toBeVisible();
    await alicePage.getByTitle('Confirm clear canvas', { exact: true }).click();

    await expect.poll(() => canvasObjectIds(alicePage)).toHaveLength(0);
    await expect
      .poll(() => canvasObjectIds(bobPage), { message: 'the clear was not broadcast' })
      .toHaveLength(0);

    const fresh = await openBoard(browser, alice, boardId);
    expect(await canvasObjectIds(fresh)).toHaveLength(0);

    await alicePage.context().close();
    await bobPage.context().close();
    await fresh.context().close();
  });

  test('cancelling the clear confirmation changes nothing', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    await drawRect(alicePage, { x: 120, y: 120 }, { x: 240, y: 240 });

    await alicePage.getByTitle('Clear canvas', { exact: true }).click();
    await alicePage.getByRole('button', { name: 'Cancel' }).click();
    await expect(alicePage.getByText('Clear this board?')).toBeHidden();

    expect(await canvasObjectIds(alicePage)).toHaveLength(1);
    const { body } = await apiRaw('GET', `/boards/${boardId}`, { token: alice.token });
    expect(body.objects).toHaveLength(1);

    await alicePage.context().close();
  });

  const thumbnail = async () => {
    const { body } = await apiRaw('GET', '/boards', { token: alice.token });
    return body.owned.find((b: any) => b._id === boardId)?.thumbnail || '';
  };

  const leaveBoard = async (page: Page) => {
    await page.getByRole('button').first().click(); // back arrow → /dashboard
    await expect(page.getByText('Tooled Board')).toBeVisible();
  };

  test('leaving a board writes a thumbnail for the dashboard', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    await drawRect(alicePage, { x: 120, y: 120 }, { x: 320, y: 320 });

    // The capture happens in the canvas teardown, so it needs a real unmount.
    await leaveBoard(alicePage);

    await expect
      .poll(thumbnail, { message: 'no thumbnail was written on the way out' })
      .toContain('data:image/jpeg');

    // And the dashboard card actually renders it rather than the placeholder.
    await alicePage.reload();
    await expect(alicePage.locator('img[src^="data:image/jpeg"]')).toBeVisible();

    await alicePage.context().close();
  });

  test('re-opening a board does not blank its thumbnail', async ({ browser }) => {
    const first = await openBoard(browser, alice, boardId);
    await drawRect(first, { x: 120, y: 120 }, { x: 320, y: 320 });
    await leaveBoard(first);
    await expect.poll(thumbnail).toContain('data:image/jpeg');
    await first.context().close();

    // React StrictMode mounts the canvas, tears it down, and mounts it again.
    // That throwaway teardown sees a canvas whose objects have not loaded yet —
    // capturing it unconditionally would stamp a blank over what we just saved.
    const second = await openBoard(browser, alice, boardId);
    // The bad write, if it happens, is issued during that teardown, well before
    // __canvasReady flips. This is long enough for it to have landed.
    await second.waitForTimeout(500);
    expect(await thumbnail(), 'opening a board destroyed its thumbnail').toContain(
      'data:image/jpeg'
    );

    await second.context().close();
  });

  test('the canvas follows the theme', async ({ browser }) => {
    const light = await openBoard(browser, alice, boardId, { theme: 'light' });
    expect(await light.evaluate(() => (window as any).__fabricCanvas.backgroundColor)).toBe(
      '#ffffff'
    );
    await light.context().close();

    const dark = await openBoard(browser, alice, boardId, { theme: 'dark' });
    expect(
      await dark.evaluate(() => (window as any).__fabricCanvas.backgroundColor),
      'the canvas is a bitmap — a dark class on <html> does not reach it'
    ).toBe('#171717');

    // A near-black default pen on a near-black canvas draws nothing visible.
    await drawRect(dark, { x: 120, y: 120 }, { x: 240, y: 240 });
    const stroke = await dark.evaluate(
      () => (window as any).__fabricCanvas.getObjects()[0].stroke
    );
    expect(stroke, 'the default stroke should have flipped with the theme').toBe('#f5f5f5');

    await dark.context().close();
  });

  test('export as PDF produces a real PDF', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    await drawRect(alicePage, { x: 120, y: 120 }, { x: 240, y: 240 });

    await alicePage.getByTitle('Export', { exact: true }).click();
    const downloadPromise = alicePage.waitForEvent('download');
    await alicePage.getByText('Export as PDF').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('Tooled Board.pdf');
    const path = await download.path();
    expect(path).toBeTruthy();
    const bytes = readFileSync(path!);
    // jspdf has been an unused dependency since the first commit; this is the
    // first thing that proves it actually runs.
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect(bytes.byteLength).toBeGreaterThan(1000);

    await alicePage.context().close();
  });
});
