/**
 * Decides what to hand `app.set('trust proxy', ...)`.
 *
 * Unset is the intended state in production. The default trusts every private
 * address in X-Forwarded-For and takes the first public one, walking right to
 * left, so the number of proxy hops does not have to be known -- which matters,
 * because Render's is not fixed: probing one deploy returned 10.24.193.138 and
 * 10.28.162.132 for the same caller seconds apart.
 *
 * A number is still honoured as a hop count for hosts where that is genuinely
 * right, but it has to be converted first. `app.set('trust proxy', '1')` does
 * not mean one hop: Express reads a string as a subnet list, and '1' parses as
 * the address 0.0.0.1, so it trusts nothing and reports the proxy as the caller
 * -- the same symptom as the misconfiguration this is meant to prevent, which
 * is why it is worth a branch rather than a coercion at the call site.
 *
 * `true` is deliberately not special-cased. It trusts the client-written end of
 * the chain and hands out a rate-limit bypass; Express rejects it as an invalid
 * IP, and a startup crash is the right outcome.
 */
export const DEFAULT_TRUST_PROXY = ['loopback', 'uniquelocal'];

export function trustProxySetting(raw) {
  if (raw === undefined || raw === null || raw.trim() === '') return DEFAULT_TRUST_PROXY;
  const value = raw.trim();
  return /^\d+$/.test(value) ? Number(value) : value;
}
