# Ally-jis Backend — MVC Architecture Guide

Node.js + Express + PostgreSQL backend for Ally-jis, structured as a classic
**Model–View–Controller** API (no view layer, since the "view" is JSON
returned to the React/TS frontend in `src/api/client.ts`).

This README explains **how to construct the backend**: the folder layout,
what goes in each layer, and how a request flows from route → controller →
service → model → database and back.

---

## 1. The MVC mental model for an API

In a web API there's no HTML view, so "MVC" maps like this:

| Layer | Role | Lives in |
|---|---|---|
| **Routes** | Declare URL + HTTP method, attach middleware, call a controller method. No logic. | `src/routes/` |
| **Controllers** | Read `req`, call services, shape the HTTP response (status code + JSON). No SQL, no business rules. | `src/controllers/` |
| **Services** | Business logic that spans multiple models/tables (e.g. "accept connection" touches `user_interactions`, `conversations`, `notifications`). | `src/services/` |
| **Models** | Talk to PostgreSQL. One file per table. Pure SQL in, rows out. No HTTP knowledge. | `src/models/` |
| **Middleware** | Cross-cutting concerns: auth check, error handling, file upload. | `src/middleware/` |
| **Config** | Env vars, DB pool, constants. | `src/config/` |

**Rule of thumb:** a controller should never write raw SQL, and a model should
never know what `req`/`res` are. If a controller is doing a multi-step
transaction (like `accept connection`), that logic belongs in a **service**,
not the controller.

---

## 2. Folder structure

```
ally-jis-backend/
├── src/
│   ├── server.js                 # Entry point — starts Express, mounts routes
│   ├── app.js                    # Express app config (middleware, CORS, routes)
│   │
│   ├── config/
│   │   ├── db.js                 # pg Pool (the one shared connection pool)
│   │   └── env.js                # Validated env var access
│   │
│   ├── routes/
│   │   ├── index.js              # Combines all routers under /api
│   │   ├── auth.routes.js
│   │   ├── profile.routes.js
│   │   ├── lookup.routes.js
│   │   ├── interaction.routes.js
│   │   ├── conversation.routes.js
│   │   ├── message.routes.js
│   │   ├── notification.routes.js
│   │   ├── media.routes.js
│   │   └── presence.routes.js
│   │
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── profile.controller.js
│   │   ├── lookup.controller.js
│   │   ├── interaction.controller.js
│   │   ├── conversation.controller.js
│   │   ├── message.controller.js
│   │   ├── notification.controller.js
│   │   ├── media.controller.js
│   │   └── presence.controller.js
│   │
│   ├── services/
│   │   ├── auth.service.js       # hashing, JWT issuing
│   │   ├── interaction.service.js# request/accept/reject transaction logic
│   │   ├── conversation.service.js
│   │   └── notification.service.js
│   │
│   ├── models/
│   │   ├── user.model.js         # auth.users equivalent
│   │   ├── profile.model.js
│   │   ├── lookup.model.js       # organizations/departments/courses/interests
│   │   ├── interaction.model.js
│   │   ├── conversation.model.js
│   │   ├── message.model.js
│   │   ├── notification.model.js
│   │   └── presence.model.js
│   │
│   ├── middleware/
│   │   ├── auth.middleware.js    # verifies JWT, sets req.userId
│   │   ├── error.middleware.js   # central error handler → { message }
│   │   └── upload.middleware.js  # multer config for /media/chat
│   │
│   ├── utils/
│   │   ├── asyncHandler.js       # wraps async controllers, forwards errors
│   │   └── jwt.js                # sign/verify helpers
│   │
│   └── db/
│       ├── schema.sql            # full table definitions (source of truth)
│       └── migrate.js            # runs schema.sql against DATABASE_URL
│
├── uploads/
│   └── chat-media/                # static-served uploaded images
│
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## 3. Request flow, end to end

Example: `POST /api/interactions/accept`

```
Client (client.ts)
  │  fetch(`${BASE_URL}/interactions/accept`, { body: { requesterId } })
  ▼
routes/interaction.routes.js
  │  router.post('/accept', authMiddleware, interactionController.accept)
  ▼
middleware/auth.middleware.js
  │  verifies Bearer JWT → sets req.userId = <uuid>
  ▼
controllers/interaction.controller.js
  │  async accept(req, res) {
  │    const { requesterId } = req.body;
  │    const result = await interactionService.acceptConnection(req.userId, requesterId);
  │    res.status(200).json(result);
  │  }
  ▼
services/interaction.service.js
  │  acceptConnection(currentUserId, requesterId) {
  │    // BEGIN transaction
  │    // 1. update interaction row -> accepted
  │    // 2. upsert reverse row
  │    // 3. find or create shared conversation
  │    // 4. insert notification
  │    // COMMIT
  │    return { conversationId };
  │  }
  │  → calls interactionModel + conversationModel + notificationModel
  ▼
