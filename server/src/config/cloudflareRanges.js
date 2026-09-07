/**
 * Cloudflare's published edge ranges.
 *
 * Render serves *.onrender.com through Cloudflare, so the forwarded chain is
 * client -> Cloudflare -> Render, not client -> Render. Without these the walk
 * in trustProxy.js stops at the Cloudflare edge, because that address is public
 * and therefore looks like a caller. Probing a deploy returned 172.69.179.131,
 * 162.158.227.154, 172.68.175.70 and 104.23.160.149 for one client in five
 * seconds -- every one of them an edge in the list below.
 *
 * Trusting these is not a weakening. The walk goes right to left and stops at
 * the first address it does not trust, so anything a client forges sits to the
 * left of the entry Cloudflare appended and is never reached.
 *
 * Going stale is safe in the same direction. A range added after this was
 * written is simply not trusted, so the walk stops there -- the behaviour we
 * already had, never worse. Refresh from https://www.cloudflare.com/ips-v4 and
 * https://www.cloudflare.com/ips-v6 if `ip` in /api/health starts coming back
 * as an address that is not the caller's.
 *
 * Fetched 2026-09-07.
 */
export const CLOUDFLARE_RANGES = [
  // IPv4 -- https://www.cloudflare.com/ips-v4
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',

  // IPv6 -- https://www.cloudflare.com/ips-v6
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];
