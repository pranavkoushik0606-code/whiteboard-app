import type { Browser, Page } from '@playwright/test';
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
