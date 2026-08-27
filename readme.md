# ⚡ Ally-jis Backend API

A high-performance **Node.js + Express + TypeScript** REST & WebSocket backend powering the **Ally-jis** platform. Built with a clean **MVC (Model-View-Controller / Service)** architecture, integrating **Supabase** (Auth & Database), **Socket.IO** (Realtime WebSockets), and **Cloudflare R2** (Media Storage).

---

## 📌 Overview & Architecture

The Ally-jis API connects the React/TypeScript frontend with backend services and storage layers.

```
┌─────────────────────────────────────────────────────────────┐
│                   React / Vite Frontend                     │
└──────────────┬──────────────────────────────┬───────────────┘
               │ HTTP REST                    │ Socket.IO
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Ally-jis Express Server                     │
│   (TypeScript MVC: Routes ➔ Controllers ➔ Services ➔ Models)│
└──────┬──────────────────────┬───────────────────────┬───────┘
       │                      │                       │
       ▼                      ▼                       ▼
┌──────────────┐      ┌───────────────┐      ┌────────────────┐
│   Supabase   │      │ PostgreSQL DB │      │ Cloudflare R2  │
│ Auth & Admin │      │ (pg Pool /    │      │ S3 Media &     │
│ Service API  │      │ Migrations)   │      │ Preset Avatars │
└──────────────┘      └───────────────┘      └────────────────┘
```

### Layer Responsibility Summary
- **Routes (`src/routes/`)**: Map API endpoints, attach auth & validation middlewares, delegate requests to controllers.
- **Controllers (`src/app/controller/`)**: Parse HTTP inputs, set HTTP status codes, and return clean JSON responses.
- **Services (`src/app/services/`)**: Business logic, multi-table transactions, realtime socket event triggers, and matchmaking timers.
- **Models (`src/app/models/`)**: Database query abstractions using the Supabase Admin Client & raw PostgreSQL queries.
- **Sockets (`src/sockets/`)**: Socket.IO event handlers for live chat messages, typing indicators, presence, and realtime notifications.
- **Config (`src/config/`)**: Environment validation (`env.ts`), Supabase client initialization (`supabase.ts`), Cloudflare R2 setup (`r2.ts`), and CORS policies.

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** (v18 or higher)
- **npm** or **pnpm**
- A **Supabase** project (Auth & PostgreSQL database)
- *(Optional)* **Cloudflare R2** bucket for media file storage

### 2. Installation
```bash
# Clone repository
git clone https://github.com/marchugue/ally-jis_backend.git
cd ally-jis_backend

# Install dependencies
npm install
```

### 3. Environment Configuration
Copy `backend.env.example` to `.env`:
```bash
cp backend.env.example .env
```

Configure your `.env` variables:
```env
# Server Configuration
PORT=3001
WEB_URL=http://localhost:5173

# Supabase Credentials (Project Settings → API)
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_ANON_KEY=<your-anon-publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
PASSWORD_RESET_REDIRECT_URL=http://localhost:5173/forgot-password

# Optional Direct PostgreSQL Connection
DATABASE_URL=postgresql://postgres:[password]@[host]:6543/postgres

# Cloudflare R2 Media Storage (Optional - falls back to Supabase Storage if blank)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=ally-jis-media
R2_PUBLIC_DOMAIN=https://pub-xxxxxxxx.r2.dev
```

### 4. Database Migrations
SQL migration scripts reside in `supabase/migrations/`. Execute migrations in sequential order against your Supabase database via the **Supabase SQL Editor** or direct DB connection:

| Migration File | Description |
|---|---|
| `003_matchmaking_identity.sql` | Blind matchmaking & anonymous alias assignment |
| `004_matchmaking_progression.sql` | Match progression stages & interaction levels |
| `005_matchmaking_reveal_link.sql` | Mutual identity reveal mechanisms |
| `006_follows.sql` | User follow and unfollow system |
| `007_admin_rbac.sql` | Role-Based Access Control (Admin / Moderator / User) |
| `008_admin_user_management.sql` | User status management, suspensions & bans |
| `009_admin_reports.sql` | User reporting system & report resolution |
| `010_conversation_hide.sql` | User-scoped conversation hiding & archiving |
| `011_admin_settings.sql` | System-wide settings & Maintenance mode flag |
| `012_deletion_engine.sql` | Message & conversation soft/hard deletion engine |
| `preset_avatars_migration.sql` | Preset avatar catalog management |

