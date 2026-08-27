# Connect Backend to Supabase

Your Express API talks to the **same Supabase project** as your web app.

## Architecture

```
AFFP2 (React)  ──HTTP──►  BACKEND (Express)  ──►  Supabase
                              │
                              ├── supabase-js (REST + Auth + Storage + RPC)
                              └── pg pool (optional raw SQL via DATABASE_URL)
```

- **Web frontend** → calls `http://localhost:3001/api` (never holds service role key)
- **Backend** → uses **Service Role** key to read/write database and bypass RLS when needed

---

## Step 1: Get keys from Supabase Dashboard

1. Open [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Select project: `bbktizewwzdgohkvvzxs`
3. Go to **Project Settings → API**
4. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon / publishable key** → `SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` ⚠️ **Server only — never put in React**

## Step 2: Create `BACKEND/.env`

Copy `.env.example` to `.env` and fill in values:

```env
PORT=3001
WEB_URL=http://localhost:5173

SUPABASE_URL=https://bbktizewwzdgohkvvzxs.supabase.co
SUPABASE_ANON_KEY=your-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Optional — for raw SQL in models/
DATABASE_URL=postgresql://postgres.[ref]:[password]@...pooler.supabase.com:6543/postgres
```

**DATABASE_URL** (optional): Project Settings → **Database** → **Connection string** → **URI** → use **Transaction pooler** for Node.js.

## Step 3: Run database schema

If tables don't exist yet, run in Supabase **SQL Editor**:

```
AFFP2/supabase/schema.sql
```

## Step 4: Start backend

```powershell
cd BACKEND
npm run dev
```

Test:

- `GET http://localhost:3001/api/health`
- `GET http://localhost:3001/api/health/supabase` → should return `{ ok: true, profilesCount: ... }`

## Step 5: Point web app to backend

In `AFFP2/.env`:

```env
VITE_API_BASE_URL=http://localhost:3001/api
```

---

## Which Supabase client to use?

| Client | File | When to use |
|--------|------|-------------|
| `supabaseAdmin` | `src/config/supabase.ts` | Profiles, messages, RPC (`accept_connection`), storage upload |
| `supabasePublic` | `src/config/supabase.ts` | Login/register flows mirroring Supabase Auth |
| `query()` | `src/config/database.ts` | Complex SQL from `BACKEND_API_ROUTES.md` |

### Example: read profiles (admin client)

```typescript
import { supabaseAdmin } from '../config/supabase';

const { data, error } = await supabaseAdmin
  .from('profiles')
  .select('*')
  .eq('id', userId)
  .single();
```

### Example: call existing Supabase RPC

```typescript
const { data, error } = await supabaseAdmin.rpc('accept_connection', {
  requester_id: requesterId,
});
```

### Example: raw SQL (optional)

```typescript
import { query } from '../config/database';

const rows = await query(
  'SELECT * FROM profiles WHERE id = $1',
  [userId]
);
```

---

## Security checklist

- [ ] `SUPABASE_SERVICE_ROLE_KEY` only in `BACKEND/.env`
- [ ] `.env` is in `.gitignore`
- [ ] Never commit service role key to GitHub
- [ ] CORS `WEB_URL` matches your Vite dev URL (`http://localhost:5173`)
