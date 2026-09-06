import { test, expect, type Page } from '@playwright/test';
import {
  signup,
  createBoard,
  invite,
  openBoard,
  openDashboard,
  apiRaw,
  type TestUser,
} from './helpers';

/**
 * Sprint 8 — the bell and @ mentions.
 *
 * The roadmap called both of these "pure frontend": the backend has been
 * writing notification rows since the first commit and the Comment model has
 * always had a `mentions[]`. Reading them turned out to need server work
 * anyway — nothing had ever validated a mention, nothing deleted a
 * notification whose board was gone, and a malformed id 500'd.
 */
test.describe('notifications and mentions', () => {
  let alice: TestUser;
  let bob: TestUser;
  let boardId: string;

  test.beforeEach(async () => {
    alice = await signup('Alice');
    bob = await signup('Bob');
    const board = await createBoard(alice, 'Noisy Board');
    boardId = board._id;
  });

  const bell = async (page: Page) => {
    await page.getByTitle('Notifications', { exact: true }).click();
    await expect(page.getByText('Notifications', { exact: true })).toBeVisible();
  };

  const notifications = async (as: TestUser) => {
    const { body } = await apiRaw('GET', '/notifications', { token: as.token });
    return body as { notifications: any[]; unread: number };
  };

  const comment = (as: TestUser, text: string, mentions: string[] = []) =>
    apiRaw('POST', `/comments/${boardId}`, {
      token: as.token,
      body: { text, x: 0, y: 0, mentions },
    });

  // -------------------------------------------------------------------------
  // The bell
  // -------------------------------------------------------------------------

  test('an invite shows up in the bell and can be read', async ({ browser }) => {
    await invite(alice, boardId, bob.user.email, 'editor');

    const bobPage = await openDashboard(browser, bob);
    await expect(bobPage.getByTestId('notification-badge')).toHaveText('1');

    await bell(bobPage);
    const item = bobPage.getByTestId('notification-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('invited you to "Noisy Board"');
    await expect(item).toHaveAttribute('data-unread', 'true');

    // Opening it marks it read and takes you to the board it is about.
    await item.click();
    await expect(bobPage).toHaveURL(new RegExp(`/board/${boardId}$`));
    expect((await notifications(bob)).unread).toBe(0);

    await bobPage.context().close();
  });

  test('a notification arrives without a reload', async ({ browser }) => {
    // Bob is already sitting on the dashboard when Alice shares the board.
    const bobPage = await openDashboard(browser, bob);
    await expect(bobPage.getByTestId('notification-badge')).toHaveCount(0);

    await invite(alice, boardId, bob.user.email, 'editor');

    // Every socket joins a `user:<id>` room, so this reaches a page with no
    // board open at all.
    await expect(
      bobPage.getByTestId('notification-badge'),
      'the notification never left the database'
    ).toHaveText('1', { timeout: 10_000 });

    await bobPage.context().close();
  });

  test('mark all read clears the badge', async ({ browser }) => {
    const second = await createBoard(alice, 'Another Board');
    await invite(alice, boardId, bob.user.email, 'editor');
    await invite(alice, second._id, bob.user.email, 'editor');

    const bobPage = await openDashboard(browser, bob);
    await expect(bobPage.getByTestId('notification-badge')).toHaveText('2');

    await bell(bobPage);
    await bobPage.getByTitle('Mark all read', { exact: true }).click();

    await expect(bobPage.getByTestId('notification-badge')).toHaveCount(0);
    expect((await notifications(bob)).unread).toBe(0);

    await bobPage.context().close();
  });

  test('a bad notification id is a 404, not a crash', async () => {
    const malformed = await apiRaw('PUT', '/notifications/not-an-id/read', { token: bob.token });
    expect(malformed.status, 'a malformed id reached Mongoose').toBe(404);

    // Someone else's notification is a miss, not a silent 200.
    await invite(alice, boardId, bob.user.email, 'editor');
    const [bobsOwn] = (await notifications(bob)).notifications;
    const stolen = await apiRaw('PUT', `/notifications/${bobsOwn._id}/read`, {
      token: alice.token,
    });
    expect(stolen.status).toBe(404);
    expect((await notifications(bob)).unread, "Alice read Bob's notification").toBe(1);
  });

  test('deleting a board takes its notifications with it', async () => {
    await invite(alice, boardId, bob.user.email, 'editor');
    expect((await notifications(bob)).notifications).toHaveLength(1);

    await apiRaw('DELETE', `/boards/${boardId}`, { token: alice.token });

    expect(
      (await notifications(bob)).notifications,
      'the bell still offers a board that no longer exists'
    ).toHaveLength(0);
  });

  test('removing a member takes their notifications for that board', async () => {
    await invite(alice, boardId, bob.user.email, 'editor');
    expect((await notifications(bob)).notifications).toHaveLength(1);

    await apiRaw('DELETE', `/boards/${boardId}/members/${bob.user.id}`, { token: alice.token });

    expect(
      (await notifications(bob)).notifications,
      'an invite to a board he can no longer open is still in his bell'
    ).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Mentions
  // -------------------------------------------------------------------------

  test('picking someone from the @ list mentions them', async ({ browser }) => {
    await invite(alice, boardId, bob.user.email, 'editor');
    const alicePage = await openBoard(browser, alice, boardId);

    await alicePage.getByTitle('Comments', { exact: true }).click();
    const input = alicePage.getByPlaceholder('Add a comment… @ to mention');
    await input.fill('look at this @Bo');

    const options = alicePage.getByTestId('mention-option');
    await expect(options).toHaveCount(1);
    await options.click();
    await expect(input).toHaveValue('look at this @Bob ');

    await input.fill('look at this @Bob ');
    await alicePage.getByTitle('Post comment', { exact: true }).click();

    await expect(alicePage.getByTestId('comment-text')).toContainText('look at this @Bob');

    const inbox = await notifications(bob);
    expect(
      inbox.notifications.map((n: any) => n.type),
      'no mention notification was written'
    ).toContain('mention');
    expect(inbox.unread).toBe(2); // the invite, plus the mention

    await alicePage.context().close();
  });

  test('deleting the name back out un-mentions them', async ({ browser }) => {
    await invite(alice, boardId, bob.user.email, 'editor');
    const alicePage = await openBoard(browser, alice, boardId);

    await alicePage.getByTitle('Comments', { exact: true }).click();
    const input = alicePage.getByPlaceholder('Add a comment… @ to mention');

    // Mentions are whatever names survive in the text at post time, not a list
    // accumulated as you click.
    await input.fill('@Bob never mind');
    await input.fill('never mind');
    await alicePage.getByTitle('Post comment', { exact: true }).click();
    await expect(alicePage.getByTestId('comment-text')).toHaveText('never mind');

    const inbox = await notifications(bob);
    expect(inbox.notifications.map((n: any) => n.type)).not.toContain('mention');

    await alicePage.context().close();
  });

  test('a mention cannot address someone off the board', async () => {
    await invite(alice, boardId, bob.user.email, 'editor');
    const mallory = await signup('Mallory');

    // `mentions` comes straight from the client and nothing ever checked it,
    // because until now nothing ever filled it in.
    const { status } = await comment(alice, 'hello @Mallory', [mallory.user.id]);
    expect(status).toBe(201);

    expect(
      (await notifications(mallory)).notifications,
      'a mention reached a user with no access to the board'
    ).toHaveLength(0);
  });

  test('mentioning yourself notifies nobody, and twice notifies once', async () => {
    await invite(alice, boardId, bob.user.email, 'editor');

    await comment(alice, 'talking to myself @Alice', [alice.user.id]);
    expect((await notifications(alice)).notifications).toHaveLength(0);

    await comment(alice, '@Bob @Bob look', [bob.user.id, bob.user.id]);
    const mentions = (await notifications(bob)).notifications.filter(
      (n: any) => n.type === 'mention'
    );
    expect(mentions, 'a duplicated id sent two notifications').toHaveLength(1);
  });

  test('a posted comment reaches everyone else in the room', async ({ browser }) => {
    await invite(alice, boardId, bob.user.email, 'editor');
    const alicePage = await openBoard(browser, alice, boardId);
    const bobPage = await openBoard(browser, bob, boardId);

    await bobPage.getByTitle('Comments', { exact: true }).click();
    await alicePage.getByTitle('Comments', { exact: true }).click();

    await alicePage.getByPlaceholder('Add a comment… @ to mention').fill('anyone there');
    await alicePage.getByTitle('Post comment', { exact: true }).click();

    // The client used to emit the bare comment object, while the server
    // destructures { boardId, comment } — so boardId was undefined, the
    // authorization check failed, and comments never broadcast at all.
    await expect(
      bobPage.getByTestId('comment-text'),
      'the comment never left the sender'
    ).toContainText('anyone there', { timeout: 10_000 });

    await alicePage.context().close();
    await bobPage.context().close();
  });
});
