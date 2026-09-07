import { test, expect, type Page, type Browser } from '@playwright/test';
import { apiRaw, createBoard, signup, type TestUser } from './helpers';

/** Settings, authenticated the same way the other page helpers do it. */
async function openSettings(browser: Browser, as: TestUser): Promise<Page> {
  const context = await browser.newContext();
  await context.addInitScript((token) => {
    window.localStorage.setItem('token', token);
  }, as.token);
  const page = await context.newPage();
  await page.goto('/settings');
  await page.waitForSelector('text=Delete account');
  return page;
}

test('deleting an account is behind a confirmation and a password', async ({ browser }) => {
  const user = await signup('Deleter');
  await createBoard(user, 'Will go');
  const page = await openSettings(browser, user);

  // The destructive control is not the first thing you can click.
  await expect(page.getByTitle('Confirm delete account')).toHaveCount(0);
  await page.getByTitle('Delete account', { exact: true }).click();
  await expect(page.getByTitle('Confirm delete account')).toBeVisible();

  // A wrong password is reported, and the account is still there.
  await page.getByPlaceholder('Your password').fill('not-my-password');
  await page.getByTitle('Confirm delete account').click();
  await expect(page.locator('[data-testid="delete-error"]')).toContainText('Incorrect password');
  expect((await apiRaw('GET', '/auth/me', { token: user.token })).status).toBe(200);

  // The right one deletes it and leaves the app.
  await page.getByPlaceholder('Your password').fill('password123');
  await page.getByTitle('Confirm delete account').click();
  await expect(page).toHaveURL(/\/signup$/);

  expect((await apiRaw('GET', '/auth/me', { token: user.token })).status).toBe(401);
  await page.close();
});

test('cancelling leaves the account alone', async ({ browser }) => {
  const user = await signup('Stayer');
  const page = await openSettings(browser, user);

  await page.getByTitle('Delete account', { exact: true }).click();
  await page.getByPlaceholder('Your password').fill('password123');
  await page.getByTitle('Cancel delete account').click();

  await expect(page.getByTitle('Confirm delete account')).toHaveCount(0);
  // Re-opening starts from an empty box rather than a primed one.
  await page.getByTitle('Delete account', { exact: true }).click();
  await expect(page.getByPlaceholder('Your password')).toHaveValue('');

  expect((await apiRaw('GET', '/auth/me', { token: user.token })).status).toBe(200);
  await page.close();
});
