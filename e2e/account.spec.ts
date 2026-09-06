import { test, expect } from '@playwright/test';
import {
  apiRaw,
  connectSocket,
  createBoard,
  invite,
  raceEvents,
  signup,
  type TestUser,
} from './helpers';

/**
 * Deleting your own account.
 *
 * The interesting question is not what gets deleted, it is what survives. A
 * user leaves traces on two kinds of board — their own, which go, and other
 * people's, where what they drew belongs to the board and stays. Comments are
 * the exception, because `Comment.author` is required and every read populates
 * it: a dangling reference would come back `null` and break the panel for
 * everyone else on that board.
 */

const PASSWORD = 'password123';

// Takes the body verbatim. A `password` parameter defaulting to the right one
// cannot express "send no password at all": passing `undefined` fills the
// default back in, which is how the first version of this test deleted the
// account it was checking had survived.
const deleteAccountWith = (as: TestUser, body: Record<string, unknown>) =>
  apiRaw('DELETE', '/auth/account', { token: as.token, body });

const deleteAccount = (as: TestUser) => deleteAccountWith(as, { password: PASSWORD });

const addComment = (as: TestUser, boardId: string, text: string, mentions: string[] = []) =>
  apiRaw('POST', `/comments/${boardId}`, { token: as.token, body: { text, x: 0, y: 0, mentions } });

const addObject = (as: TestUser, boardId: string, objectId: string) =>
  apiRaw('POST', `/canvas/${boardId}/objects/bulk`, {
    token: as.token,
    body: { objects: [{ objectId, type: 'rect', data: { type: 'rect' }, zIndex: 1 }] },
  });

test('the password is required, not just the token', async () => {
  const user = await signup('Nopass');

  const missing = await deleteAccountWith(user, {});
  expect(missing.status).toBe(400);

  const wrong = await deleteAccountWith(user, { password: 'not-my-password' });
  expect(wrong.status).toBe(401);
  expect(wrong.body.message).toBe('Incorrect password');

  // Still very much alive.
  const me = await apiRaw('GET', '/auth/me', { token: user.token });
  expect(me.status).toBe(200);
});

test('deleting the account takes the token and the login with it', async () => {
  const user = await signup('Goodbye');

  const deleted = await deleteAccount(user);
  expect(deleted.status).toBe(200);

  // `protect` looks the user up on every request, so the outstanding token dies
  // with the row rather than lasting until its seven-day expiry.
  const me = await apiRaw('GET', '/auth/me', { token: user.token });
  expect(me.status).toBe(401);

  const login = await apiRaw('POST', '/auth/login', {
    body: { email: user.user.email, password: PASSWORD },
  });
  expect(login.status).toBe(401);
});

test('their own boards are destroyed, with everything hanging off them', async () => {
  const owner = await signup('Owner');
  const board = await createBoard(owner, 'Doomed');
  await addObject(owner, board._id, 'obj-1');
  await addComment(owner, board._id, 'a comment');
  await apiRaw('POST', `/canvas/${board._id}/versions`, {
    token: owner.token,
    body: { label: 'v1' },
  });

  const { body } = await deleteAccount(owner);
  expect(body.boardsDeleted).toBe(1);

  // Gone for a second account too, not merely invisible to a dead token.
  const other = await signup('Other');
  const board404 = await apiRaw('GET', `/boards/${board._id}`, { token: other.token });
  expect(board404.status).toBe(404);
});

test('what they drew on someone else’s board stays, without their name on it', async () => {
  const owner = await signup('Keeper');
  const guest = await signup('Guest');
  const board = await createBoard(owner, 'Shared work');
  await invite(owner, board._id, guest.user.email, 'editor');

  await addObject(guest, board._id, 'guest-obj');
  await addObject(owner, board._id, 'owner-obj');

  await deleteAccount(guest);

  // The drawing belongs to the board, not to the person who left.
  const { status, body } = await apiRaw('GET', `/canvas/${board._id}/objects`, {
    token: owner.token,
  });
  expect(status).toBe(200);
  const ids = body.objects.map((o: any) => o.objectId).sort();
  expect(ids).toEqual(['guest-obj', 'owner-obj']);

  const orphan = body.objects.find((o: any) => o.objectId === 'guest-obj');
  expect(orphan.createdBy ?? null).toBeNull();
});

test('their comments go, because a comment with no author breaks the panel', async () => {
  const owner = await signup('Host');
  const guest = await signup('Leaver');
  const board = await createBoard(owner, 'Discussion');
  await invite(owner, board._id, guest.user.email, 'editor');

  await addComment(owner, board._id, 'mine stays');
  await addComment(guest, board._id, 'mine goes');

  await deleteAccount(guest);

  const { body } = await apiRaw('GET', `/comments/${board._id}`, { token: owner.token });
  expect(body.comments).toHaveLength(1);
  expect(body.comments[0].text).toBe('mine stays');
  // Every surviving comment still has a populated author. That is the whole
  // reason the others were deleted rather than orphaned.
  expect(body.comments[0].author?.name).toBe('Host');
});

test('mentions of them are pulled out of the comments that survive', async () => {
  const owner = await signup('Mentioner');
  const guest = await signup('Mentioned');
  const board = await createBoard(owner, 'Mentions');
  await invite(owner, board._id, guest.user.email, 'editor');

  const posted = await addComment(owner, board._id, 'hey @Mentioned', [guest.user.id]);
  expect(posted.body.comment.mentions).toContain(guest.user.id);

  await deleteAccount(guest);

  const { body } = await apiRaw('GET', `/comments/${board._id}`, { token: owner.token });
  expect(body.comments[0].mentions).toHaveLength(0);
});

test('someone sitting in a board being destroyed is ejected, not stranded', async () => {
  const owner = await signup('Vanishing');
  const guest = await signup('Sitting');
  const board = await createBoard(owner, 'About to vanish');
  await invite(owner, board._id, guest.user.email, 'editor');

  const socket = await connectSocket(guest);
  socket.emit('board:join', { boardId: board._id });
  await new Promise((r) => setTimeout(r, 300));

  const ejected = raceEvents(socket, ['board:role'], 8_000);
  await deleteAccount(owner);

  // A null role is what removeMember already sends, and the editor answers it
  // by leaving for the dashboard. Without this the guest keeps drawing into a
  // board that no longer exists.
  const { payload } = await ejected;
  expect(payload.boardId).toBe(board._id);
  expect(payload.role).toBeNull();
  socket.disconnect();
});

test('other people’s boards are left alone', async () => {
  const leaver = await signup('Transient');
  const bystander = await signup('Bystander');
  const theirs = await createBoard(bystander, 'Untouched');
  await addObject(bystander, theirs._id, 'their-obj');
  await createBoard(leaver, 'Mine');

  const { body } = await deleteAccount(leaver);
  expect(body.boardsDeleted).toBe(1);

  const still = await apiRaw('GET', `/boards/${theirs._id}`, { token: bystander.token });
  expect(still.status).toBe(200);
  expect(still.body.objects).toHaveLength(1);
});
