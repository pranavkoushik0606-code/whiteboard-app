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
| `PUBLIC_URL` | the request's own `protocol://host` | origin used to build the absolute URL returned by the image upload. Only used by the local-disk store. Worth setting when you are on it: the fallback reads a client-supplied `Host` header, and that URL ends up as an object's `src` on a shared board |
| `CLOUDINARY_URL` | unset → local disk | `cloudinary://<key>:<secret>@<cloud>`, copied from the Cloudinary dashboard's *API Environment variable*. **Set this on any host with an ephemeral filesystem**, which includes every Render tier: without it uploads go to the container and are wiped on restart, and a free service sleeps after ~15 minutes idle, so images start 404ing the same day. Contains a secret — host env only |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | unset | the split form of the above. All three are required together; two of three reads as *not configured*, so a half-filled dashboard fails visibly instead of quietly writing to a disk that is about to vanish |
| `CLOUDINARY_FOLDER` | `whiteboard` | folder assets are uploaded into |
| `TRUST_PROXY` | private ranges + Cloudflare's | which `X-Forwarded-For` entries to believe. The default walks right to left past every private address *and* every Cloudflare edge, stopping at the first address that is neither — no hop count needed, which matters because the platform's is not fixed. Cloudflare is in the list because Render serves `*.onrender.com` through it, so the chain is `client → Cloudflare → Render`. Leave it unset. **Never set it to `true`**: that trusts the whole chain, and the client writes the left-hand end of it, so it hands out a rate-limit bypass to anyone who sends a header. A bare number is read as a hop count, which is almost never what you want here |

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
4. **Uploads → Cloudinary** — set `CLOUDINARY_URL` in the Render dashboard. Sign in at
   cloudinary.com, and the dashboard shows an *API Environment variable*. Set the value to
   **only the part from `cloudinary://` onwards** — the dashboard displays it as
   `CLOUDINARY_URL=cloudinary://...`, and including that `CLOUDINARY_URL=` prefix is the
   easiest mistake to make here. Nothing else is needed; the free tier is ample and the app
   creates the folder on first upload.

   `render.yaml` already declares this key, so if the service is blueprint-managed the row
   exists in the dashboard with an empty value — edit that one rather than adding a second,
   which Render rejects as a duplicate.

   Skipping this is not a small thing. Without it images go to the container filesystem,
   which Render wipes on every restart, and a free service sleeps after ~15 minutes of no
   traffic. The board keeps the object and its `src`; the file behind it is gone, usually
   the same day. `/api/health` reports `imageStore`, so you can check rather than wait to
   find out.

   Two gaps this does not close: the endpoint is authenticated but not board-scoped, and
   nothing ever deletes an asset, so Cloudinary accumulates every image ever uploaded.

   `PUBLIC_URL` only matters if you stay on the local-disk store.
5. **Check `trust proxy` landed** — `curl https://<your-api>/api/health` answers with three
   fields that matter:

   ```json
   {
     "ip": "203.0.113.9",
     "commit": "360402f",
     "trustProxy": "default",
     "imageStore": "cloudinary"
   }
   ```

   `imageStore` should say `cloudinary` after step 4. If it says `disk`, check
   `imageStoreError`: it names the problem when `CLOUDINARY_URL` is set but unusable, and is
   `null` when the variable simply is not there. The split form needs all three parts, and
   two of three deliberately reads as unconfigured rather than half-working.

   `ip` should be *your* address. If it is not, `commit` and `trustProxy` say why: an old
   `commit` means the deploy has not landed, and a `trustProxy` other than `default` means
   the dashboard is overriding the setting. Those two look identical from the outside
   otherwise, which is why the fields are there. If both are right and `ip` is still wrong,
   check what it is — a Cloudflare address means their published ranges have moved on from
   the copy in `server/src/config/cloudflareRanges.js` and need refreshing. An earlier version of this file told you to
   set `TRUST_PROXY=1`; on Render that reported a `10.x` router as the caller, which is the
   bug the setting exists to prevent. Getting this wrong is quiet and expensive: without it
   `req.ip` is the proxy for every visitor, so express-rate-limit puts the entire userbase in
   one bucket — the auth limiter becomes 20 login attempts per 15 minutes *for the whole
   site*, not per person — and `req.protocol` reads `http` behind a TLS-terminating proxy,
   which is where the `http://` upload URLs on an HTTPS page came from.
6. **Email** — replace the Ethereal transporter in `server/src/utils/sendEmail.js` with a
   real provider (SES, SendGrid, Resend…) and **delete the `devPreviewUrl` field** from the
   forgot-password response in `authController.js`.
7. *(Optional)* **Google OAuth** — add a `passport-google-oauth20` strategy to
   `authController.js` plus a button on the client. Nothing for this exists yet.

## Deliberate substitutions

| Full-spec item | Why it isn't here | What's here instead |
|---|---|---|
| Google OAuth | needs a manually created Google Cloud OAuth client | email/password JWT auth only |
| Cloudinary | needs an external account + API key | Multer → local disk, served from `/uploads` |
| Real reset emails | needs a live SMTP/SendGrid account | Ethereal test inbox; the flow works end to end and the preview link is logged and returned as `devPreviewUrl` |
| Live deploy | requires dashboard access | `docker-compose.yml` for local, `render.yaml` / `vercel.json` ready for a manual deploy |
