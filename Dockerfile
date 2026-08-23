# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# pnpm 11 needs a newer Corepack than the one bundled with the base image.
RUN npm install --global corepack@latest && corepack enable && pnpm install --frozen-lockfile

FROM dependencies AS development

COPY . .

CMD ["pnpm", "dev", "--hostname", "0.0.0.0"]

FROM dependencies AS build

COPY . .

ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_UMAMI_WEBSITE_ID
ENV NEXT_PUBLIC_UMAMI_WEBSITE_ID=$NEXT_PUBLIC_UMAMI_WEBSITE_ID
ARG NEXT_PUBLIC_UMAMI_SCRIPT_URL
ENV NEXT_PUBLIC_UMAMI_SCRIPT_URL=$NEXT_PUBLIC_UMAMI_SCRIPT_URL
ARG NEXT_PUBLIC_UMAMI_DOMAINS
ENV NEXT_PUBLIC_UMAMI_DOMAINS=$NEXT_PUBLIC_UMAMI_DOMAINS
ARG UMAMI_HOST_URL
ENV UMAMI_HOST_URL=$UMAMI_HOST_URL

# Next evaluates the auth route while building. These build-only, public test
# values let that evaluation finish. Public Next.js variables must also be
# present here because they are compiled into the client bundle at build time.
RUN SKIP_ENV_VALIDATION=1 \
  DATABASE_URL=postgresql://build:build@localhost:5432/build \
  BETTER_AUTH_SECRET=build-only-not-a-runtime-secret \
  BETTER_AUTH_URL=http://build.invalid \
  TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA \
  pnpm build

FROM node:22-bookworm-slim AS production

WORKDIR /app

ENV NODE_ENV=production

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/drizzle ./drizzle

EXPOSE 3000

# Migrations run before Next starts, so an instance never serves an incompatible
# schema. data-migration.sh is the equivalent operator-facing command.
CMD ["sh", "-c", "node scripts/migrate.mjs && node_modules/.bin/next start"]
