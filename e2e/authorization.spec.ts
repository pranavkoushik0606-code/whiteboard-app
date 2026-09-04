import { test, expect } from '@playwright/test';
import type { Socket } from 'socket.io-client';
import {
  signup,
  createBoard,
  invite,
  apiRaw,
  boardObjectCount,
  connectSocket,
  raceEvents,
  expectNoEvent,
  type TestUser,
} from './helpers';

/**
 * Sprint 1. The REST layer was already guarded by requireBoardAccess; the
 * socket layer was not. Every socket event takes a client-supplied boardId, so
 * these tests speak the protocol directly rather than going through the UI —
 * a browser would never send these payloads, which is exactly why the hole
 * survived this long.
 */
test.describe('socket authorization', () => {
  let alice: TestUser; // owner
  let bob: TestUser; // invited editor
  let carol: TestUser; // invited viewer
  let mallory: TestUser; // not a member
  let boardId: string;

  const sockets: Socket[] = [];
  const track = (s: Socket) => (sockets.push(s), s);

  test.beforeEach(async () => {
    alice = await signup('Alice');
    bob = await signup('Bob');
    carol = await signup('Carol');
    mallory = await signup('Mallory');

    const board = await createBoard(alice, 'Private Board');
    boardId = board._id;
    await invite(alice, boardId, bob.user.email, 'editor');
    await invite(alice, boardId, carol.user.email, 'viewer');
  });

  test.afterEach(() => {
    sockets.splice(0).forEach((s) => s.disconnect());
  });

  test('a non-member cannot join a board room', async () => {
    const socket = track(await connectSocket(mallory));
    socket.emit('board:join', { boardId });

    const { event, payload } = await raceEvents(socket, ['presence:sync', 'error:auth']);
    expect(event, 'a valid JWT alone must not grant board access').toBe('error:auth');
    expect(payload.message).toContain('do not have access');
  });

  test('an invited editor can join', async () => {
    const socket = track(await connectSocket(bob));
    socket.emit('board:join', { boardId });

    const { event } = await raceEvents(socket, ['presence:sync', 'error:auth']);
    expect(event).toBe('presence:sync');
  });

  test('a non-member cannot write objects to a board they never joined', async () => {
    const socket = track(await connectSocket(mallory));

    // No board:join at all — the old handler persisted this regardless.
    socket.emit('object:add', {
      boardId,
      object: { objectId: 'mallory-object', type: 'rect', data: { type: 'rect' }, zIndex: 0 },
    });

    const { event } = await raceEvents(socket, ['object:added', 'error:auth', 'error:sync']);
    expect(event).toBe('error:auth');

    // The write must not have reached the database either.
    expect(await boardObjectCount(alice, boardId)).toBe(0);
  });

  test('a viewer can join but cannot add objects', async () => {
    const socket = track(await connectSocket(carol));
    socket.emit('board:join', { boardId });

    const joined = await raceEvents(socket, ['presence:sync', 'error:auth']);
    expect(joined.event, 'viewers are still members').toBe('presence:sync');

    socket.emit('object:add', {
      boardId,
      object: { objectId: 'carol-object', type: 'rect', data: { type: 'rect' }, zIndex: 0 },
    });

    const denied = await raceEvents(socket, ['error:auth', 'error:sync']);
    expect(denied.event).toBe('error:auth');
    expect(denied.payload.required).toBe('editor');
    expect(await boardObjectCount(alice, boardId)).toBe(0);
  });

  test('a non-member cannot broadcast cursors into a board room', async () => {
    const member = track(await connectSocket(bob));
    member.emit('board:join', { boardId });
    await raceEvents(member, ['presence:sync']);

    const outsider = track(await connectSocket(mallory));
    outsider.emit('cursor:move', { boardId, x: 10, y: 10 });

    // Bob, who is legitimately in the room, must see nothing.
    await expectNoEvent(member, 'cursor:update');
  });
});

test.describe('comment authorization', () => {
  let alice: TestUser;
  let mallory: TestUser;
  let boardId: string;
  let commentId: string;

  test.beforeEach(async () => {
    alice = await signup('Alice');
    mallory = await signup('Mallory');
    const board = await createBoard(alice, 'Board With Comments');
    boardId = board._id;

    const created = await apiRaw('POST', `/comments/${boardId}`, {
      token: alice.token,
      body: { text: 'first', x: 0, y: 0 },
    });
    expect(created.status).toBe(201);
    commentId = created.body.comment._id;
  });

  test('a non-member cannot resolve a comment', async () => {
    const res = await apiRaw('PUT', `/comments/comment/${commentId}/resolve`, {
      token: mallory.token,
      body: { resolved: true },
    });
    expect(res.status).toBe(403);

    const after = await apiRaw('GET', `/comments/${boardId}`, { token: alice.token });
    expect(after.body.comments[0].resolved).toBe(false);
  });

  test('a non-member cannot delete a comment', async () => {
    const res = await apiRaw('DELETE', `/comments/comment/${commentId}`, {
      token: mallory.token,
    });
    expect(res.status).toBe(403);

    const after = await apiRaw('GET', `/comments/${boardId}`, { token: alice.token });
    expect(after.body.comments).toHaveLength(1);
  });

  test('the board owner can still resolve and delete', async () => {
    const resolved = await apiRaw('PUT', `/comments/comment/${commentId}/resolve`, {
      token: alice.token,
      body: { resolved: true },
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.comment.resolved).toBe(true);

    const deleted = await apiRaw('DELETE', `/comments/comment/${commentId}`, {
      token: alice.token,
    });
    expect(deleted.status).toBe(200);

    const after = await apiRaw('GET', `/comments/${boardId}`, { token: alice.token });
    expect(after.body.comments).toHaveLength(0);
  });

  test('an unknown comment id is a 404, not a crash', async () => {
    const res = await apiRaw('PUT', '/comments/comment/not-an-object-id/resolve', {
      token: alice.token,
      body: { resolved: true },
    });
    expect(res.status).toBe(404);
  });
});
