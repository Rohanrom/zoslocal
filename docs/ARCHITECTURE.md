# ZOS architecture guide

How ZOS code is organised, and the rules every change follows. Read this before adding a module or a table.

ZOS is one product with many modules on one shared project model. Every project-owned record carries `project_id`. Every material record carries `item_code`. Adding a project should be data setup, not a code change.

## 1. System map

| Part | Tech | Hosted on | Owns |
| --- | --- | --- | --- |
| `frontend/` | Next.js 16 (App Router), React 19, Tailwind 4 | Cloudflare Workers via OpenNext | Screens only. No business rules. |
| `backend/` | NestJS 11, Prisma 7 (`@prisma/adapter-pg`) | Render | API, business rules, auth |
| Database | Postgres | Supabase | All data. Schemas `indr`, `public` today; domain schemas for new work. |
| `supabase/functions/` | Deno edge functions | Supabase | Integrations: AppSheet, Jibble, Zoho Creator stock |
| `supabase/migrations/` | SQL | in repo | The **only** way the database changes |

Outside systems during the transition: Zoho Creator (material master, stock), Zoho Procurement (PR, PO, bills), Zoho Books (invoices, accounting), Jibble (attendance), AppSheet (Park Heights reporting).

## 2. Ten rules

1. **The database changes only through `supabase/migrations/`.** No table or column is created or altered in the Supabase dashboard. Production has already drifted (see section 6); the first job is to capture it.
2. **Every project route is scoped by `project_id` in the URL**: `/projects/:projectId/...`. The backend checks the user may access that project. The frontend reads the project from the URL, not from `localStorage`.
3. **No project names in code.** No `'park_heights'`, `'indradhanush'` or `'aph'` in `if` statements or allow-lists. Per-project behaviour lives in config tables (`core.project_capability`, rule tables). Legacy cases move to config one at a time, each with a regression test.
4. **Layering in the backend**: controller (HTTP, validation, guards) → service (business rules) → repository (SQL). Controllers hold no SQL. Services hold no HTTP.
5. **Queries start from `project_id`** and use an index that leads with it. No joins on `upper(trim(coalesce(...)))`: clean keys once on import and store them clean.
6. **Lists are paginated or aggregated on the server.** The browser never downloads 5,000 rows to sum them.
7. **Heavy calculations are precomputed**: a materialized view or summary table, refreshed when its source data changes (`analytics_fast_cache` is the model). Never a live multi-view calculation on page load.
8. **Integrations go through one adapter per external system** (`ZohoCreatorAdapter`, `JibbleAdapter` and so on). Modules call the adapter interface, never the vendor API directly. External rows land in mirror tables with `source_system`, `source_id`, `synced_at`.
9. **Posted records are never edited.** Stock movements, reporting entries, QC results and billing approvals are corrected with reversal rows that carry a reason.
10. **Files stay small.** A component or service over ~600 lines gets split. New work never goes into an existing file that is already over that limit.

## 3. Backend layout (target)

Move existing modules into this shape as you touch them. New modules start in it.

```
backend/src/
  main.ts
  app.module.ts
  common/                     cross-cutting, no business rules
    request-timing.middleware.ts
    guards/                   JwtAuthGuard, RolesGuard, ProjectAccessGuard
    decorators/               @Roles, @CurrentUser, @ProjectId
    pagination.ts
    errors.ts
  core/
    auth/                     login, tokens
    users/
    projects/                 registry, directory, readiness checks
    capability/               which module is enabled for which project
  modules/
    structure/                layers, surfaces, flat areas
    planning/                 BOQ, work order, costing, projection
    material/                 item mirror, layer material spec, demand, shortfall
    workforce/                painters, availability
    assignment/               demand → recommendation → final
    execution/                reporting into indr.backend
    qc/
    billing/                  readiness and approval; invoices stay in the ERP
    analytics/
    client/                   client panel
  integrations/
    zoho-creator/
    zoho-procurement/
    zoho-books/
    jibble/
    appsheet/
```

Each module folder:

```
modules/material/
  material.module.ts
  material.controller.ts      routes: /projects/:projectId/material/...
  material.service.ts         rules
  material.repository.ts      SQL only, typed results
  dto/                        request validation (class-validator)
  material.service.spec.ts    tests for every calculation
  README.md                   purpose, tables owned, tables read, readiness checks
```

