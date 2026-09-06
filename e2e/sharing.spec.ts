import { test, expect, type Page } from '@playwright/test';
import {
  signup,
  createBoard,
  invite,
  openBoard,
  apiRaw,
  boardObjectCount,
  canvasObjects,
  connectSocket,
  raceEvents,
  selectTool,
  dragOnCanvas,
  type TestUser,
} from './helpers';

/**
 * Sprint 7 — sharing gets a UI, and three things that were invisible while
 * nobody could share become visible the moment it does:
 *
 *  - a favourite was a boolean on the board, so one member starring it would
 *    star it for everyone;
 *  - a viewer got the full editor and only discovered it did nothing after
 *    drawing, because the server dropped their writes in silence;
 *  - socket roles are cached at join time, so a member removed mid-session kept
 *    writing until they happened to reconnect.
 */
test.describe('sharing', () => {
  let alice: TestUser;
  let bob: TestUser;
  let boardId: string;

  test.beforeEach(async () => {
    alice = await signup('Alice');
    bob = await signup('Bob');
    const board = await createBoard(alice, 'Shared Board');
    boardId = board._id;
  });

  const openShare = async (page: Page) => {
    await page.getByTitle('Share', { exact: true }).click();
    await expect(page.getByText('Share board')).toBeVisible();
  };

  const boardsFor = async (as: TestUser, params = '') => {
    const { body } = await apiRaw('GET', `/boards${params}`, { token: as.token });
    return body as { owned: any[]; shared: any[] };
  };

  test('an owner shares a board from the modal and the invitee gets it', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    await openShare(alicePage);

    await alicePage.getByPlaceholder('Email address').fill(bob.user.email);
    await alicePage.getByTitle('Invite role', { exact: true }).selectOption('editor');
    await alicePage.getByTitle('Send invite', { exact: true }).click();

    await expect(alicePage.locator(`[data-email="${bob.user.email}"]`)).toBeVisible();
    // The owner is on the roster too, and is not removable.
    await expect(alicePage.locator('[data-testid="member-row"]')).toHaveCount(2);

    const { shared } = await boardsFor(bob);
    expect(
      shared.map((b: any) => b._id),
      'the invite did not reach the database'
    ).toContain(boardId);
    expect(shared.find((b: any) => b._id === boardId).role).toBe('editor');

    await alicePage.context().close();
  });

  test('an unknown email is reported rather than silently dropped', async ({ browser }) => {
    const alicePage = await openBoard(browser, alice, boardId);
    await openShare(alicePage);

    await alicePage.getByPlaceholder('Email address').fill('nobody@e2e.test');
    await alicePage.getByTitle('Send invite', { exact: true }).click();

    await expect(alicePage.getByText('No user found with that email')).toBeVisible();
    await expect(alicePage.locator('[data-testid="member-row"]')).toHaveCount(1);

    await alicePage.context().close();
  });

  test('a membership cannot grant ownership', async () => {
    // BoardMember's enum still allows 'owner', and the invite handler used to
    // pass req.body.role straight through — so an owner could mint a second
    // owner who could delete the board out from under them.
    const escalate = await apiRaw('POST', `/boards/${boardId}/invite`, {
      token: alice.token,
      body: { email: bob.user.email, role: 'owner' },
    });
    expect(escalate.status, 'role: owner was accepted').toBe(400);

    // A junk role used to be written verbatim, leaving a membership row whose
    // role matched nothing in roleRank — access silently gone.
    const junk = await apiRaw('POST', `/boards/${boardId}/invite`, {
      token: alice.token,
      body: { email: bob.user.email, role: 'admin' },
    });
    expect(junk.status).toBe(400);

    expect((await boardsFor(bob)).shared).toHaveLength(0);
  });

  test('the owner cannot be added as their own member', async () => {
    const { status } = await apiRaw('POST', `/boards/${boardId}/invite`, {
      token: alice.token,
      body: { email: alice.user.email, role: 'viewer' },
    });
    expect(status, 'the owner was written into the member list').toBe(400);

    const { body } = await apiRaw('GET', `/boards/${boardId}/members`, { token: alice.token });
    expect(body.members).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Read-only
  // -------------------------------------------------------------------------

  test('a viewer gets a toolbar with nothing that writes', async ({ browser }) => {
    await invite(alice, boardId, bob.user.email, 'viewer');
    const bobPage = await openBoard(browser, bob, boardId);

    await expect(bobPage.getByText('View only')).toBeVisible();
    await expect(bobPage.getByTitle('Rectangle', { exact: true })).toHaveCount(0);
    await expect(bobPage.getByTitle('Clear canvas', { exact: true })).toHaveCount(0);
    await expect(bobPage.getByTitle('Stroke color', { exact: true })).toHaveCount(0);

    // Still able to look around and take a copy away.
    await expect(bobPage.getByTitle('Select', { exact: true })).toBeVisible();
    await expect(bobPage.getByTitle('Export', { exact: true })).toBeVisible();

    await bobPage.context().close();
  });

  test('a viewer cannot drag an object that is already on the board', async ({ browser }) => {
    await invite(alice, boardId, bob.user.email, 'viewer');
    const alicePage = await openBoard(browser, alice, boardId);
    await selectTool(alicePage, 'Rectangle');
    await dragOnCanvas(alicePage, { x: 120, y: 120 }, { x: 260, y: 260 });
    await selectTool(alicePage, 'Select');

    const bobPage = await openBoard(browser, bob, boardId);
    await expect.poll(() => canvasObjects(bobPage)).toHaveLength(1);
    const before = (await canvasObjects(bobPage))[0];

    // Fabric's controls are per-object. Hiding the toolbar leaves every shape
    // draggable, resizable and rotatable — which would look like it worked and
    // then vanish on reload, because the socket refuses a viewer's writes.
    await dragOnCanvas(bobPage, { x: 190, y: 190 }, { x: 330, y: 330 });
    await bobPage.waitForTimeout(300);

    const after = (await canvasObjects(bobPage))[0];
    expect(after.left, 'a viewer moved the object on their own canvas').toBe(before.left);
    expect(after.top).toBe(before.top);

    // And Delete does nothing either.
    await bobPage.keyboard.press('Delete');
    await bobPage.waitForTimeout(200);
    expect(await canvasObjects(bobPage)).toHaveLength(1);
    expect(await boardObjectCount(alice, boardId)).toBe(1);

    await alicePage.context().close();
    await bobPage.context().close();
  });

  // -------------------------------------------------------------------------
  // Role changes while the board is open
  // -------------------------------------------------------------------------

  test('a demotion reaches a socket that is already in the board', async () => {
    await invite(alice, boardId, bob.user.email, 'editor');

    const socket = await connectSocket(bob);
    socket.emit('board:join', { boardId });
    await raceEvents(socket, ['presence:sync']);

    const add = (objectId: string) =>
      socket.emit('object:add', {
        boardId,
        object: { objectId, type: 'rect', data: { type: 'Rect', left: 0, top: 0 }, zIndex: 0 },
      });

    add('before-demotion');
    await expect.poll(() => boardObjectCount(alice, boardId)).toBe(1);

    await apiRaw('PUT', `/boards/${boardId}/members/${bob.user.id}`, {
      token: alice.token,
      body: { role: 'viewer' },
    });

    // Roles are cached per socket at join time, so without an explicit push
    // this write would still be accepted until Bob happened to reconnect.
    const denied = raceEvents(socket, ['error:auth']);
    add('after-demotion');
    await denied;
    expect(await boardObjectCount(alice, boardId), 'a demoted editor still wrote').toBe(1);

    socket.disconnect();
  });

  test('removing a member ejects them from the board they are looking at', async ({ browser }) => {
    await invite(alice, boardId, bob.user.email, 'editor');
    const bobPage = await openBoard(browser, bob, boardId);

    await apiRaw('DELETE', `/boards/${boardId}/members/${bob.user.id}`, { token: alice.token });

    await expect(bobPage, 'Bob was left sitting in a board he can no longer open').toHaveURL(
      /\/dashboard$/,
      { timeout: 10_000 }
    );

    // And the board is gone from his list rather than lingering as a card that
    // 403s when clicked.
    expect((await boardsFor(bob)).shared).toHaveLength(0);

    await bobPage.context().close();
  });

  // -------------------------------------------------------------------------
  // Favourites
  // -------------------------------------------------------------------------

  const favorite = (as: TestUser, value: boolean) =>
    apiRaw('PUT', `/boards/${boardId}/favorite`, { token: as.token, body: { isFavorite: value } });

  test('a favourite belongs to the person, not to the board', async () => {
    await invite(alice, boardId, bob.user.email, 'editor');

    expect((await favorite(alice, true)).status).toBe(200);

    const forAlice = (await boardsFor(alice)).owned.find((b: any) => b._id === boardId);
    expect(forAlice.isFavorite).toBe(true);

    const forBob = (await boardsFor(bob)).shared.find((b: any) => b._id === boardId);
    expect(
      forBob.isFavorite,
      "Alice's favourite became everyone's — it is still a field on the board"
    ).toBe(false);
  });

  test('a viewer may bookmark a board they cannot write to', async () => {
    await invite(alice, boardId, bob.user.email, 'viewer');

    // The old route was PUT /boards/:id, which requires editor. A viewer could
    // not favourite anything at all.
    expect((await favorite(bob, true)).status).toBe(200);

    // And the filter has to look past the boards you own: `favorite` used to
    // clear the shared list outright.
    const { shared } = await boardsFor(bob, '?filter=favorite');
    expect(
      shared.map((b: any) => b._id),
      'a favourited shared board is missing from the favourite filter'
    ).toContain(boardId);

    // A viewer's bookmark must not have needed write access to land.
    const write = await apiRaw('PUT', `/boards/${boardId}`, {
      token: bob.token,
      body: { title: 'Renamed by a viewer' },
    });
    expect(write.status).toBe(403);
  });

  test('unfavouriting removes it again', async () => {
    await favorite(alice, true);
    expect((await boardsFor(alice, '?filter=favorite')).owned).toHaveLength(1);

    await favorite(alice, false);
    expect((await boardsFor(alice, '?filter=favorite')).owned).toHaveLength(0);
    // The board itself is untouched.
    expect((await boardsFor(alice)).owned).toHaveLength(1);
  });
});