### 5. Running the Application
```bash
# Start Development Server (with hot-reloading via nodemon & ts-node)
npm run dev

# Build Production Output
npm run build

# Start Production Server
npm start
```

---

## 🛠️ Core Features

| Feature | Description | Key Modules |
|---|---|---|
| **Auth & RBAC** | Supabase Auth integration, session token verification, role-based access control (Admin, Moderator, User). | `auth.routes.ts`, `admin.middleware.ts` |
| **Blind Matchmaking** | Anonymous matching system with progressive identity reveals based on interaction levels. | `matchmaking.service.ts`, `matchTimers.ts` |
| **Realtime Chat & Sockets** | Socket.IO engine powering live messaging, typing indicators, read receipts, and presence updates. | `sockets/index.ts`, `realtime.service.ts` |
| **Media Storage System** | Cloudflare R2 S3 storage driver with seamless fallback to Supabase Storage for photo/video uploads. | `r2.ts`, `media.service.ts` |
| **Social & Activity Feed** | Follow system, post feed, likes, comments, and connection request workflows. | `feed.service.ts`, `follow.service.ts` |
| **Deletion Engine** | Granular message deletion ("delete for me" vs "delete for everyone") and conversation archiving. | `conversation.service.ts` |
| **Admin Dashboard** | Admin APIs for user moderation, system settings, report resolution, and avatar catalog management. | `admin.controller.ts`, `adminUsers.service.ts` |

---

## 📂 Project Directory Structure

```
ally-jis_backend/
├── src/
│   ├── server.ts                    # Entry point: HTTP & Socket.IO server initialization
│   ├── app.ts                       # Express app setup, middlewares & router mounting
│   │
│   ├── app/                         # Core Application Logic
│   │   ├── constants/               # Permissions, anonymous identities & progression rules
│   │   ├── controller/              # HTTP Request Controllers
│   │   ├── middleware/              # Auth, Maintenance, Error & Admin RBAC middlewares
│   │   ├── models/                  # Database query models (Supabase & pg pool)
│   │   ├── services/                # Business logic, transactions & socket triggers
│   │   ├── types/                   # TypeScript interfaces & type definitions
│   │   └── utils/                   # Async controller wrapper & matchmaking timers
│   │
│   ├── config/                      # System Configurations
│   │   ├── cors.ts                  # CORS configuration options
│   │   ├── database.ts              # Direct PostgreSQL pool driver
│   │   ├── env.ts                   # Environment variable validation & type casting
│   │   ├── r2.ts                    # Cloudflare R2 S3 client initialization
│   │   └── supabase.ts              # Supabase Public & Admin client instances
│   │
│   ├── routes/                      # API Endpoint Declarations
│   │   ├── index.ts                 # Main router mounting sub-routes & maintenance check
│   │   ├── admin.routes.ts          # Admin management & settings endpoints
│   │   ├── auth.routes.ts           # Authentication & session routes
│   │   ├── conversation.routes.ts   # Conversations & messaging endpoints
│   │   ├── feed.routes.ts           # Post feed, comments & likes
│   │   ├── follow.routes.ts         # User follow system endpoints
│   │   ├── health.routes.ts         # System health & Supabase connectivity check
│   │   ├── interaction.routes.ts    # Connection requests & status tracking
│   │   ├── lookup.routes.ts         # Category lookups (organizations, departments, interests)
│   │   ├── matchmaking.routes.ts    # Blind match queue & progression endpoints
│   │   ├── media.routes.ts          # Media upload & preset avatar endpoints
│   │   ├── moderation.routes.ts     # User reporting & block routes
│   │   ├── notification.routes.ts   # Notification status & read endpoints
│   │   ├── presence.routes.ts       # Online presence & heartbeat tracking
│   │   └── profile.routes.ts        # Profile viewing & modification routes
│   │
│   └── sockets/                     # Socket.IO Event Handlers
│       └── index.ts                 # Realtime connections, rooms & message broadcasting
│
├── supabase/
│   └── migrations/                  # Database migration SQL files
│
├── .gitignore                       # Git ignore specification
├── backend.env.example              # Environment variables template
├── package.json                     # Package dependencies & npm scripts
├── tsconfig.json                    # TypeScript configuration
└── readme.md                        # Documentation