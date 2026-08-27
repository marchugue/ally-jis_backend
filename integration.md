# Matchmaking feature — integration checklist

## 1. Install
```
npm install socket.io
```
No Redis/queue lib needed — accept/chat timeouts use in-memory timers per
your call (single-instance only; see `src/services/matchTimers.ts` header
comment for what that trade-off means and how to upgrade it later).

## 2. Run the migration
`migrations/002_matchmaking.sql` adds two tables (`matchmaking_queue`,
`matches`) and seven Postgres functions. Nothing in your existing schema
is altered — `conversations`/`conversation_members`/`messages` are reused
as-is; `matches.conversation_id` is just a foreign key into them.

Run it against both your local and Neon databases if you're on the
dual-database setup mentioned in earlier work.

## 3. Mount the routes
In your `routes/index.ts`:
```ts
import matchmakingRoutes from '../src/routes/matchmaking.routes';
router.use('/matchmaking', matchmakingRoutes);
```

## 4. Swap your entry point
Replace your root `index.ts` with the one here (or diff it in manually —
the only real change is wrapping `app` in `http.createServer` so
Socket.io can attach, plus the boot-time `reconcileStaleMatches()` call).

## 5. Hook the chat streak into your message send flow
Wherever you currently insert a row into `messages` (your existing
service — I don't have that file, so I couldn't wire this in directly),
add one line right after the insert succeeds:
```ts
import * as matchmakingService from '../services/matchmaking.service';
// ...after messages insert succeeds:
await matchmakingService.recordMatchMessage(conversationId, senderId);
```
This is a no-op for every normal conversation — it only does anything if
the conversation belongs to a live matchmaking room.

## 6. Client socket connection
```ts
const socket = io(SERVER_URL, { auth: { token: accessToken } });
socket.on('matchmaking:match_found', (payload) => { ... });
socket.on('matchmaking:room_ready', (payload) => { ... });
socket.on('matchmaking:streak_update', (payload) => { ... });
socket.on('matchmaking:match_confirmed', (payload) => { ... });
socket.on('matchmaking:chat_expired', (payload) => { ... });
socket.on('matchmaking:match_timed_out', (payload) => { ... });
socket.on('matchmaking:partner_declined', (payload) => { ... });
socket.on('matchmaking:match_ended', (payload) => { ... });
```

## Things I couldn't verify from what you've shared — please check these

- **`authMiddleware` import path** in `src/routes/matchmaking.routes.ts`.
  Your `auth.middleware.ts` imports `../models/auth.model`, which points
  to `src/middleware/auth.middleware.ts`, but `error.middleware.ts` is
  mounted from a separate `app/middleware/` folder — I couldn't tell if
  that's one folder or two. Fix the import to match reality.
- **`req.userId` typing** — assumed you already have a global Express
  `Request` augmentation (used the same way `auth.middleware.ts` does).
- **`profiles.interests` / `.organizations` element type** — the schema
  says `ARRAY` with no declared element type; the SQL assumes `text[]`.
  If these are actually `uuid[]` (referencing `interests.id`/
  `organizations.id`), the `unnest(...) = ANY(...)` comparisons still
  work as long as both sides are the same type — just flag it if your
  Node code passes/stores something different.
- **Compatibility score weights** are a substitution since `age`/
  `gender`/`language`/`country` don't exist on `profiles`: shared
  interest +10 each, same department +15, same course +10, shared org
  +5 each, active in last 5 min +10. Tune freely in
  `find_and_reserve_match`.
- **Timeouts**: accept window 30s, chat first-message window 60s, streak
  target 3 — all constants at the top of `matchmaking.service.ts` (Node)
  and inlined in the SQL functions (Postgres) — keep both in sync if you
  change them.