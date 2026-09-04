import { test, expect } from '@playwright/test';
import {
  signup,
  createBoard,
  invite,
  openBoard,
  canvasObjectIds,
  selectTool,
  dragOnCanvas,
  type TestUser,
} from './helpers';

/**
 * The safety net for every sprint that touches the sync path.
 *
 * Two real browser contexts join the same board. Anything that breaks the
 * socket broadcast, the persistence write, or the rehydrate-on-load path shows
 * up here — none of which is visible from reading a diff.
 */
test.describe('realtime collaboration', () => {
  let alice: TestUser;
  let bob: TestUser;
  let boardId: string;

  test.beforeEach(async () => {
    alice = await signup('Alice');
    bob = await signup('Bob');
    const board = await createBoard(alice, 'Collab Board');
    boardId = board._id;
    await invite(alice, boardId, bob.user.email, 'editor');
  });

  test('a shape drawn by one user appears on the other user’s canvas', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    const bobPage = await openBoard(browser, bob, boardId);

    expect(await canvasObjectIds(alicePage)).toHaveLength(0);
    expect(await canvasObjectIds(bobPage)).toHaveLength(0);

    await selectTool(alicePage, 'Rectangle');
    await dragOnCanvas(alicePage, { x: 150, y: 120 }, { x: 320, y: 260 });

    const [drawnId] = await canvasObjectIds(alicePage);
    expect(drawnId, 'Alice should have drawn exactly one object').toBeTruthy();

    // The broadcast is the thing under test — poll Bob until it lands.
    await expect
      .poll(() => canvasObjectIds(bobPage), { message: 'Bob never received the rectangle' })
      .toEqual([drawnId]);

    await alicePage.context().close();
    await bobPage.context().close();
  });

  test('a drawn shape survives a reload', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);

    await selectTool(alicePage, 'Rectangle');
    await dragOnCanvas(alicePage, { x: 150, y: 120 }, { x: 320, y: 260 });
    const [drawnId] = await canvasObjectIds(alicePage);
    expect(drawnId).toBeTruthy();

    // A fresh context exercises GET /boards/:id -> enliven, not the socket.
    const bobPage = await openBoard(browser, bob, boardId);
    await expect
      .poll(() => canvasObjectIds(bobPage), { message: 'Object was not persisted to the database' })
      .toEqual([drawnId]);

    await alicePage.context().close();
    await bobPage.context().close();
  });
});
