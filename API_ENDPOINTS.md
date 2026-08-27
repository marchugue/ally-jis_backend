# Backend API Endpoints

Base path: `/api`

---

## Health Endpoints

### GET `/api/health`
Returns API health metadata.

Example response:
```json
{
  "ok": true,
  "service": "ally-jis-api",
  "supabaseUrl": "https://..." 
}
```

### GET `/api/health/supabase`
Returns Supabase connectivity status.

Example response:
```json
{
  "ok": true,
  "connection": "supabase-js",
  "profilesCount": 123
}
```

### GET `/api/health/database`
Returns direct PostgreSQL connection status.

Example response (when DATABASE_URL is configured):
```json
{
  "ok": true,
  "connection": "pg"
}
```

Example response (when DATABASE_URL is missing):
```json
{
  "ok": false,
  "connection": "pg",
  "message": "DATABASE_URL not configured (optional). Supabase JS client still works."
}
```

---

## Authentication Endpoints

### POST `/api/auth/register`
Registers a new user and returns an auth session.

Example response:
```json
{
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "user_metadata": {},
    "app_metadata": {},
    "aud": "authenticated",
    "created_at": "2026-07-05T00:00:00Z"
  },
  "accessToken": "access-token",
  "refreshToken": "refresh-token",
  "expiresAt": 1710000000
}
```

### POST `/api/auth/login`
Logs in a user and returns an auth session.

Example response:
```json
{
  "user": {
    "id": "user-id",
    "email": "user@example.com"
  },
  "accessToken": "access-token",
  "refreshToken": "refresh-token",
  "expiresAt": 1710000000
}
```

### POST `/api/auth/logout`
Logs out the current session.

Example response: HTTP 204 No Content

### GET `/api/auth/session`
Returns the current authenticated session.

Example response:
```json
{
  "user": {
    "id": "user-id",
    "email": "user@example.com"
  },
  "accessToken": "access-token",
  "refreshToken": "refresh-token",
  "expiresAt": 1710000000
}
```

### POST `/api/auth/forgot-password`
Sends a password reset request.

Example response: HTTP 204 No Content

### POST `/api/auth/reset-password`
Resets a password using a reset token.

Example response: HTTP 204 No Content

### GET `/api/auth/email/:id`
Returns email verification status for an email id.

Example response:
```json
{
  "email": "user@example.com",
  "isEmailVerified": true,
  "emailConfirmedAt": "2026-07-05T00:00:00Z"
}
```

### POST `/api/auth/confirm`
Confirms email using a Supabase token hash and returns a session.

Example response:
```json
{
  "user": {
    "id": "user-id",
    "email": "user@example.com"
  },
  "accessToken": "access-token",
  "refreshToken": "refresh-token",
  "expiresAt": 1710000000
}
```

---

## Lookup Endpoints

### GET `/api/lookups`
Public endpoint that returns organization, department, course, and interest lookups.

Example response:
```json
{
  "organizations": [
    { "name": "Org A", "sort_order": 10 },
    { "name": "Org B", "sort_order": 20 }
  ],
  "departments": [
    { "id": "dept-1", "name": "Department A", "sort_order": 10 }
  ],
  "courses": [
    { "name": "Course A", "department_id": "dept-1", "sort_order": 10 }
  ],
  "interests": [
    { "name": "Interest A", "category": "Category A", "color": "#FF0000", "sort_order": 10 }
  ]
}
```

---

## Profile Endpoints

### GET `/api/profiles/me`
Returns the authenticated user's profile.

Example response:
```json
{
  "id": "user-id",
  "email": "user@example.com",
  "full_name": "Jane Doe",
  "username": "janedoe",
  "avatar_url": "https://...",
  "bio": "Bio text",
  "department": "Computer Science",
  "course": "CS101",
  "year_level": "3",
  "interests": ["music", "art"],
  "organizations": ["Org A"],
  "created_at": "2026-07-05T00:00:00Z"
}
```

### PATCH `/api/profiles/me`
Updates the authenticated user's profile and returns the updated profile.

Example response: same shape as GET `/api/profiles/me`

### DELETE `/api/profiles/me`
Deletes the authenticated user's profile.

Example response: HTTP 204 No Content

### POST `/api/profiles/batch`
Returns profiles for a list of IDs.

Example request body:
```json
{ "ids": ["user-id-1", "user-id-2"] }
```

Example response:
```json
[
  {
    "id": "user-id-1",
    "email": "user1@example.com",
    "full_name": "User One"
  },
  {
    "id": "user-id-2",
    "email": "user2@example.com",
    "full_name": "User Two"
  }
]
```

### GET `/api/profiles/check-username?username=x&excludeId=y`
Checks whether a username is available.

Example response:
```json
{ "available": true }
```

### GET `/api/profiles`
Lists profiles, optionally excluding one user.

Example response:
```json
[
  {
    "id": "user-id-1",
    "username": "userone",
    "full_name": "User One"
  },
  {
    "id": "user-id-2",
    "username": "usertwo",
    "full_name": "User Two"
  }
]
```

