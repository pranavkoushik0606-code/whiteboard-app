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
 * Sprint 3. Undo used to call loadFromJSON and emit nothing: the object left
 * your screen and its row stayed in Mongo, so a reload resurrected it. Now undo
 * diffs the two history snapshots and broadcasts the difference.
 *
 * Two things make that dangerous rather than merely fiddly, and both have a
 * test here: the baseline snapshot must contain the objects that were already
 * on the board when you opened it, and the stack must track objects that
 * arrived from other people. Get either wrong and Ctrl+Z deletes work that was
 * never yours.
 */
test.describe('undo is broadcast, not local-only', () => {
  let alice: TestUser;
  let bob: TestUser;
  let boardId: string;

  test.beforeEach(async () => {
    alice = await signup('Alice');
    bob = await signup('Bob');
    const board = await createBoard(alice, 'Undo Board');
    boardId = board._id;
    await invite(alice, boardId, bob.user.email, 'editor');
  });

  const drawRect = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
    await selectTool(page, 'Rectangle');
    await dragOnCanvas(page, from, to);
    await selectTool(page, 'Select');
  };

  const undo = (page: Page) => page.keyboard.press('Control+z');
  const redo = (page: Page) => page.keyboard.press('Control+y');

  test('undo of an add removes the object for everyone', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    const bobPage = await openBoard(browser, bob, boardId);

    await drawRect(alicePage, { x: 120, y: 120 }, { x: 240, y: 240 });
    await expect.poll(() => canvasObjectIds(bobPage)).toHaveLength(1);

    await undo(alicePage);
    expect(await canvasObjectIds(alicePage)).toHaveLength(0);
    await expect
      .poll(() => canvasObjectIds(bobPage), { message: 'undo must reach the other client' })
      .toHaveLength(0);

    // And the row has to be gone, not just hidden.
    const fresh = await openBoard(browser, alice, boardId);
    expect(await canvasObjectIds(fresh), 'the undone object came back on reload').toHaveLength(0);

    await alicePage.context().close();
    await bobPage.context().close();
    await fresh.context().close();
  });

  test('undo of a move restores the old position everywhere', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);

    await drawRect(alicePage, { x: 120, y: 120 }, { x: 240, y: 240 });
    const [drawn] = await canvasObjects(alicePage);

    await dragOnCanvas(alicePage, { x: 180, y: 180 }, { x: 430, y: 330 });
    const [moved] = await canvasObjects(alicePage);
    expect(moved.left, 'the drag should have moved it').not.toBe(drawn.left);

    await undo(alicePage);
    const [restored] = await canvasObjects(alicePage);
    expect(restored.left).toBeCloseTo(drawn.left, 0);
    expect(restored.top).toBeCloseTo(drawn.top, 0);

    const fresh = await openBoard(browser, bob, boardId);
    const [persisted] = await canvasObjects(fresh);
    expect(persisted.objectId).toBe(drawn.objectId);
    expect(persisted.left, 'the moved position was never rolled back in Mongo').toBeCloseTo(
      drawn.left,
      0
    );

    await alicePage.context().close();
    await fresh.context().close();
  });

  test('redo re-adds what undo removed, and it sticks', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);

    await drawRect(alicePage, { x: 120, y: 120 }, { x: 240, y: 240 });
    const [drawn] = await canvasObjects(alicePage);

    await undo(alicePage);
    expect(await canvasObjectIds(alicePage)).toHaveLength(0);

    // Check the database in between. Without this the test passes even when
    // undo and redo are both no-ops on the wire — the canvas ends up where it
    // started either way, and nothing has been proven.
    const midway = await openBoard(browser, bob, boardId);
    expect(await canvasObjectIds(midway), 'undo did not reach the database').toHaveLength(0);
    await midway.context().close();

    await redo(alicePage);
    const [back] = await canvasObjects(alicePage);
    expect(back.objectId).toBe(drawn.objectId);

    const fresh = await openBoard(browser, bob, boardId);
    expect(await canvasObjectIds(fresh)).toEqual([drawn.objectId]);

    await alicePage.context().close();
    await fresh.context().close();
  });

  test('undo of a delete brings the object back for everyone', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    const bobPage = await openBoard(browser, bob, boardId);

    await drawRect(alicePage, { x: 120, y: 120 }, { x: 240, y: 240 });
    const [drawn] = await canvasObjects(alicePage);
    await expect.poll(() => canvasObjectIds(bobPage)).toHaveLength(1);

    await clickOnCanvas(alicePage, { x: 180, y: 180 });
    await alicePage.keyboard.press('Delete');
    await expect.poll(() => canvasObjectIds(bobPage)).toHaveLength(0);

    await undo(alicePage);
    await expect
      .poll(() => canvasObjectIds(bobPage), { message: 'the resurrect must be broadcast' })
      .toEqual([drawn.objectId]);

    const fresh = await openBoard(browser, alice, boardId);
    expect(await canvasObjectIds(fresh)).toEqual([drawn.objectId]);

    await alicePage.context().close();
    await bobPage.context().close();
    await fresh.context().close();
  });

  test('undo never reaches past what was on the board when you opened it', async ({ browser }) => {
    // Alice leaves a rectangle behind and goes away.
    const alicePage = await openBoard(browser, alice, boardId);
    await drawRect(alicePage, { x: 100, y: 120 }, { x: 200, y: 220 });
    const [existing] = await canvasObjects(alicePage);
    await alicePage.context().close();

    // Bob opens the board fresh, so the rectangle arrives through the initial
    // load rather than through a socket event.
    const bobPage = await openBoard(browser, bob, boardId);
    expect(await canvasObjectIds(bobPage)).toEqual([existing.objectId]);

    await drawRect(bobPage, { x: 300, y: 120 }, { x: 400, y: 220 });
    expect(await canvasObjectIds(bobPage)).toHaveLength(2);

    // More undos than Bob has edits. The baseline snapshot is the board as he
    // found it — if it were an empty canvas instead, this wipes Alice's work.
    await undo(bobPage);
    await undo(bobPage);
    await undo(bobPage);

    expect(
      await canvasObjectIds(bobPage),
      'undo ran past the baseline and removed a pre-existing object'
    ).toEqual([existing.objectId]);

    const fresh = await openBoard(browser, alice, boardId);
    expect(await canvasObjectIds(fresh)).toEqual([existing.objectId]);

    await bobPage.context().close();
    await fresh.context().close();
  });

  test('undo leaves objects added by someone else alone', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    const bobPage = await openBoard(browser, bob, boardId);

    // Bob draws first, then Alice's object arrives over the socket. Bob's
    // snapshots predate it, so undo has to rebase over the remote add.
    await drawRect(bobPage, { x: 300, y: 120 }, { x: 400, y: 220 });
    const [bobsRect] = await canvasObjects(bobPage);

    await drawRect(alicePage, { x: 100, y: 120 }, { x: 200, y: 220 });
    const alicesRect = (await canvasObjects(alicePage)).find((o) => o.objectId !== bobsRect.objectId);
    expect(alicesRect, 'Alice should see both rectangles').toBeTruthy();
    await expect.poll(() => canvasObjectIds(bobPage)).toHaveLength(2);

    await undo(bobPage);
    await undo(bobPage);

    expect(
      await canvasObjectIds(bobPage),
      "Bob's undo swallowed the rectangle Alice drew"
    ).toEqual([alicesRect!.objectId]);

    const fresh = await openBoard(browser, alice, boardId);
    expect(await canvasObjectIds(fresh)).toEqual([alicesRect!.objectId]);

    await alicePage.context().close();
    await bobPage.context().close();
    await fresh.context().close();
  });
});
