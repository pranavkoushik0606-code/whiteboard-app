import type { Browser, Page } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from './config';

export interface TestUser {
  token: string;
  user: { id: string; name: string; email: string };
}

let seq = 0;
function uniqueEmail(prefix: string) {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}@e2e.test`;
}

async function apiPost(path: string, body: unknown, token?: string) {
  const res = await fetch(`${API_URL}/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}: ${text}`);
  return JSON.parse(text);
}

export async function signup(name: string): Promise<TestUser> {
  const email = uniqueEmail(name.toLowerCase());
  const data = await apiPost('/auth/signup', { name, email, password: 'password123' });
  return { token: data.token, user: data.user };
}

export async function createBoard(owner: TestUser, title = 'E2E Board') {
  const data = await apiPost('/boards', { title }, owner.token);
  return data.board as { _id: string; title: string };
}

export async function invite(owner: TestUser, boardId: string, email: string, role = 'editor') {
  return apiPost(`/boards/${boardId}/invite`, { email, role }, owner.token);
}

/**
 * Opens a board in a fresh browser context authenticated as `as`. The token is
 * seeded straight into localStorage rather than driven through the login form —
 * these tests are about the sync path, not about the login page.
 */
export async function openBoard(browser: Browser, as: TestUser, boardId: string): Promise<Page> {
  const context = await browser.newContext();
  await context.addInitScript((token) => {
    window.localStorage.setItem('token', token);
  }, as.token);

  const page = await context.newPage();
  await page.goto(`/board/${boardId}`);

  // `__fabricCanvas` is set in CanvasBoard's init effect (dev builds only).
  await page.waitForFunction(() => Boolean((window as any).__fabricCanvas), null, {
    timeout: 30_000,
  });
  return page;
}

/** objectIds currently on this client's canvas. */
export function canvasObjectIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as any).__fabricCanvas
      .getObjects()
      .map((o: any) => o.objectId)
      .filter(Boolean)
  );
}

export async function selectTool(page: Page, title: string) {
  await page.getByTitle(title, { exact: true }).click();
}

/** Drags a shape onto the canvas using real mouse events. */
export async function dragOnCanvas(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number }
) {
  const canvas = page.locator('canvas.upper-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas has no bounding box — is the editor mounted?');

  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 10 });
  await page.mouse.up();
}

// ---------------------------------------------------------------------------
// Raw API access, for asserting on status codes the UI never surfaces.
// ---------------------------------------------------------------------------

export async function apiRaw(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {}
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

export async function boardObjectCount(as: TestUser, boardId: string): Promise<number> {
  const { status, body } = await apiRaw('GET', `/boards/${boardId}`, { token: as.token });
  if (status !== 200) throw new Error(`GET /boards/${boardId} -> ${status}`);
  return body.objects.length;
}

// ---------------------------------------------------------------------------
// Direct socket access. The socket guard is invisible from the UI (REST already
// blocks a non-member before the editor mounts), so these tests speak the
// protocol directly.
// ---------------------------------------------------------------------------

export function connectSocket(as: TestUser): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(API_URL, {
      auth: { token: as.token },
      transports: ['websocket'],
      reconnection: false,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
  });
}

/** Resolves with whichever of `events` fires first, or rejects on timeout. */
export function raceEvents(
  socket: Socket,
  events: string[],
  timeoutMs = 5_000
): Promise<{ event: string; payload: any }> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      events.forEach((e) => socket.off(e, handlers[e]));
    };
    const handlers: Record<string, (payload: any) => void> = {};
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for one of: ${events.join(', ')}`));
    }, timeoutMs);

    events.forEach((event) => {
      handlers[event] = (payload: any) => {
        cleanup();
        resolve({ event, payload });
      };
      socket.on(event, handlers[event]);
    });
  });
}

/** Asserts an event does NOT arrive within the window. */
export function expectNoEvent(socket: Socket, event: string, windowMs = 1_500): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (payload: any) => {
      clearTimeout(timer);
      reject(new Error(`Unexpected "${event}": ${JSON.stringify(payload)}`));
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, windowMs);
    socket.on(event, handler);
  });
}
