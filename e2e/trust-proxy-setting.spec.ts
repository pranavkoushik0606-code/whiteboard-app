import { test, expect } from '@playwright/test';
import type { AddressInfo } from 'node:net';
// Reached into deliberately rather than added as a root dependency: the point
// is what the Express the server actually runs does with these values, so the
// test should not be able to drift onto a different copy.
// @ts-expect-error -- untyped deep import
import express from '../server/node_modules/express/index.js';
// @ts-expect-error -- plain JS module, no types
import { trustProxySetting, DEFAULT_TRUST_PROXY } from '../server/src/config/trustProxy.js';

/**
 * The value handed to `app.set('trust proxy', ...)`.
 *
 * proxy.spec.ts covers the running server, which boots with TRUST_PROXY unset.
 * That leaves the branch for a value being set untested, and it is the branch
 * that broke: passing the raw string through meant `TRUST_PROXY=1` stopped
 * meaning one hop and started meaning the IP address 0.0.0.1, which trusts
 * nothing. The symptom — the proxy reported as the caller — is identical to the
 * bug the setting exists to fix, so it reads as "not deployed yet".
 */

/** What Express actually resolves as the caller, given a setting and a chain. */
async function resolve(setting: unknown, xff: string): Promise<string> {
  const app = express();
  app.set('trust proxy', setting);
  app.get('/', (req, res) => res.json({ ip: req.ip }));
  const srv = app.listen(0);
  await new Promise((r) => srv.on('listening', r));
  try {
    const { port } = srv.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { 'X-Forwarded-For': xff } });
    return (await res.json()).ip;
  } finally {
    srv.close();
  }
}

test('unset, blank and whitespace all mean the default', () => {
  expect(trustProxySetting(undefined)).toEqual(DEFAULT_TRUST_PROXY);
  expect(trustProxySetting('')).toEqual(DEFAULT_TRUST_PROXY);
  expect(trustProxySetting('   ')).toEqual(DEFAULT_TRUST_PROXY);
});

test('a numeric value stays a hop count instead of becoming an IP address', async () => {
  expect(trustProxySetting('1')).toBe(1);
  expect(trustProxySetting(' 2 ')).toBe(2);

  // The chain a two-hop proxy produces. As a number, 1 walks one hop in.
  const chain = '203.0.113.9, 10.28.1.1';
  expect(await resolve(trustProxySetting('1'), chain)).toBe('10.28.1.1');

  // Passed through as a string it would be the address 0.0.0.1: nothing is
  // trusted, X-Forwarded-For is ignored, and the socket wins.
  expect(await resolve('1', chain)).toBe('::ffff:127.0.0.1');
});

test('the default walks past a private tail of any length', async () => {
  expect(await resolve(trustProxySetting(undefined), '203.0.113.9, 10.28.1.1')).toBe('203.0.113.9');
  expect(await resolve(trustProxySetting(undefined), '203.0.113.9, 10.28.1.1, 10.24.2.2')).toBe(
    '203.0.113.9'
  );
});

test('a non-numeric value is passed through as a subnet spec', () => {
  expect(trustProxySetting('10.0.0.0/8')).toBe('10.0.0.0/8');
  expect(trustProxySetting('loopback, uniquelocal')).toBe('loopback, uniquelocal');
});
