import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { API_URL } from './config';
// @ts-expect-error -- plain JS module, no types
import {
  usingCloudinary,
  cloudinaryUrlProblem,
  EXTENSIONS,
  storeImage,
  uploadsDir,
} from '../server/src/services/imageStore.js';

/**
 * Which store the uploads go to.
 *
 * images.spec.ts covers the whole upload path, but only against the local disk,
 * because the suite runs with no Cloudinary credentials. What that leaves
 * untested is the choice itself — and getting it wrong is silent. Uploads keep
 * working, they just land on Render's ephemeral disk and start 404ing after the
 * service next sleeps, which on the free tier is within the hour.
 */

const CLOUDINARY_ENV = [
  'CLOUDINARY_URL',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved = Object.fromEntries(CLOUDINARY_ENV.map((k) => [k, process.env[k]]));
  CLOUDINARY_ENV.forEach((k) => delete process.env[k]);
  Object.entries(vars).forEach(([k, v]) => {
    if (v !== undefined) process.env[k] = v;
  });
  try {
    fn();
  } finally {
    CLOUDINARY_ENV.forEach((k) => delete process.env[k]);
    Object.entries(saved).forEach(([k, v]) => {
      if (v !== undefined) process.env[k] = v;
    });
  }
}

test('with nothing configured the store is the local disk', () => {
  withEnv({}, () => expect(usingCloudinary()).toBe(false));
});

test('CLOUDINARY_URL on its own is enough', () => {
  withEnv({ CLOUDINARY_URL: 'cloudinary://key:secret@cloudname' }, () =>
    expect(usingCloudinary()).toBe(true)
  );
});

test('the split form needs all three parts, not some of them', () => {
  // Half-configured is the dangerous state: it looks set up in the dashboard
  // and silently writes to a disk that is about to be wiped. It has to read as
  // "not configured" so /api/health says `disk` and the deploy check catches it.
  withEnv({ CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: 'k' }, () =>
    expect(usingCloudinary()).toBe(false)
  );
  withEnv({ CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_SECRET: 's' }, () =>
    expect(usingCloudinary()).toBe(false)
  );
  withEnv(
    { CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' },
    () => expect(usingCloudinary()).toBe(true)
  );
});

test('the disk store names files from the mimetype, never from the upload', async () => {
  // The stored-XSS guard, kept when the write moved out of the multer config.
  // A file the client calls evil.html and declares image/png must not land as
  // .html, because express.static would then serve it as text/html on the
  // API's own origin -- the origin every session token is sent to.
  const stored = await storeImage(Buffer.from('not really a png'), 'image/png');

  try {
    expect(stored.path).toMatch(/^\/uploads\/[0-9a-f-]+\.png$/);
    expect(stored.path).not.toContain('.html');
    // No absolute URL: the origin to serve a local file from is the caller's
    // decision, and it needs the request to make it.
    expect(stored.url).toBeUndefined();
  } finally {
    rmSync(join(uploadsDir, stored.path.replace('/uploads/', '')), { force: true });
  }
});

test('every accepted mimetype maps to an image extension', () => {
  for (const [type, ext] of Object.entries(EXTENSIONS)) {
    expect(type.startsWith('image/')).toBe(true);
    expect(['.png', '.jpg', '.gif', '.webp']).toContain(ext);
  }
});

test('a CLOUDINARY_URL that cannot work is rejected, not handed to the SDK', () => {
  // The SDK parses this variable when its module is imported and throws on a
  // bad one, so importing it eagerly meant a mistyped environment variable
  // crashed the whole API at boot -- over a setting that only affects uploads.
  // A deploy failed exactly that way. The import is lazy now and these never
  // reach it.
  withEnv({ CLOUDINARY_URL: 'https://cloudinary.com/console' }, () => {
    expect(usingCloudinary()).toBe(false);
    expect(cloudinaryUrlProblem()).toContain('must start with cloudinary://');
  });

  // The likeliest mistake by a distance: Cloudinary's dashboard displays the
  // value as `CLOUDINARY_URL=cloudinary://...` and pasting the whole line is
  // the obvious thing to do. It gets its own message.
  withEnv({ CLOUDINARY_URL: 'CLOUDINARY_URL=cloudinary://k:s@cloud' }, () => {
    expect(usingCloudinary()).toBe(false);
    expect(cloudinaryUrlProblem()).toContain('includes the variable name');
  });

  // Whitespace from a paste is survivable, not a misconfiguration.
  withEnv({ CLOUDINARY_URL: '  cloudinary://k:s@cloud\n' }, () => {
    expect(usingCloudinary()).toBe(true);
    expect(cloudinaryUrlProblem()).toBeNull();
  });

  withEnv({}, () => expect(cloudinaryUrlProblem()).toBeNull());
});

test('health says which store is live', async () => {
  const res = await fetch(`${API_URL}/api/health`);
  const body = await res.json();

  // The suite has no credentials, so this is the honest answer here. In
  // production it is the one call that catches a missing CLOUDINARY_URL before
  // the uploads start disappearing.
  expect(body.imageStore).toBe('disk');
  expect(body.imageStoreError).toBeNull();
});