### Project access

Add `ProjectAccessGuard` in `common/guards/` and put it on every `/projects/:projectId/...` controller:

- `admin`: any project.
- `manager`, `viewer`: projects listed for them in a `core.user_project` table.
- `client`: only the project on their account (the check already in `ClientController`, made reusable).

This replaces the hard-coded `allowedProjectIds` in `users.service.ts` and the fixed `indradhanush` project for managers.

## 4. Frontend layout (target)

```
frontend/
  app/
    (auth)/login/page.tsx
    (workspace)/projects/page.tsx                     project list
    (workspace)/projects/[projectId]/layout.tsx       sidebar + project header
    (workspace)/projects/[projectId]/overview/page.tsx
    (workspace)/projects/[projectId]/assignment/[view]/page.tsx
    (workspace)/projects/[projectId]/billing/[view]/page.tsx
    (workspace)/projects/[projectId]/material/page.tsx
    client/...
  features/<module>/
    components/               UI pieces for that module
    api.ts                    calls for that module only
    hooks.ts                  data hooks
  lib/
    http.ts                   one fetch wrapper: base URL, token, 401 → login
```

Why routes instead of one dashboard page with tabs:

- Each route downloads only its own code. Today `/dashboard` holds Overview, Assignment, Billing, Dimensions and Work Order in one page. Assignment alone is about 12,000 lines.
- A URL like `/projects/prestige_lakeside/assignment/final` can be bookmarked, shared and reloaded.
- The project comes from the URL, so two tabs can show two projects.

Data fetching: one cached data layer (TanStack Query or SWR). The project directory is fetched once and reused, instead of being fetched again by every page.

## 5. Performance budget

| Measure | Budget | How to check |
| --- | --- | --- |
| Login page JavaScript (gzipped) | ≤ 200 KB | `next build`, then the size of the page's scripts |
| Any page's first-load JavaScript (gzipped) | ≤ 250 KB | Same |
| API response for a page load (server time) | ≤ 500 ms | `Server-Timing` header; `[slow]` lines in the Render log (threshold `SLOW_REQUEST_MS`, default 800) |
| Rows sent to the browser per request | ≤ 500 | Code review |
| Backend cold start | 0 for users | Keep the backend always on (section 7) |

## 6. Database: source of truth

Production has tables and columns that are not in this repo. `zos_project_registry`, `flat_area_summary`, `material_master`, `project_flat_layer_costing` and the `project_id` columns are all queried by the code, but none of them is created by `supabase/migrations/` or described in `prisma/schema.prisma`. A new environment cannot be built from the repo.

Fix it once:

1. Dump the production schema: `supabase db dump --schema indr,public -f supabase/migrations/<timestamp>_baseline_from_production.sql` (or `pg_dump --schema-only`).
2. Commit it as the new baseline. Older migrations stay for history.
3. Run `npx prisma db pull` and commit the refreshed `schema.prisma`.
4. In CI, check that `prisma db pull` against a database built from the migrations produces no diff.

From then on, every change is a new SQL file in `supabase/migrations/`, reviewed in a pull request.

## 7. Hosting

- **Backend always on.** Render's free plan stops a service after 15 minutes without traffic, and the next request waits for it to restart (often 30–60 seconds). Use a paid instance for production. The login page also calls `/health` when it opens, so a sleeping server starts booting while the user types.
- **Same region for backend and database.** Each query is a round trip between Render and Supabase. Put both in the region nearest the users (Render's nearest region to India is Singapore; Supabase offers Singapore and Mumbai). Check what each is set to today.
- **Database connections.** Use Supabase's pooled connection string for the app (`DATABASE_URL`) and the direct one only for migrations.

## 8. Change checklist (pull requests)

- [ ] Database change is a migration file in `supabase/migrations/`
- [ ] New project-owned table has `project_id` and an index that starts with it
- [ ] No project name in code
- [ ] Route is under `/projects/:projectId/` with `ProjectAccessGuard`
- [ ] Calculation has a unit test
- [ ] No file pushed past ~600 lines
- [ ] Page still within the JavaScript budget
