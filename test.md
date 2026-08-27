# Testing the matchmaking API in Postman

Matches happen between two users, so you need two logged-in accounts open
side by side — easiest way is two Postman tabs, or two entries in one
request with different `Authorization` headers.

## Setup

Create these variables (Postman environment, or just substitute by hand):

| Variable | Value |
|---|---|
| `baseUrl` | `http://localhost:<PORT>/api` |
| `tokenA` | access token for test user A |
| `tokenB` | access token for test user B |
| `matchId` | filled in once a match is found (step 4) |
| `conversationId` | filled in once both accept (step 6) |

Get `tokenA`/`tokenB` from your existing login endpoint:

```
POST {{baseUrl}}/auth/login
Content-Type: application/json

{ "email": "test-a@example.com", "password": "..." }
```
→ copy `accessToken` from the response into `tokenA`. Repeat for B.

All matchmaking requests below need `Authorization: Bearer {{tokenA}}` (or
`tokenB`) — nothing else in the header, no body unless noted.

## 1. A joins the queue

```
POST {{baseUrl}}/matchmaking/queue
Authorization: Bearer {{tokenA}}
```
Expect `200` with a queue row, `status: "searching"`.

## 2. Check A's status — no match yet

```
GET {{baseUrl}}/matchmaking/status
Authorization: Bearer {{tokenA}}
```
Expect `activeMatch: null`.

## 3. B joins the queue — this should trigger a match

```
POST {{baseUrl}}/matchmaking/queue
Authorization: Bearer {{tokenB}}
```
Expect `200`.

## 4. Check B's status — grab the matchId

```
GET {{baseUrl}}/matchmaking/status
Authorization: Bearer {{tokenB}}
```
Expect `activeMatch.status: "pending"`. Copy `activeMatch.id` into `matchId`.

## 5. A accepts

```
POST {{baseUrl}}/matchmaking/{{matchId}}/accept
Authorization: Bearer {{tokenA}}
```
Expect `200`, `status` still `"pending"` (waiting on B).

## 6. B accepts — room gets created

```
POST {{baseUrl}}/matchmaking/{{matchId}}/accept
Authorization: Bearer {{tokenB}}
```
Expect `status: "chatting"` and a non-null `conversation_id`. Copy it into
`conversationId`.

## 7. Confirm the chat room (manual step)

Using your **existing** message-send endpoint (not part of this feature),
POST 3 messages to `conversationId`, alternating sender: A → B → A.

Then repeat step 2 (`GET /matchmaking/status` for A) — `activeMatch.status`
should now read `"confirmed"`.

## 8. End the match

```
POST {{baseUrl}}/matchmaking/{{matchId}}/end
Authorization: Bearer {{tokenA}}
```
Expect `status: "ended"`.

## 9. Leave the queue (only valid while still just "searching")

```
DELETE {{baseUrl}}/matchmaking/queue
Authorization: Bearer {{tokenA}}
```
Expect `204`.

## Error cases worth checking

| Request | Expected |
|---|---|
| `POST /matchmaking/queue` while already matched | `409` |
| `POST /matchmaking/{{matchId}}/accept` on a match not `pending` | `409` |
| `POST /matchmaking/{{matchId}}/accept` with a random/fake UUID | `404` |
| `POST /matchmaking/{{matchId}}/accept` as a user not in that match | `403` |
| `POST /matchmaking/{{matchId}}/accept` past `accept_expires_at` | `410` |

## Two gotchas

**Pair exclusion is permanent.** Once A and B have any match row between
them — declined, timed out, expired, whatever — they can never be paired
again. Re-running this whole flow with the same two accounts a second
time won't find a match. Either rotate through a handful of test
accounts, or reset between runs:
```sql
TRUNCATE public.matches, public.matchmaking_queue;
```

**Timers make timeout testing slow.** To exercise `timed_out`/`expired`
without waiting 30–60 real seconds, temporarily shrink
`ACCEPT_TIMEOUT_MS`/`CHAT_FIRST_MESSAGE_TIMEOUT_MS` in
`app/services/matchmaking.service.ts`, and the matching
`interval '30 seconds'`/`interval '60 seconds'` in the SQL functions —
put both back before shipping.

Sockets aren't covered here — polling `GET /status` after each step
verifies every state transition without needing a WebSocket client.