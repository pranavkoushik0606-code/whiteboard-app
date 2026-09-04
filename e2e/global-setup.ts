import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { API_PORT, API_URL, CLIENT_URL, JWT_SECRET } from './config';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server');

async function waitForHealth(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_URL}/api/health`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`API never became healthy at ${API_URL}/api/health. Last error: ${lastErr}`);
}

/**
 * Boots an in-memory MongoDB and the Express/Socket.io server as a child
 * process, so the suite needs neither Docker nor a local mongod. The Vite
 * client is started separately by `webServer` in playwright.config.ts.
 *
 * Returns its own teardown, which Playwright runs after the last test.
 */
export default async function globalSetup() {
  console.log('[e2e] starting in-memory MongoDB (first run downloads a mongod binary)...');
  const mongo = await MongoMemoryServer.create();
  const mongoUri = mongo.getUri('whiteboard_e2e');

  console.log(`[e2e] starting API server on ${API_URL}...`);
  const server: ChildProcess = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(API_PORT),
      MONGO_URI: mongoUri,
      JWT_SECRET,
      JWT_EXPIRES_IN: '1d',
      CLIENT_URL,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout?.on('data', (d) => process.stdout.write(`[server] ${d}`));
  server.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));
  server.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`[server] exited early with code ${code}`);
  });

  await waitForHealth();
  console.log('[e2e] API ready.');

  return async () => {
    server.kill();
    await mongo.stop();
  };
}
