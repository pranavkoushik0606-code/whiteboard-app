import { test, expect, type Page } from '@playwright/test';
import {
  signup,
  createBoard,
  invite,
  openBoard,
  apiRaw,
  canvasObjects,
  canvasObjectIds,
  selectTool,
  dragOnCanvas,
  type TestUser,
} from './helpers';

/**
 * Sprint 4. `POST /canvas/:id/versions` and its 50-version pruning have existed
 * since the first commit and had never been called once, so version history was
 * permanently empty and the panel's "they're created automatically" was untrue.
 *
 * Versions are now snapshotted server-side — from the board's own rows, not
 * from whatever a client says its canvas holds — by an explicit Save button and
 * automatically every AUTO_VERSION_EVERY object mutations (5 under test, 50 in
 * production).
 */
test.describe('version history', () => {
  let alice: TestUser;
  let bob: TestUser;
  let boardId: string;

  test.beforeEach(async () => {
    alice = await signup('Alice');
    bob = await signup('Bob');
    const board = await createBoard(alice, 'Versioned Board');
    boardId = board._id;
    await invite(alice, boardId, bob.user.email, 'editor');
  });

  const drawRect = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
    await selectTool(page, 'Rectangle');
    await dragOnCanvas(page, from, to);
    await selectTool(page, 'Select');
  };

  const openPanel = async (page: Page) => {
    await page.getByTitle('Version history', { exact: true }).click();
    await expect(page.getByPlaceholder('Name this version')).toBeVisible();
  };

  const saveVersion = async (page: Page, label: string) => {
    await page.getByPlaceholder('Name this version').fill(label);
    await page.getByTitle('Save version', { exact: true }).click();
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  };

  test('the save button actually creates a version', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    await drawRect(alicePage, { x: 120, y: 120 }, { x: 240, y: 240 });

    await openPanel(alicePage);
    await saveVersion(alicePage, 'One rectangle');

    // Read it back through the API rather than trusting the panel's own state.
    const { status, body } = await apiRaw('GET', `/canvas/${boardId}/versions`, {
      token: alice.token,
    });
    expect(status).toBe(200);
    expect(body.versions).toHaveLength(1);
    expect(body.versions[0].label).toBe('One rectangle');
    expect(body.versions[0].createdBy?.name).toBe(alice.user.name);

    await alicePage.context().close();
  });

  test('restoring a version replaces the canvas and the database', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    await drawRect(alicePage, { x: 120, y: 120 }, { x: 240, y: 240 });
    const [first] = await canvasObjects(alicePage);

    await openPanel(alicePage);
    await saveVersion(alicePage, 'Just the first');
    await alicePage.getByTitle('Close version history', { exact: true }).click();

    // Add a second rectangle, then roll back to the saved point.
    await drawRect(alicePage, { x: 300, y: 120 }, { x: 400, y: 220 });
    expect(await canvasObjectIds(alicePage)).toHaveLength(2);

    await openPanel(alicePage);
    await alicePage.getByTitle('Restore this version', { exact: true }).click();

    await expect
      .poll(() => canvasObjectIds(alicePage), { message: 'the restore should reload the canvas' })
      .toEqual([first.objectId]);

    const fresh = await openBoard(browser, bob, boardId);
    expect(await canvasObjectIds(fresh), 'the restore never reached Mongo').toEqual([
      first.objectId,
    ]);

    await alicePage.context().close();
    await fresh.context().close();
  });

  test('a restore reaches everyone still in the room', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    await drawRect(alicePage, { x: 120, y: 120 }, { x: 240, y: 240 });
    const [first] = await canvasObjects(alicePage);

    await openPanel(alicePage);
    await saveVersion(alicePage, 'Before Bob');
    await alicePage.getByTitle('Close version history', { exact: true }).click();

    const bobPage = await openBoard(browser, bob, boardId);
    await drawRect(bobPage, { x: 300, y: 120 }, { x: 400, y: 220 });
    await expect.poll(() => canvasObjectIds(alicePage)).toHaveLength(2);

    await openPanel(alicePage);
    await alicePage.getByTitle('Restore this version', { exact: true }).click();

    // Bob never reloads. Before Sprint 4 he kept the two-rectangle canvas and
    // the next thing he touched would have written it back.
    await expect
      .poll(() => canvasObjectIds(bobPage), { message: 'the restore was not broadcast' })
      .toEqual([first.objectId]);

    await alicePage.context().close();
    await bobPage.context().close();
  });

  test('versions are captured automatically as the board changes', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);

    // AUTO_VERSION_EVERY is 5 under test (see e2e/global-setup.ts).
    for (let i = 0; i < 5; i++) {
      await drawRect(alicePage, { x: 100 + i * 60, y: 120 }, { x: 150 + i * 60, y: 200 });
    }

    await expect
      .poll(
        async () =>
          (await apiRaw('GET', `/canvas/${boardId}/versions`, { token: alice.token })).body.versions
            .length,
        { message: 'no version was captured after five mutations' }
      )
      .toBeGreaterThan(0);

    // Server-side snapshot: it holds every object on the board, not just the
    // ones the capturing client happened to have drawn.
    const { body } = await apiRaw('GET', `/canvas/${boardId}/versions`, { token: alice.token });
    const restored = await apiRaw(
      'POST',
      `/canvas/${boardId}/versions/${body.versions[0]._id}/restore`,
      { token: alice.token }
    );
    expect(restored.status).toBe(200);
    expect(restored.body.objects).toHaveLength(5);

    await alicePage.context().close();
  });

  test('a viewer cannot save a version', async () => {
    const carol = await signup('Carol');
    await invite(alice, boardId, carol.user.email, 'viewer');

    const res = await apiRaw('POST', `/canvas/${boardId}/versions`, {
      token: carol.token,
      body: { label: 'sneaky' },
    });
    expect(res.status).toBe(403);

    const after = await apiRaw('GET', `/canvas/${boardId}/versions`, { token: alice.token });
    expect(after.body.versions).toHaveLength(0);
  });

  test("a version id from another board cannot be restored into this one", async () => {
    // Alice owns both boards, so board access is not what stops her here.
    const other = await createBoard(alice, 'Other Board');
    const created = await apiRaw('POST', `/canvas/${other._id}/versions`, {
      token: alice.token,
      body: { label: 'other board' },
    });
    expect(created.status).toBe(201);

    const res = await apiRaw(
      'POST',
      `/canvas/${boardId}/versions/${created.body.version._id}/restore`,
      { token: alice.token }
    );
    expect(res.status, 'a version must only restore into the board it belongs to').toBe(404);
  });

  test('a malformed version id is a 404, not a crash', async () => {
    const res = await apiRaw('POST', `/canvas/${boardId}/versions/not-an-object-id/restore`, {
      token: alice.token,
    });
    expect(res.status).toBe(404);
  });
});
