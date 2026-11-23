# Run ZOS locally in VS Code

The backend runs on **http://localhost:3001** and the frontend on **http://localhost:3000**.

## 1. Install once

- **Node.js 22** (LTS): https://nodejs.org. Check with `node -v`.
- **VS Code**. When you open the folder it suggests the ESLint, Prettier, Prisma and Tailwind extensions; install them.

## 2. Open the project

1. Unzip `zos-local.zip`.
2. In VS Code: **File → Open Folder…** → select the unzipped `zos` folder (the one that contains `backend` and `frontend`).

## 3. Add your settings (one time)

1. Copy `backend/.env.example` to `backend/.env` and fill in:
   - `DATABASE_URL`: easiest is to copy it from Render → your backend service → **Environment**.
   - `JWT_SECRET`: any long random string (or the Render value).
2. Copy `frontend/.env.example` to `frontend/.env.local`. You don't need to change anything in it.

> **Careful:** the local app reads and writes whatever database `DATABASE_URL` points to. If that's production, anything you save locally is real. Use a staging copy if you have one.

## 4. Install packages (one time, and after `package.json` changes)

**Terminal → Run Task… → Install: all**

This runs `npm install` in both folders and `npx prisma generate` in the backend. Prisma generate must run before the backend can start.

Or run it by hand in the VS Code terminal:

```bash
cd backend && npm install && npx prisma generate
cd ../frontend && npm install
```

## 5. Run

**Terminal → Run Build Task…** (or `Ctrl+Shift+B` / `Cmd+Shift+B`) starts **backend + frontend** in two terminals.

Wait for `ZOS BACKEND STARTED` in the backend terminal, then open http://localhost:3000 and log in with your usual ZOS user.

Or run by hand in two terminals:

```bash
# terminal 1
cd backend && npm run start:dev

# terminal 2
cd frontend && npm run dev
```

Swagger (API docs) is at http://localhost:3001/api/docs.

## Log in without a password (mock login)

For local work you can skip real accounts. In `backend/.env`:

```
AUTH_MOCK=true
AUTH_MOCK_ROLE=admin
```

Restart the backend. It prints `MOCK LOGIN IS ON`. Now any username and password logs in with that role. Change `AUTH_MOCK_ROLE` to `manager`, `viewer` or `client` to see the app as that user. For `client`, also set `AUTH_MOCK_PROJECT_ID` (for example `park_heights`).

- Only the password check is skipped. The app still reads and writes the database in `DATABASE_URL`.
- The backend refuses to start if `AUTH_MOCK=true` on Render or with `NODE_ENV=production`, so it can't open the live system by mistake. Still, never add `AUTH_MOCK` to Render's environment.

## 6. Debug with breakpoints

Open **Run and Debug** (`Ctrl+Shift+D`) and pick:

- **Debug: backend**: breakpoints in `backend/src/**`.
- **Debug: frontend (Chrome)**: breakpoints in React code. Start the frontend first.
- **Debug: backend + frontend**: both servers under the debugger.

## 7. Checking speed

- Every API response carries a `Server-Timing` header. In Chrome DevTools → **Network** → click a request → **Timing**, it shows how long the server took.
- Requests slower than 800 ms are printed as `[slow] GET /path 200 1234ms` in the backend terminal. Change the limit with `SLOW_REQUEST_MS` in `backend/.env`.

## Common problems

| Message | Fix |
| --- | --- |
| `DATABASE_URL is missing in .env file` | `backend/.env` doesn't exist or is in the wrong folder. It must be `backend/.env`. |
| `Cannot find module '../../generated/prisma/client'` | Run `npx prisma generate` in `backend`. |
| `EADDRINUSE :::3001` or `:::3000` | Another copy is already running. Close the old terminal, or stop it with `Ctrl+C`. |
| Login says `Failed to fetch` | The backend isn't running, or `frontend/.env.local` doesn't point to `http://localhost:3001`. Restart the frontend after editing `.env.local`. |
| `CORS policy does not allow origin` | Add your frontend URL to `CORS_ORIGINS` in `backend/.env`. |
| `password authentication failed` / timeout connecting to the database | Check `DATABASE_URL`. URL-encode special characters in the password. |
| `npm install` fails on `xlsx` | That package downloads from `cdn.sheetjs.com`; check your internet or company firewall. |

## What's new in this copy

This copy includes the speed fixes and the architecture guide (`docs/ARCHITECTURE.md`). One step is not automatic: `supabase/migrations/20261118120000_project_scope_indexes.sql` adds database indexes. Run it on the database yourself, outside working hours: Supabase → SQL Editor → paste the file → Run. Running it locally is not needed.