### GET `/api/profiles/:userId`
Returns a profile by user ID.

Example response: same shape as GET `/api/profiles/me`

---

## Interaction Endpoints

### GET `/api/interactions`
Lists interactions for the authenticated user.

Example response:
```json
[
  {
    "user_id": "user-id",
    "target_user_id": "target-id",
    "status": "pending",
    "accepted_at": null
  }
]
```

### POST `/api/interactions/incoming`
Returns incoming interactions for the authenticated user.

Example request body:
```json
{ "requesterIds": ["requester-id"] }
```

Example response:
```json
[
  {
    "user_id": "requester-id",
    "target_user_id": "user-id",
    "status": "pending",
    "accepted_at": null
  }
]
```

### POST `/api/interactions/request`
Requests a connection with another user.

Example request body:
```json
{ "targetUserId": "target-id" }
```

Example response: HTTP 204 No Content

### POST `/api/interactions/accept`
Accepts an incoming connection request.

Example request body:
```json
{ "requesterId": "requester-id" }
```

Example response:
```json
{ "conversationId": "conversation-id" }
```

### POST `/api/interactions/reject`
Rejects a connection request.

Example request body:
```json
{ "targetUserId": "target-id" }
```

Example response: HTTP 204 No Content

### GET `/api/interactions/status/:targetUserId`
Returns the connection status with another user.

Example response:
```json
{ "status": "pending" }
```

---

## Conversation Endpoints

### GET `/api/conversations/memberships/me`
Returns the authenticated user's conversation memberships.

Example response:
```json
[
  {
    "conversation_id": "conversation-id",
    "last_read_at": "2026-07-05T00:00:00Z",
    "icebreakers_enabled": true,
    "profiles": [
      {
        "id": "user-id",
        "full_name": "Jane Doe",
        "username": "janedoe"
      }
    ]
  }
]
```

### GET `/api/conversations/with-user/:otherUserId`
Gets or creates a conversation with a given user.

Example response:
```json
{ "conversationId": "conversation-id" }
```

### GET `/api/conversations`
Lists conversations for the authenticated user.

Example response:
```json
[
  {
    "id": "conversation-id",
    "updated_at": "2026-07-05T00:00:00Z",
    "messages": [],
    "conversation_members": [],
    "blockStatus": "none"
  }
]
```

### POST `/api/conversations`
Creates or returns a conversation for a target user.

Example request body:
```json
{ "targetUserId": "target-id" }
```

Example response:
```json
{
  "conversationId": "conversation-id"
}
```

### GET `/api/conversations/:id`
Returns a conversation by ID.

Example response: same shape as GET `/api/conversations`

### PATCH `/api/conversations/:id/read`
Marks a conversation as read.

Example request body:
```json
{ "readAt": "2026-07-05T00:00:00Z" }
```

Example response: HTTP 204 No Content

### GET `/api/conversations/:id/messages`
Lists messages in a conversation.

Example response:
```json
[
  {
    "id": "message-id",
    "conversation_id": "conversation-id",
    "sender_id": "user-id",
    "content": "Hello",
    "image_url": null,
    "created_at": "2026-07-05T00:00:00Z",
    "reply_to_message_id": null,
    "replied_message": null,
    "reactions": []
  }
]
```

### POST `/api/conversations/:id/messages`
Sends a message in a conversation.

Example request body:
```json
{ "content": "Hello", "imageUrl": null, "replyToMessageId": null }
```

Example response:
```json
{
  "id": "message-id",
  "conversation_id": "conversation-id",
  "sender_id": "user-id",
  "content": "Hello",
  "image_url": null,
  "created_at": "2026-07-05T00:00:00Z",
  "reply_to_message_id": null,
  "replied_message": null,
  "reactions": []
}
```

### PUT `/api/conversations/:id/messages/:messageId/reactions`
Sets a reaction on a conversation message.

Example request body:
```json
{ "emoji": "👍" }
```

Example response:
```json
[
  {
    "message_id": "message-id",
    "user_id": "user-id",
    "emoji": "👍"
  }
]
```

### PATCH `/api/conversations/:id/icebreakers`
Enables or disables icebreakers for a conversation.

Example request body:
```json
{ "enabled": true }
```

Example response: HTTP 204 No Content

### GET `/api/conversations/:id/icebreakers`
Returns icebreaker setting for a conversation.

Example response:
```json
{ "data": true }
```

---

## Notification Endpoints

### GET `/api/notifications/friend-requests`
Lists friend request notifications.

Example response:
```json
[
  {
    "id": "notification-id",
    "type": "friend_request",
    "message": "..."
  }
]
```

### PATCH `/api/notifications/read-all`
Marks all notifications as read.

Example response: HTTP 204 No Content

### GET `/api/notifications`
Lists notifications.

Example response:
```json
[
  {
    "id": "notification-id",
    "type": "message",
    "message": "..."
  }
]
```

### PATCH `/api/notifications/:id/read`
Marks a notification as read.

Example response: HTTP 204 No Content

### DELETE `/api/notifications`
Clears all notifications.

Example response: HTTP 204 No Content

---

## Media Endpoints

