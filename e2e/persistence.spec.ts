import { test, expect, type Page } from '@playwright/test';
import {
  signup,
  createBoard,
  invite,
  openBoard,
  canvasObjects,
  canvasObjectIds,
  selectTool,
  dragOnCanvas,
  clickOnCanvas,
  type TestUser,
} from './helpers';

/**
 * Sprint 2. The 10-second bulk auto-save is gone, so every mutation has to be
 * durable on its own socket event. Anything the socket path does not emit is
 * now silently lost on reload — these tests are what says it isn't.
 *
 * Each case reloads in a *fresh* context, so it reads back through
 * GET /boards/:id rather than trusting the drawing client's own canvas.
 */
test.describe('persistence without the bulk auto-save', () => {
  let alice: TestUser;
  let bob: TestUser;
  let boardId: string;

  test.beforeEach(async () => {
    alice = await signup('Alice');
    bob = await signup('Bob');
    const board = await createBoard(alice, 'Persistence Board');
    boardId = board._id;
    await invite(alice, boardId, bob.user.email, 'editor');
  });

  const drawRect = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
    await selectTool(page, 'Rectangle');
    await dragOnCanvas(page, from, to);
  };

  test('moving an object persists', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    await drawRect(alicePage, { x: 120, y: 120 }, { x: 240, y: 240 });

    const [before] = await canvasObjects(alicePage);
    expect(before).toBeTruthy();

    // Drag it well clear of where it was drawn.
    await selectTool(alicePage, 'Select');
    await dragOnCanvas(alicePage, { x: 180, y: 180 }, { x: 430, y: 330 });

    const [afterLocal] = await canvasObjects(alicePage);
    expect(afterLocal.left, 'the drag should have moved it locally').not.toBe(before.left);

    const bobPage = await openBoard(browser, bob, boardId);
    const [reloaded] = await canvasObjects(bobPage);
    expect(reloaded.objectId).toBe(before.objectId);
    expect(reloaded.left).toBeCloseTo(afterLocal.left, 0);
    expect(reloaded.top).toBeCloseTo(afterLocal.top, 0);

    await alicePage.context().close();
    await bobPage.context().close();
  });

  test('deleting an object persists', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    await drawRect(alicePage, { x: 120, y: 120 }, { x: 240, y: 240 });
    expect(await canvasObjectIds(alicePage)).toHaveLength(1);

    await selectTool(alicePage, 'Select');
    await clickOnCanvas(alicePage, { x: 180, y: 180 });
    await alicePage.keyboard.press('Delete');
    expect(await canvasObjectIds(alicePage)).toHaveLength(0);

    const bobPage = await openBoard(browser, bob, boardId);
    expect(
      await canvasObjectIds(bobPage),
      'the delete must have reached the database, not just the canvas'
    ).toHaveLength(0);

    await alicePage.context().close();
    await bobPage.context().close();
  });

  test('stacking order survives a reload', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);

    // Two side-by-side rectangles so either can be clicked unambiguously.
    await drawRect(alicePage, { x: 100, y: 120 }, { x: 200, y: 220 });
    await drawRect(alicePage, { x: 300, y: 120 }, { x: 400, y: 220 });

    const drawn = await canvasObjects(alicePage);
    expect(drawn).toHaveLength(2);
    const [first, second] = drawn;

    // Bring the first (currently bottom) to the front.
    await selectTool(alicePage, 'Select');
    await clickOnCanvas(alicePage, { x: 150, y: 170 });
    await alicePage.keyboard.press(']');

    const reordered = await canvasObjects(alicePage);
    expect(reordered.map((o) => o.objectId)).toEqual([second.objectId, first.objectId]);

    // The old bulk save was the only thing that ever wrote zIndex; without it
    // this ordering has to arrive over object:reorder.
    const bobPage = await openBoard(browser, bob, boardId);
    const persisted = await canvasObjects(bobPage);
    expect(persisted.map((o) => o.objectId)).toEqual([second.objectId, first.objectId]);

    await alicePage.context().close();
    await bobPage.context().close();
  });

  test('a reorder reaches other people live', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    const bobPage = await openBoard(browser, bob, boardId);

    await drawRect(alicePage, { x: 100, y: 120 }, { x: 200, y: 220 });
    await drawRect(alicePage, { x: 300, y: 120 }, { x: 400, y: 220 });

    await expect.poll(() => canvasObjectIds(bobPage)).toHaveLength(2);
    const [first, second] = await canvasObjects(alicePage);

    await selectTool(alicePage, 'Select');
    await clickOnCanvas(alicePage, { x: 150, y: 170 });
    await alicePage.keyboard.press(']');

    await expect
      .poll(async () => (await canvasObjects(bobPage)).map((o) => o.objectId))
      .toEqual([second.objectId, first.objectId]);

    await alicePage.context().close();
    await bobPage.context().close();
  });
});
