# Collaborative Whiteboard

A real-time collaborative whiteboard app (Miro-style) built with React, Fabric.js, Node/Express, Socket.io, and MongoDB.

## Stack

- **Frontend:** React 19 + Vite + TypeScript + Tailwind CSS + Fabric.js + Zustand + Socket.io-client + Framer Motion
- **Backend:** Node.js + Express + MongoDB (Mongoose) + Socket.io + JWT auth
- **Storage:** Local disk (Multer) — see note below on Cloudinary
- **Email:** Ethereal test inbox (Nodemailer) — see note below on real email

## Features implemented

- Email/password auth (signup, login, JWT, protected routes, persistent login, forgot/reset password)
- Dashboard: create/rename/delete/duplicate boards, favorites, search, grid/list view, shared boards
- Infinite canvas with pan (space+drag) and zoom (scroll wheel)
- Drawing tools: pencil, highlighter, marker, eraser
- Shapes: rectangle, circle, triangle, diamond, star, line, arrow
- Text boxes and resizable sticky notes
- Object transforms: move, resize, rotate, duplicate (Ctrl+D), delete, layer order (`[` / `]`), multi-select
- Undo/redo (Ctrl+Z / Ctrl+Y), keyboard shortcuts
- Real-time sync: live cursors, object add/update/delete, presence indicators, join/leave
- Comments: add, resolve, timestamps, mentions (stored; UI shows author + resolve toggle)
- Version history: auto-save snapshots, restore any previous version
- Export: PNG, JPEG, JSON (download); JSON import via bulk-upsert endpoint
- Dark mode / light mode
- Security: Helmet, CORS, rate limiting, Mongo sanitization, bcrypt password hashing, JWT

## Features intentionally simplified or deferred

A few items from a full Miro-scope spec were **cut or swapped** because they require external
accounts/credentials that can't be provisioned by an AI assistant (see table below), and a few
"nice-to-have" polish items (rulers, minimap, image cropping/filters, bezier/polyline tools,
persistent laser-pointer trails, object grouping UI) were left out to keep this a buildable,
honest starting point rather than a pile of half-finished stubs. All of these are reasonable
follow-up tasks — the architecture (models, routes, socket events, canvas object system) supports
adding them incrementally.

| Spec item | Why it's swapped | What's here instead |
|---|---|---|
| Google OAuth | Needs a manually-created Google Cloud OAuth client | Email/password JWT auth only |
| Cloudinary | Needs an external account + API key | Local disk storage via Multer (`/uploads`) |
| Real password-reset emails | Needs a live SMTP/SendGrid account | Ethereal test inbox — reset flow works end-to-end, with a preview link logged to the console and returned in the API response (`devPreviewUrl`) |
| Live deploy to Vercel/Render/Atlas | Requires clicking through someone else's dashboard | `docker-compose.yml` for one-command local run, plus ready-to-use `vercel.json` / `render.yaml` for when you're ready to deploy manually |

## Getting started (Docker — recommended)

```bash
docker compose up --build
```

Frontend: http://localhost:5173
Backend: http://localhost:5000/api/health

## Getting started (manual)

**Backend**
```bash
cd server
cp .env.example .env      # edit JWT_SECRET at minimum
npm install
npm run dev
```

**Frontend** (in a second terminal)
```bash
cd client
cp .env.example .env
npm install
npm run dev
```

You'll need a local MongoDB running on `mongodb://localhost:27017/whiteboard`, or point
`MONGO_URI` in `server/.env` at a MongoDB Atlas cluster.

## Project structure

```
server/
  src/
    config/       # DB connection
    models/       # Mongoose schemas: User, Board, BoardMember, CanvasObject, Comment, Notification, Version
    middleware/    # auth, board-access, error handling
    controllers/   # route handlers
    routes/        # Express routers
    socket/        # Socket.io realtime handler
    utils/         # JWT, email, async wrapper
client/
  src/
    pages/         # Login, Signup, Dashboard, BoardEditor, Settings, etc.
    canvas/        # Fabric.js canvas engine + export/autosave helpers
    components/    # Toolbar, PresenceCursors, CommentsPanel, VersionHistoryPanel, ExportMenu
    store/         # Zustand stores (auth, boards, canvas UI state)
    hooks/         # useSocket
```

## Deploying for real (manual steps required)

1. **MongoDB Atlas** — create a free cluster, get the connection string, set it as `MONGO_URI`.
2. **Render** — connect this repo, it'll pick up `render.yaml`; set `MONGO_URI`, `JWT_SECRET`, `CLIENT_URL` env vars in the dashboard.
3. **Vercel** — import the `client/` folder, it'll pick up `vercel.json`; set `VITE_API_URL` / `VITE_SOCKET_URL` to your Render URL.
4. *(Optional)* Google OAuth — create credentials in Google Cloud Console, then add a `passport-google-oauth20` strategy to `server/src/controllers/authController.js` and a "Sign in with Google" button on the client.
5. *(Optional)* Cloudinary — create an account, swap the Multer disk storage in `server/src/routes/uploadRoutes.js` for `multer-storage-cloudinary`.
