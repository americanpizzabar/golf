# Database: Neon (Postgres)

The app moved off Supabase. Data, the `/sync` signaling relay, and (optionally)
the `/sync` clip relay are now served by:

| Concern                         | Backend                          |
| ------------------------------- | -------------------------------- |
| App data (swings, profile, …)   | **Neon Postgres** via `/api/db`  |
| `/sync` control + WebRTC signal | **Neon** via `/api/sync` (poll)  |
| `/sync` clip fallback           | **Vercel Blob** via `/api/relay` |

The browser never connects to the database directly — every query goes through
a server-side API route. There is no Row Level Security; rows are scoped by the
client-supplied `device_id`, the same login-free model as before.

## One-time setup on Vercel

1. **Connect Neon** to the `golf` project:
   Vercel → Project → **Storage** → **Create / Connect** → **Neon** (Postgres).
   This provisions the database and injects `DATABASE_URL` automatically.

2. **Create the schema**: open the Neon **SQL Editor** (or use psql) and run the
   contents of [`neon/schema.sql`](./schema.sql). It is idempotent and also seeds
   the `pros` reference rows.

   ```bash
   psql "$DATABASE_URL" -f neon/schema.sql
   ```

3. **Connect Vercel Blob** (only needed for the `/sync` clip fallback):
   Vercel → Project → **Storage** → **Create** → **Blob**.
   This injects `BLOB_READ_WRITE_TOKEN` automatically.

4. **Redeploy** so the new environment variables take effect.

## Local development

Copy the values into `.env.local`:

```
DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

Without `DATABASE_URL` the app still builds and runs; data calls just fail
gracefully (empty results) until it is set.

## Optional: TURN

See `.env.example` for `NEXT_PUBLIC_TURN_*`. With a TURN relay, the `/sync` data
channel can traverse strict NAT and clips stay on the fast P2P path instead of
the Blob relay.