models/interaction.model.js, conversation.model.js, notification.model.js
  │  raw parameterized SQL via the shared pg Pool
  ▼
PostgreSQL
```

Each layer only knows about the layer directly below it. The controller
never sees SQL; the model never sees `req`/`res`.

---

## 4. Layer-by-layer construction

### 4.1 `config/db.js` — one shared pool

```js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

module.exports = pool;
```

Every model imports this same pool. Never create a new `Pool` per file.

### 4.2 Models — SQL only, return plain rows

```js
// models/profile.model.js
const pool = require('../config/db');

async function findById(id) {
  const { rows } = await pool.query(
    `SELECT id, email, full_name, username, avatar_url, bio,
            department, course, year_level, interests, organizations, created_at
     FROM profiles WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

module.exports = { findById /*, findMany, update, ... */ };
```

Use **parameterized queries** (`$1`, `$2`, …) — never string-interpolate
request input into SQL.

### 4.3 Services — multi-step / multi-table logic and transactions

```js
// services/interaction.service.js
const pool = require('../config/db');
const notificationModel = require('../models/notification.model');

async function acceptConnection(currentUserId, requesterId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE user_interactions SET status = 'accepted', accepted_at = now()
       WHERE user_id = $1 AND target_user_id = $2`,
      [requesterId, currentUserId]
    );

    await client.query(
      `INSERT INTO user_interactions (user_id, target_user_id, status, accepted_at)
       VALUES ($1, $2, 'accepted', now())
       ON CONFLICT (user_id, target_user_id)
       DO UPDATE SET status = 'accepted', accepted_at = now()`,
      [currentUserId, requesterId]
    );

    let { rows } = await client.query(
      `SELECT m1.conversation_id FROM conversation_members m1
       JOIN conversation_members m2 ON m1.conversation_id = m2.conversation_id
       WHERE m1.user_id = $1 AND m2.user_id = $2 LIMIT 1`,
      [currentUserId, requesterId]
    );

    let conversationId = rows[0]?.conversation_id;

    if (!conversationId) {
      const convResult = await client.query(
        `INSERT INTO conversations (created_at, updated_at) VALUES (now(), now())
         RETURNING id`
      );
      conversationId = convResult.rows[0].id;

      await client.query(
        `INSERT INTO conversation_members (conversation_id, user_id)
         VALUES ($1, $2), ($1, $3)
         ON CONFLICT DO NOTHING`,
        [conversationId, currentUserId, requesterId]
      );
    }

    await client.query(
      `INSERT INTO notifications (user_id, type, title, description, from_user_id)
       VALUES ($1, 'accepted', 'Request Accepted!',
               'Your connection request was accepted. You can now message each other.', $2)`,
      [requesterId, currentUserId]
    );

    await client.query('COMMIT');
    return { conversationId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { acceptConnection };
```

If a route's logic is a single `SELECT`/`INSERT` with no branching, the
controller can call the model directly and you can skip the service for that
route. Reach for a service once there's more than one table involved or a
transaction is needed (accept/reject connection, send message + notify,
register user + profile).

### 4.4 Controllers — thin, HTTP-only

```js
// controllers/interaction.controller.js
const interactionService = require('../services/interaction.service');
const asyncHandler = require('../utils/asyncHandler');

exports.accept = asyncHandler(async (req, res) => {
  const { requesterId } = req.body;
  const result = await interactionService.acceptConnection(req.userId, requesterId);
  res.status(200).json(result);
});

exports.request = asyncHandler(async (req, res) => {
  const { targetUserId } = req.body;
  await interactionService.requestConnection(req.userId, targetUserId);
  res.status(204).send();
});
```

`asyncHandler` is a one-line wrapper so you don't write `try/catch` in every
controller:

```js
// utils/asyncHandler.js
module.exports = (fn) => (req, res, next) => fn(req, res, next).catch(next);
```

### 4.5 Routes — declarative, no logic

```js
// routes/interaction.routes.js
const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const controller = require('../controllers/interaction.controller');

router.get('/', auth, controller.list);
router.post('/incoming', auth, controller.incoming);
router.post('/request', auth, controller.request);
router.post('/accept', auth, controller.accept);
router.post('/reject', auth, controller.reject);
router.get('/status/:targetUserId', auth, controller.status);

module.exports = router;
```

```js
// routes/index.js
const router = require('express').Router();

router.use('/auth', require('./auth.routes'));
router.use('/profiles', require('./profile.routes'));
router.use('/lookups', require('./lookup.routes'));
router.use('/interactions', require('./interaction.routes'));
router.use('/conversations', require('./conversation.routes'));
router.use('/notifications', require('./notification.routes'));
router.use('/media', require('./media.routes'));
router.use('/presence', require('./presence.routes'));

module.exports = router;
```

```js
// app.js
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(express.json());
app.use('/uploads', express.static('uploads')); // serves chat-media publicly
app.use('/api', require('./routes'));
app.use(require('./middleware/error.middleware'));

module.exports = app;
```

```js
// server.js
require('dotenv').config();
const app = require('./app');
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API running on :${PORT}`));
```

### 4.6 Middleware

**Auth** — verifies the JWT issued at login/register, attaches `req.userId`:

```js
// middleware/auth.middleware.js
const jwt = require('jsonwebtoken');

module.exports = function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Missing token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};
```

**Error handler** — every thrown/rejected error in a controller lands here
because of `asyncHandler`:

```js
// middleware/error.middleware.js
module.exports = function errorHandler(err, req, res, next) {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ message: err.message || 'Internal server error' });
};
```

Custom statuses (409 conflict, 404 not found) are thrown from
services/models as `Error` objects with a `.status` property:

```js
const err = new Error('Username already taken');
err.status = 409;
throw err;
```

---

## 5. Route-to-file map (matches the API spec)

| Route | Controller method | Service used? |
|---|---|---|
| `POST /auth/register` | `auth.controller.register` | `auth.service` (hash password, create profile) |
| `POST /auth/login` | `auth.controller.login` | `auth.service` (verify + sign JWT) |
| `GET /auth/session` | `auth.controller.session` | — |
| `GET /profiles/me`, `/:userId` | `profile.controller` | — (model only) |
| `PATCH /profiles/me` | `profile.controller.update` | — (model only, with username check) |
| `GET /lookups` | `lookup.controller.getAll` | — (4 parallel model calls) |
| `POST /interactions/request` | `interaction.controller.request` | `interaction.service` (insert + notify) |
| `POST /interactions/accept` | `interaction.controller.accept` | `interaction.service` (transaction) |
| `POST /conversations` | `conversation.controller.getOrCreate` | `conversation.service` |
| `POST /conversations/:id/messages` | `message.controller.create` | `conversation.service` (insert + bump `updated_at` + notify) |
| `POST /media/chat` | `media.controller.upload` | `upload.middleware` (multer) handles the file |
| `POST /presence/heartbeat` | `presence.controller.heartbeat` | — (model upsert) |

Full per-route detail (request/response shapes, exact SQL) stays in the API
spec doc — this README is about *where code lives*, not re-deriving every
query.

---

## 6. Database setup

`src/db/schema.sql` is the single source of truth for tables. Key ones:

```
profiles, user_interactions, notifications,
conversations, conversation_members, messages,
organizations, departments, courses, interests,
user_presence
```

Run migrations with:

```bash
npm run migrate
```

which just executes `schema.sql` against `DATABASE_URL` via `pg`.

---

## 7. Local setup

```bash
git clone <repo>
cd ally-jis-backend
npm install
cp .env.example .env        # fill in DATABASE_URL, JWT_SECRET, etc.
npm run migrate             # creates tables
npm run dev                 # nodemon, restarts on change
```

`.env`:

```env
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ally_jis
PGSSL=false
JWT_SECRET=replace_with_long_random_string
JWT_EXPIRES_IN=7d
UPLOAD_DIR=uploads/chat-media
PUBLIC_MEDIA_BASE_URL=http://localhost:3001/uploads/chat-media
```

Frontend `.env`:

```env
VITE_API_BASE_URL=http://localhost:3001/api
```

---

## 8. Conventions to keep consistent

- **Auth:** `Authorization: Bearer <accessToken>` on every protected route, checked in `auth.middleware.js`.
- **Errors:** always `{ "message": string }` + correct HTTP status. Never leak raw Postgres errors to the client — catch and rethrow with a clean message in the service layer.
- **No-content responses:** routes documented as returning `void` send `res.status(204).send()` with no body.
- **SQL:** always parameterized (`$1, $2, …`); never template literals with raw user input.
- **UUIDs:** Postgres `gen_random_uuid()` (requires the `pgcrypto` extension) or generate in Node with `uuid` and insert explicitly — pick one and stay consistent across `users`/`profiles`.
- **One table → one model file.** If a query joins multiple tables for a single read (like `GET /conversations`), it can live in the model that "owns" the primary entity (`conversation.model.js`), but multi-table **writes**/transactions belong in a service.

---

## 9. Testing order (smoke test the whole stack)

1. `POST /auth/register` → `POST /auth/login` → `GET /auth/session`
2. `GET /lookups` → `GET /profiles/check-username`
3. `GET /profiles/me` → `PATCH /profiles/me`
4. `GET /profiles?exclude=` → `POST /interactions/request`
5. `GET /notifications/friend-requests` → `POST /interactions/accept`
6. `POST /conversations` → `GET /conversations/:id/messages` → `POST /conversations/:id/messages`
7. `PATCH /conversations/:id/read`
8. `POST /media/chat`
9. `POST /presence/heartbeat` → `GET /presence/online`

This is the same order the full API spec already lists — it doubles as your
integration test script once each piece above is built.