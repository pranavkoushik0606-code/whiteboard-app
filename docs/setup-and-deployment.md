# Setup and deployment

## Option A — Docker (one command)

```bash
docker compose up --build
```

Brings up three containers defined in `docker-compose.yml`:

| Service | Image / build | Port | Notes |
|---|---|---|---|
| `mongo` | `mongo:7` | 27017 | named volume `mongo_data` |
| `server` | `./server` | 5000 | env inlined (incl. `JWT_SECRET=dev_only_change_me`), source bind-mounted with an anonymous volume over `node_modules` |
| `client` | `./client` | 5173 | Vite dev server with `--host`, same bind-mount trick |

- Frontend: <http://localhost:5173>
- API health: <http://localhost:5000/api/health>

Both Dockerfiles are `node:20-alpine`, `npm install`, and run the **dev** script — this
compose file is a development convenience, not a production image.

## Option B — manual

```bash
# terminal 1
cd server
cp .env.example .env       # set JWT_SECRET at minimum
npm install
npm run dev                # nodemon src/index.js

# terminal 2
cd client
cp .env.example .env
npm install
npm run dev                # vite on :5173
```

Requires MongoDB on `mongodb://localhost:27017/whiteboard`, or point `MONGO_URI` at Atlas.
`connectDB` exits the process if the connection fails, so the server won't start without a
reachable database.

## Environment variables

**`server/.env`**

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | HTTP + Socket.io port |
| `NODE_ENV` | `development` | `production` switches morgan to `combined` and hides error stacks |
| `CLIENT_URL` | `http://localhost:5173` | CORS origin for both Express and Socket.io; also the base for password-reset links |
| `MONGO_URI` | `mongodb://localhost:27017/whiteboard` | |
| `JWT_SECRET` | — | **required**; no fallback, tokens can't be signed without it |
| `JWT_EXPIRES_IN` | `7d` | |
| `EMAIL_FROM` | `noreply@whiteboard.dev` | only matters once a real SMTP provider replaces Ethereal |

**`client/.env`**

| Var | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:5000/api` | axios base URL |
| `VITE_SOCKET_URL` | `http://localhost:5000` | socket.io-client target |

## Scripts

| Where | Script | Runs |
|---|---|---|
| server | `npm run dev` | `nodemon src/index.js` |
| server | `npm start` | `node src/index.js` |
| client | `npm run dev` | `vite` (port 5173) |
| client | `npm run build` | `tsc -b && vite build` → `dist/` |
| client | `npm run preview` | `vite preview` |
| client | `npm run lint` | `eslint .` (flat config in `client/eslint.config.js`) |
| root | `npm run test:e2e` | Playwright collaboration suite |
| root | `npm run test:e2e:headed` | same, with a visible browser |
| root | `npm run test:e2e:ui` | Playwright's interactive UI mode |
| root | `npm run e2e:install` | downloads the Chromium build Playwright drives |

The repo root has a `package.json` too, but it is **test tooling only** — the deployable
apps are `client/` and `server/`, each with its own. Vercel builds `client/`, Render builds
`server/` via `rootDir` in `render.yaml`.

## Tests

```bash
npm install          # at the repo root, once
npm run e2e:install  # downloads Chromium, once
npm run test:e2e
```

Nothing else needs to be running. `e2e/global-setup.ts` starts an in-memory MongoDB and
the API server as a child process on port 5001, and `playwright.config.ts` starts Vite on
port 5174 — both deliberately off the dev defaults so a running `npm run dev` does not
collide. Everything is torn down when the run ends.

**You do not need Docker or a local mongod.** The first run downloads a `mongod` binary
(~100 MB) into `node_modules/.cache`; later runs reuse it.

`e2e/collab.spec.ts` opens the same board in two real browser contexts and asserts that a
rectangle drawn by one appears on the other's canvas, and that it survives a reload. That
covers the socket broadcast, the persistence write, and the rehydrate-on-load path — the
three things that cannot be checked by reading a diff.

Assertions read `window.__fabricCanvas`, a handle set in `CanvasBoard`'s init effect under
`import.meta.env.DEV`. Fabric renders to a bitmap, so there are no per-object DOM nodes to
query instead. The handle does not exist in production builds.

There are no unit or API tests yet.

## Deploy configs already in the repo

**`render.yaml`** — one `web` service, free plan, `rootDir: server`, build `npm install`,
start `npm start`. `NODE_ENV=production`, `PORT=5000` and `JWT_EXPIRES_IN=7d` are baked in;
`MONGO_URI`, `JWT_SECRET` and `CLIENT_URL` are `sync: false`, i.e. you set them in the
Render dashboard.

**`client/vercel.json`** — Vite framework preset, `npm run build` → `dist`, with a
catch-all rewrite to `/index.html` so client-side routes deep-link correctly.

## Manual steps to actually go live

1. **MongoDB Atlas** — create a cluster, copy the connection string into `MONGO_URI`.
2. **Render** — connect the repo (it picks up `render.yaml`); set `MONGO_URI`, `JWT_SECRET`
   and `CLIENT_URL` in the dashboard.
3. **Vercel** — import the `client/` directory; set `VITE_API_URL` and `VITE_SOCKET_URL` to
   the Render URL.
4. **Uploads** — Render's free tier has an ephemeral filesystem, so `server/uploads/` is
   wiped on every deploy/restart. Move to object storage (S3/Cloudinary) before relying on
   image upload in production: swap the Multer disk storage in
   `server/src/routes/uploadRoutes.js` for `multer-storage-cloudinary` or an S3 storage engine.
5. **Email** — replace the Ethereal transporter in `server/src/utils/sendEmail.js` with a
   real provider (SES, SendGrid, Resend…) and **delete the `devPreviewUrl` field** from the
   forgot-password response in `authController.js`.
6. *(Optional)* **Google OAuth** — add a `passport-google-oauth20` strategy to
   `authController.js` plus a button on the client. Nothing for this exists yet.

## Deliberate substitutions

| Full-spec item | Why it isn't here | What's here instead |
|---|---|---|
| Google OAuth | needs a manually created Google Cloud OAuth client | email/password JWT auth only |
| Cloudinary | needs an external account + API key | Multer → local disk, served from `/uploads` |
| Real reset emails | needs a live SMTP/SendGrid account | Ethereal test inbox; the flow works end to end and the preview link is logged and returned as `devPreviewUrl` |
| Live deploy | requires dashboard access | `docker-compose.yml` for local, `render.yaml` / `vercel.json` ready for a manual deploy |
