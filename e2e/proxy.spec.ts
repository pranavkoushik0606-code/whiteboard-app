import { test, expect } from '@playwright/test';
import { API_URL } from './config';

/**
 * `trust proxy`.
 *
 * Found by probing the live deployment: every upload URL came back as `http://`
 * from an HTTPS host, which is `req.protocol` reading the socket rather than
 * `X-Forwarded-Proto`. The same misreading applies to `req.ip`, and that one is
 * worse — express-rate-limit keys on it, so behind a proxy the whole site shares
 * one bucket and the auth limiter becomes 20 login attempts per 15 minutes for
 * everyone at once.
 *
 * The test server is not behind a proxy, so these send the headers a proxy would
 * and check the app believes them.
 */

async function health(headers: Record<string, string> = {}) {
  const res = await fetch(`${API_URL}/api/health`, { headers });
  return { status: res.status, body: await res.json() };
}

test('the client IP is taken from X-Forwarded-For, not from the socket', async () => {
  const { status, body } = await health({ 'X-Forwarded-For': '203.0.113.9' });

  expect(status).toBe(200);
  // Without `trust proxy` this is the connecting address (::1 in the suite, the
  // proxy's address in production) and every caller looks like the same person
  // to the rate limiter.
  expect(body.ip).toBe('203.0.113.9');
});

test('only the hop the proxy added is trusted, not the chain the client wrote', async () => {
  // A client can put anything at the left-hand end of X-Forwarded-For. With
  // `trust proxy: true` the app would believe the leftmost entry and hand out a
  // rate-limit bypass to anyone who sends a header; a hop count of 1 takes the
  // entry the proxy itself appended and ignores the rest.
  const { body } = await health({ 'X-Forwarded-For': '1.2.3.4, 203.0.113.9' });

  expect(body.ip).toBe('203.0.113.9');
  expect(body.ip).not.toBe('1.2.3.4');
});

test('with no proxy headers the socket address is still used', async () => {
  const { body } = await health();

  expect(body.ip).toBeTruthy();
  expect(body.ip).not.toBe('203.0.113.9');
});