### POST `/api/media/chat`
Uploads a single chat file. Use multipart/form-data field `file`.

Example response:
```json
{ "url": "https://.../chat-file.png" }
```

### POST `/api/media/posts`
Uploads up to 4 post files. Use multipart/form-data field `files`.

Example response:
```json
{ "urls": ["https://.../post-file-1.png", "https://.../post-file-2.png"] }
```

---

## Moderation Endpoints

### POST `/api/moderation/block`
Blocks a user.

Example request body:
```json
{ "blockedUserId": "target-id" }
```

Example response:
```json
{
  "blockedUserId": "target-id",
  "blockedBy": "user-id",
  "created_at": "2026-07-05T00:00:00Z"
}
```

### POST `/api/moderation/report`
Reports a user.

Example request body:
```json
{
  "targetUserId": "target-id",
  "reason": "Harassment"
}
```

Example response:
```json
{
  "id": "report-id",
  "reporter_id": "user-id",
  "target_user_id": "target-id",
  "reason": "Harassment",
  "created_at": "2026-07-05T00:00:00Z"
}
```

### GET `/api/moderation/blocked/:userId`
Checks whether the authenticated user has blocked a specific user.

Example response:
```json
{ "blocked": true }
```

### DELETE `/api/moderation/block/:userId`
Unblocks a user.

Example response:
```json
{
  "blockedUserId": "target-id",
  "unblocked": true
}
```

### GET `/api/moderation/blocked`
Lists blocked users.

Example response:
```json
[
  {
    "blockedUserId": "target-id",
    "blockedAt": "2026-07-05T00:00:00Z"
  }
]
```

---

## Presence Endpoints

### POST `/api/presence/heartbeat`
Sends a heartbeat for the authenticated user.

Example response: HTTP 204 No Content

### GET `/api/presence/online`
Returns online presence status.

Example response:
```json
{
  "online": [
    { "user_id": "user-id", "last_seen": "2026-07-05T00:00:00Z" }
  ]
}
```

---

## Feed Endpoints

### GET `/api/feed`
Lists feed posts.

Example response:
```json
[
  {
    "id": "post-id",
    "author_id": "user-id",
    "content": "Post text",
    "audience": "public",
    "likes_count": 10,
    "comments_count": 5,
    "created_at": "2026-07-05T00:00:00Z",
    "updated_at": "2026-07-05T00:00:00Z",
    "author": {
      "id": "user-id",
      "username": "janedoe",
      "full_name": "Jane Doe",
      "avatar_url": "https://..."
    },
    "liked_by_me": false,
    "media": []
  }
]
```

### GET `/api/feed/users/:userId`
Lists posts by a specific author.

Example response: same shape as GET `/api/feed`

### POST `/api/feed/posts`
Creates a feed post.

Example request body:
```json
{
  "content": "Hello world",
  "audience": "public",
  "mediaUrls": ["https://.../image.png"]
}
```

Example response: same shape as a single feed post from GET `/api/feed`

### GET `/api/feed/posts/:postId`
Gets a feed post by ID.

Example response: same shape as a single feed post

### PATCH `/api/feed/posts/:postId`
Updates a feed post.

Example request body:
```json
{ "content": "Updated text", "audience": "connections" }
```

Example response: same shape as a single feed post

### DELETE `/api/feed/posts/:postId`
Deletes a feed post.

Example response: HTTP 204 No Content

### POST `/api/feed/posts/:postId/like`
Likes a post.

Example response:
```json
{ "liked": true, "likesCount": 11 }
```

### DELETE `/api/feed/posts/:postId/like`
Unlikes a post.

Example response:
```json
{ "liked": false, "likesCount": 10 }
```

### GET `/api/feed/posts/:postId/comments`
Lists comments for a post.

Example response:
```json
[
  {
    "id": "comment-id",
    "post_id": "post-id",
    "author_id": "user-id",
    "parent_comment_id": null,
    "content": "Nice post",
    "likes_count": 2,
    "created_at": "2026-07-05T00:00:00Z",
    "updated_at": "2026-07-05T00:00:00Z",
    "author": {
      "id": "user-id",
      "username": "janedoe",
      "full_name": "Jane Doe",
      "avatar_url": "https://..."
    },
    "liked_by_me": false
  }
]
```

### POST `/api/feed/posts/:postId/comments`
Creates a comment on a post.

Example request body:
```json
{ "content": "Nice post", "parentCommentId": null }
```

Example response: same shape as a single comment from GET `/api/feed/posts/:postId/comments`

### PATCH `/api/feed/comments/:commentId`
Updates a comment.

Example request body:
```json
{ "content": "Updated comment" }
```

Example response: same shape as a single comment

### DELETE `/api/feed/comments/:commentId`
Deletes a comment.

Example response: HTTP 204 No Content

### POST `/api/feed/comments/:commentId/like`
Likes a comment.

Example response:
```json
{ "liked": true, "likesCount": 3 }
```

### DELETE `/api/feed/comments/:commentId/like`
Unlikes a comment.

Example response:
```json
{ "liked": false, "likesCount": 2 }
```
