import { test, expect, type Page } from '@playwright/test';
import type { Socket } from 'socket.io-client';
import {
  signup,
  createBoard,
  invite,
  openBoard,
  connectSocket,
  raceEvents,
  canvasRect,
  setViewport,
  moveMouseOnCanvas,
  selectTool,
  dragOnCanvas,
  canvasObjects,
  type TestUser,
} from './helpers';

/**
 * Sprint 6 — pointing at the right things.
 *
 * Cursors were broadcast as raw `clientX/clientY`, which is only ever correct
 * when both people happen to be looking at the same part of the board at the
 * same zoom. Everything shared now travels in scene coordinates and is
 * re-projected through the receiver's own viewport.
 *
 * The highlighter is here for the same reason: it was set via `brush.opacity`,
 * a property Fabric 6's PencilBrush does not have, so the ink was opaque.
 */
test.describe('cursors and ink', () => {
  let alice: TestUser;
  let bob: TestUser;
  let boardId: string;

  test.beforeEach(async () => {
    alice = await signup('Alice');
    bob = await signup('Bob');
    const board = await createBoard(alice, 'Pointing Board');
    boardId = board._id;
    await invite(alice, boardId, bob.user.email, 'editor');
  });

  /** A joined listener socket, used to read what actually goes over the wire. */
  const observer = async (as: TestUser): Promise<Socket> => {
    const socket = await connectSocket(as);
    socket.emit('board:join', { boardId });
    await raceEvents(socket, ['presence:sync']);
    return socket;
  };

  /**
   * Moves once to settle any pending throttled emit, then reports the payload
   * of the move to `at`. Playwright dispatches one mousemove per `mouse.move`,
   * so attaching after the settle move means we read exactly the one we asked
   * for.
   */
  const cursorPayloadFor = async (page: Page, socket: Socket, at: { x: number; y: number }) => {
    await moveMouseOnCanvas(page, { x: 10, y: 10 });
    await page.waitForTimeout(150);
    const next = raceEvents(socket, ['cursor:update']);
    await moveMouseOnCanvas(page, at);
    const { payload } = await next;
    return payload as { x: number; y: number };
  };

  test('a pan does not move where the cursor is reported to be', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    const watcher = await observer(bob);

    const unpanned = await cursorPayloadFor(alicePage, watcher, { x: 300, y: 200 });
    expect(unpanned.x).toBeCloseTo(300, 0);
    expect(unpanned.y).toBeCloseTo(200, 0);

    // Same physical pixel, board scrolled 120/80 to the right and down. The
    // point under the pointer is now a different point on the board, and that
    // is what has to go over the wire.
    await setViewport(alicePage, [1, 0, 0, 1, 120, 80]);
    const panned = await cursorPayloadFor(alicePage, watcher, { x: 300, y: 200 });
    expect(panned.x, 'the pan was not subtracted — this is still clientX').toBeCloseTo(180, 0);
    expect(panned.y).toBeCloseTo(120, 0);

    watcher.disconnect();
    await alicePage.context().close();
  });

  test('zoom is divided out of the reported cursor position', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    const watcher = await observer(bob);

    await setViewport(alicePage, [2, 0, 0, 2, 0, 0]);
    const payload = await cursorPayloadFor(alicePage, watcher, { x: 300, y: 200 });
    expect(payload.x, 'zoom was not divided out').toBeCloseTo(150, 0);
    expect(payload.y).toBeCloseTo(100, 0);

    watcher.disconnect();
    await alicePage.context().close();
  });

  /** Where the remote cursor is drawn, measured from the canvas element. */
  const renderedCursorAt = async (page: Page) => {
    const cursor = page.getByTestId('presence-cursor');
    const box = await cursor.boundingBox();
    if (!box) throw new Error('No remote cursor is rendered');
    const rect = await canvasRect(page);
    return { x: box.x - rect.x, y: box.y - rect.y };
  };

  test('a remote cursor is drawn at the point the sender pointed at', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    const bobPage = await openBoard(browser, bob, boardId);

    // Bob is looking 150/60 further left and up the board than Alice is.
    await setViewport(bobPage, [1, 0, 0, 1, 150, 60]);

    await moveMouseOnCanvas(alicePage, { x: 300, y: 200 });
    await expect(bobPage.getByTestId('presence-cursor')).toBeVisible();

    // Scene point (300, 200) sits at (450, 260) in Bob's shifted viewport. Sent
    // as raw screen pixels it would land back at (300, 200) on Bob's screen —
    // pointing at a different part of the board than Alice is.
    await expect
      .poll(async () => Math.round((await renderedCursorAt(bobPage)).x))
      .toBeCloseTo(450, -1);
    expect(Math.round((await renderedCursorAt(bobPage)).y)).toBeCloseTo(260, -1);

    await alicePage.context().close();
    await bobPage.context().close();
  });

  test('panning carries remote cursors along with the board', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    const bobPage = await openBoard(browser, bob, boardId);

    await moveMouseOnCanvas(alicePage, { x: 300, y: 200 });
    await expect(bobPage.getByTestId('presence-cursor')).toBeVisible();
    await expect.poll(async () => Math.round((await renderedCursorAt(bobPage)).x)).toBeCloseTo(300, -1);

    // Alice has not moved. Bob scrolls the board; the cursor is pinned to a
    // point on the board, so it has to travel with it.
    await setViewport(bobPage, [1, 0, 0, 1, 100, 0]);
    await expect
      .poll(
        async () => Math.round((await renderedCursorAt(bobPage)).x),
        { message: 'the cursor did not re-project when the viewport moved' }
      )
      .toBeCloseTo(400, -1);

    await alicePage.context().close();
    await bobPage.context().close();
  });

  const strokeOf = (page: Page) =>
    page.evaluate(() => (window as any).__fabricCanvas.getObjects()[0]?.stroke);

  test('the highlighter lays down translucent ink', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);

    await selectTool(alicePage, 'Highlighter');
    await dragOnCanvas(alicePage, { x: 150, y: 150 }, { x: 350, y: 220 });
    await expect.poll(() => canvasObjects(alicePage)).toHaveLength(1);

    // Fabric 6's PencilBrush has no `opacity`, so the alpha has to be in the
    // colour. #1e1e1e is the light-theme default pen.
    expect(await strokeOf(alicePage), 'highlighter ink is opaque').toBe('rgba(30,30,30,0.4)');

    // And it has to survive the round trip, or it is only translucent for the
    // person who drew it.
    const fresh = await openBoard(browser, alice, boardId);
    expect(await strokeOf(fresh), 'the alpha was lost on the way to the database').toBe(
      'rgba(30,30,30,0.4)'
    );

    await alicePage.context().close();
    await fresh.context().close();
  });

  test('the pencil is still opaque', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);

    await selectTool(alicePage, 'Pencil');
    await dragOnCanvas(alicePage, { x: 150, y: 150 }, { x: 350, y: 220 });
    await expect.poll(() => canvasObjects(alicePage)).toHaveLength(1);

    expect(await strokeOf(alicePage), 'the alpha leaked onto every brush').toBe('#1e1e1e');

    await alicePage.context().close();
  });
});
