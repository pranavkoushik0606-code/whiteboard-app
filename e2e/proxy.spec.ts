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
  // rate-limit bypass to anyone who sends a header. Walking right to left stops
  // at the address the proxy itself appended and ignores the rest.
  const { body } = await health({ 'X-Forwarded-For': '1.2.3.4, 203.0.113.9' });

  expect(body.ip).toBe('203.0.113.9');
  expect(body.ip).not.toBe('1.2.3.4');
});

test('a private address at the end of the chain is walked past, however many there are', async () => {
  // This is the case a hop count got wrong, and the reason the setting is a
  // subnet list now. `TRUST_PROXY=1` on Render reported a 10.x router as the
  // caller -- one shared rate-limit bucket for everyone, which is the bug the
  // setting exists to prevent. The count of internal hops is not fixed, so the
  // number that would have been right here is not knowable in advance.
  const two = await health({ 'X-Forwarded-For': '203.0.113.9, 10.28.1.1' });
  expect(two.body.ip).toBe('203.0.113.9');

  const three = await health({ 'X-Forwarded-For': '203.0.113.9, 10.28.1.1, 10.24.2.2' });
  expect(three.body.ip).toBe('203.0.113.9');
});

test('a forged private address does not shift which entry is believed', async () => {
  // The mirror image of the above: since private addresses are skipped, a client
  // that prepends one must not push the walk past the genuine entry.
  const { body } = await health({ 'X-Forwarded-For': '10.0.0.1, 203.0.113.9, 10.28.1.1' });

  expect(body.ip).toBe('203.0.113.9');
});

test('with no proxy headers the socket address is still used', async () => {
  const { body } = await health();

  expect(body.ip).toBeTruthy();
  expect(body.ip).not.toBe('203.0.113.9');
});
