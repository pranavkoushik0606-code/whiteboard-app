# Data model

Seven Mongoose models, all in `server/src/models/`. All use `{ timestamps: true }`
(`createdAt` / `updatedAt`).

## Relationship overview

```
User ──owns──> Board ──has many──> CanvasObject
 │               │
 │               ├──has many──> Version   (full-canvas snapshots)
 │               ├──has many──> Comment   (self-referencing via parentComment)
 │               └──has many──> BoardMember ──> User   (role: owner|editor|viewer)
 │
 └──has many──> Notification
```

## User

| Field | Type | Notes |
|---|---|---|
| `name` | String | required, trimmed, max 60 |
| `email` | String | required, unique, lowercased, trimmed |
| `password` | String | required, min 6, `select: false` — bcrypt-hashed in a `pre('save')` hook when modified |
| `avatarUrl` | String | default `''` |
| `color` | String | random from a 7-colour palette at creation; drives live cursor + avatar |
| `theme` | `'light' \| 'dark'` | default `light` |
| `resetPasswordToken` | String | `select: false`; stores the **sha256 hash** of the emailed token |
| `resetPasswordExpires` | Date | `select: false`; 1 hour after issue |

Methods: `comparePassword(candidate)` → bcrypt compare; `toSafeObject()` → `{ id, name,
email, avatarUrl, color, theme, createdAt }`, the only shape ever returned to a client.

## Board

| Field | Type | Notes |
|---|---|---|
| `title` | String | required, trimmed, default `'Untitled Board'` |
| `owner` | ObjectId → User | required |
| `thumbnail` | String | default `''` — **stored but never written by any code path** |
| `background` | String | default `'#FFFFFF'` |
| `gridEnabled` | Boolean | default `true` — persisted, but the editor drives the grid from client-only `useCanvasStore.gridVisible` |
| `privacy` | `'private' \| 'public' \| 'link'` | default `private` — **stored but not enforced anywhere** |
| `isFavorite` | Boolean | default `false` (a per-board flag, not per-user) |
| `lastOpenedAt` | Date | bumped on every `GET /api/boards/:boardId`; drives dashboard sort |

Index: `{ owner: 1, title: 'text' }`.

## BoardMember

Join table for sharing.

| Field | Type | Notes |
|---|---|---|
| `board` | ObjectId → Board | required |
| `user` | ObjectId → User | required |
| `role` | `'owner' \| 'editor' \| 'viewer'` | default `editor` |

Unique compound index `{ board: 1, user: 1 }` — one membership per user per board, which
is what makes the invite endpoint's `upsert` safe.

## CanvasObject

One document per Fabric.js object on a board.

| Field | Type | Notes |
|---|---|---|
| `board` | ObjectId → Board | required, indexed |
| `objectId` | String | required — client-generated uuid v4, stable across updates |
| `type` | String | Fabric type: `rect`, `circle`, `triangle`, `path`, `textbox`, `group`, `polygon`, `line`, … |
| `data` | Mixed | required — raw Fabric JSON (`obj.toObject(['objectId'])`) |
| `zIndex` | Number | default 0; written by the bulk auto-save (array index) and `object:reorder` |
| `locked` | Boolean | default `false` — **stored but no code reads it** |
| `createdBy` | ObjectId → User | |

Unique compound index `{ board: 1, objectId: 1 }`. Rehydration is
`fabric.util.enlivenObjects([doc.data])` client-side.

## Comment

| Field | Type | Notes |
|---|---|---|
| `board` | ObjectId → Board | required, indexed |
| `author` | ObjectId → User | required |
| `text` | String | required, trimmed |
| `x`, `y` | Number | canvas coords the comment is pinned to — the UI currently always posts `0,0` |
| `mentions` | [ObjectId → User] | fans out `mention` notifications on create |
| `resolved` | Boolean | default `false` |
| `parentComment` | ObjectId → Comment | default `null` — threading is modelled but not rendered |

## Version

| Field | Type | Notes |
|---|---|---|
| `board` | ObjectId → Board | required, indexed |
| `snapshot` | Mixed | required — full Fabric canvas export; restore reads `snapshot.objects` |
| `label` | String | default `''`; the UI shows `'Auto-save'` when empty |
| `createdBy` | ObjectId → User | |

`createVersion` trims the collection to the 50 most recent per board after each insert.
`listVersions` excludes `snapshot` (`.select('-snapshot')`) so the timeline stays light.

## Notification

| Field | Type | Notes |
|---|---|---|
| `user` | ObjectId → User | required, indexed — the recipient |
| `type` | `'mention' \| 'comment' \| 'invite' \| 'board-shared'` | required |
| `message` | String | required, pre-rendered text |
| `board` | ObjectId → Board | |
| `read` | Boolean | default `false` |

Written by `inviteMember` (`board-shared`) and `addComment` (`mention`). The API to read
them exists; **no client UI consumes it.**

## Cascade behaviour

`DELETE /api/boards/:boardId` deletes the Board plus its BoardMembers, CanvasObjects,
Versions and Comments in a `Promise.all`. Nothing else cascades — deleting a *user* leaves
their boards and comments orphaned (there is no delete-user endpoint).
