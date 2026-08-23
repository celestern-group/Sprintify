# Sprintify

Sprintify is a multi-tenant product-management platform for planning work, running projects and sprints, and managing organization operations. It includes backlog and board views, work-item collaboration, teams, availability and capacity planning, audit history, notifications, file attachments, configurable AI assistance, and an administrative console.

It is built with Next.js App Router, React, Better Auth, Drizzle ORM/PostgreSQL, and Tailwind CSS.

**Live application:** [sprintify.celestern.com](https://sprintify.celestern.com/)

## What Sprintify does

Sprintify gives product and delivery teams one shared operating space for the
work that moves a sprint forward. It is designed to replace scattered status
meetings, spreadsheets, and disconnected task lists with an accountable,
auditable view of plans, progress, and capacity.

### Core workflows

- **Plan and deliver work** — create projects, organize a prioritized backlog,
  run sprints, and follow progress through board and dashboard views.
- **Collaborate in context** — comment on work items, reply in threads, mention
  teammates, react, and attach files directly to the relevant work.
- **Coordinate people and capacity** — manage organizations, teams, roles,
  availability, holidays, leave, and sprint capacity.
- **See delivery health** — use dashboard metrics, workflow states, project
  views, and audit history to understand what is happening and what needs
  attention.
- **Use AI deliberately** — configure organization or platform AI providers
  for searchable content, comment assistance, summaries, and suggested next
  actions. AI features are only available where an organization has configured
  access.
- **Operate the platform** — platform administrators manage users,
  organizations, storage, AI defaults, audit records, and runtime controls.

### Access and onboarding

Sprintify supports normal public sign-up as well as platform-controlled access:

- **Open sign-up** lets visitors create an account directly.
- **Invite-only mode** closes self-service registration while organization
  invitations continue to work.
- **Wishlist** is an optional companion to invite-only mode. When enabled in
  **Admin → Controls**, visitors can submit a Turnstile-protected access
  request from the sign-in/sign-up flow. Platform administrators review requests
  in **Admin → Wishlist**, then approve or reject them individually or in bulk.
  Approval provisions an account and sends a password-setup email.
- **Platform lockdown** is an emergency control that temporarily blocks new
  sign-ups and creation operations while existing users can continue working.

Every meaningful mutation is authorized, recorded in the append-only audit log,
and revalidated in the application. Person-specific changes can also create
in-app notifications.

## Requirements

- Node.js `22.x` or `24.x`
- pnpm
- PostgreSQL with the `pgvector` extension for a local database setup

Docker is optional, but is the quickest way to run the app with PostgreSQL and a local mail inbox.

## Quick start

Install dependencies, configure the application, apply migrations, then start the development server:

```bash
pnpm install
cp .env.example .env.local
# Edit .env.local with your local database and SMTP settings.
pnpm db:migrate
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Environment variables are validated at startup by [`src/env.ts`](src/env.ts). For the complete list and guidance, see [`.env.example`](.env.example). CI or build jobs without secrets can set `SKIP_ENV_VALIDATION=1`.

### Docker development environment

This starts the app, a pgvector-enabled PostgreSQL database, and Mailpit. Tracked migrations run before Next.js starts.

```bash
docker compose -f docker-compose.dev.yml up --build
```

- App: [http://localhost:3000](http://localhost:3000)
- Mailpit: [http://localhost:8025](http://localhost:8025)
- PostgreSQL: `localhost:5432`

## Common commands

```bash
# Application
pnpm dev                 # Development server with Turbopack
pnpm build               # Production build
pnpm start               # Run a production build
pnpm lint                # Biome checks
pnpm format              # Format with Biome
pnpm typecheck           # TypeScript checks
pnpm test                # Vitest suite
pnpm email               # React Email preview server

# Database
pnpm db:generate         # Generate a Drizzle migration from schema changes
pnpm db:migrate          # Apply local migrations from .env.local
pnpm db:migrate:deploy   # Production-safe migration runner
pnpm db:studio           # Open Drizzle Studio
pnpm db:clean            # Clear the development database
pnpm db:seed:demo        # Seed demo data
pnpm admin:seed          # Create/promote the initial superadmin (SEED_ADMIN_* or CLI args)

# AI
pnpm embeddings:backfill # Backfill searchable-text embeddings
```

Use pnpm for all package operations; do not mix npm or Yarn into this workspace.

## Configuration

Copy [`.env.example`](.env.example) to `.env.local` for local development. The main settings are:

- `DATABASE_URL` — PostgreSQL connection string.
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` — authentication configuration.
- `SMTP_*`, `EMAIL_FROM`, and `EMAIL_FROM_NAME` — transactional email delivery.
- `STORAGE_*` — local or S3-compatible attachment storage.
- `AI_ENCRYPTION_KEY` — encrypts provider keys stored for in-app AI configuration.
- `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` — optional error reporting.

Turnstile credentials are optional in development (test keys are used) and required in production.

### Bootstrap the first superadmin

After migrations are applied, run `pnpm admin:seed <email> <password> [name]` once in a trusted environment. Alternatively, set `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, and optionally `SEED_ADMIN_NAME` in `.env.local` before running `pnpm admin:seed`. The command creates the account when needed, verifies its email, and promotes it to `superadmin`; it does not seed plans or other application data.

## Project structure

```text
src/app/             App Router pages and API routes
src/components/      Shared UI, dashboard, app, and management components
src/lib/             Server actions, auth, domain logic, integrations, and helpers
src/db/schema/       Drizzle schema modules, re-exported by schema/index.ts
src/emails/          Transactional React Email templates
drizzle/             Versioned SQL migrations
scripts/             Seeds, migration runner, and maintenance scripts
```

The application uses strict TypeScript, Biome, Tailwind CSS v4, and the `@/*` alias for `src/*` imports.

## Architecture at a glance

```text
Browser
  │
  ├── Next.js App Router pages and client components
  │     └── Server actions validate input, authorize, write audit events,
  │         schedule derived work, and revalidate affected pages
  │
  ├── Better Auth
  │     └── sessions, organizations, invitations, roles, SSO, and MFA
  │
  ├── PostgreSQL + pgvector (Drizzle ORM)
  │     └── application data, audit trail, notifications, and embeddings
  │
  └── Integrations
        ├── SMTP / React Email for transactional messages
        ├── Cloudflare Turnstile for public-form protection
        ├── local or S3-compatible storage for attachments
        ├── configurable AI providers
        └── Sentry for optional error reporting
```

The database schema is split by domain under [`src/db/schema`](src/db/schema),
while server-side domain operations live under [`src/lib`](src/lib). See
[AGENTS.md](AGENTS.md) for the project’s required mutation, authorization,
embedding, notification, and design-system conventions.

## Database changes

Schema modules live in [`src/db/schema`](src/db/schema) and are exported through [`src/db/schema/index.ts`](src/db/schema/index.ts). Add a new module to the barrel export before generating a migration:

```bash
pnpm db:generate
pnpm db:migrate
```

Better Auth is configured in [`src/lib/auth.ts`](src/lib/auth.ts); its tables are in [`src/db/schema/auth.ts`](src/db/schema/auth.ts). The Better Auth generator does not safely preserve this project's existing camel-case columns, relations, indexes, and foreign keys. When changing the auth configuration, inspect generated output carefully and add schema changes compatibly before running `db:generate` and `db:migrate`.

## MCP access

Sprintify exposes a Streamable HTTP MCP endpoint at `/api/mcp`.


Create a personal API key from your profile and supply it as a Bearer token to an MCP client. Keys have read access by default; grant write access explicitly when mutations are required. MCP actions use the same organization and project authorization, audit records, notifications, and embedding behavior as the web application.

## Production deployment

The repository includes a [`Dockerfile`](Dockerfile), [`nixpacks.toml`](nixpacks.toml), and a production Compose configuration.

```bash
cp .env.production.example .env.production
# Replace every placeholder before deploying.
docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
```

Production Compose expects a reachable PostgreSQL database and applies tracked migrations before starting the application. To run that step separately, provide `DATABASE_URL` and run:

```bash
./data-migration.sh
```

## Contributing

Before opening a change, run the relevant checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For architectural conventions, server-action requirements, database guidance, and the Aurora design system, read [AGENTS.md](AGENTS.md). In particular, UI work must use the shared design tokens and responsive patterns, and meaningful mutations must preserve authorization, auditing, notifications, and revalidation behavior.

## License

See [LICENSE](LICENSE).
