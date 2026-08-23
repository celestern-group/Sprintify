#!/usr/bin/env sh

# Apply the tracked Drizzle migrations using DATABASE_URL from the environment.
# Kept as a small wrapper so the same production-safe runner is used locally,
# by Compose, and by deployment operators.
set -eu

exec node scripts/migrate.mjs
