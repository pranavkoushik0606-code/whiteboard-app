# Documentation

Reference documentation for the Collaborative Whiteboard app — what exists in the
codebase today, how the pieces fit together, and what is still missing.

Last updated: 2026-09-02 (against commit `92ceeea`).

## Contents

| Doc | What's in it |
|---|---|
| [architecture.md](architecture.md) | System overview, request/realtime flow, directory map, design decisions |
| [data-model.md](data-model.md) | All 7 Mongoose schemas, fields, indexes, relationships |
| [api-reference.md](api-reference.md) | Every REST endpoint: method, path, auth, body, response |
| [realtime-events.md](realtime-events.md) | Socket.io handshake, rooms, and every event in both directions |
| [frontend.md](frontend.md) | Routes, pages, components, Zustand stores, the Fabric.js canvas engine |
| [setup-and-deployment.md](setup-and-deployment.md) | Local run (Docker + manual), env vars, Docker/Render/Vercel configs |
| [implementation-status.md](implementation-status.md) | Feature-by-feature status, backend-only features with no UI, known bugs |
| [roadmap.md](roadmap.md) | The remaining work cut into shippable sprints, with estimates and dependencies |

## One-paragraph summary

A Miro-style real-time collaborative whiteboard. The frontend is React 19 + Vite +
TypeScript with Fabric.js driving an infinite canvas, Zustand for state and Tailwind for
styling. The backend is Node/Express with Mongoose over MongoDB, JWT auth, and a Socket.io
layer that broadcasts canvas mutations and cursor presence to everyone in a board room.
Canvas state is stored one Fabric object per Mongo document, so a board can be rehydrated
by fetching its objects and enlivening them client-side. Version history is snapshot-based,
image uploads go to local disk (not Cloudinary), and password-reset mail goes through
Nodemailer's Ethereal test inbox — both deliberate substitutions so the project runs with
zero external accounts.
