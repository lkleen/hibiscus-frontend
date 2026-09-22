#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."
ENV_FILE="$ROOT_DIR/.env.dev.local"

# First run: generate a local-only env file from the example, with real random secrets instead
# of placeholders. This is dev convenience only — it does not weaken the auth contract, which
# the backend enforces unconditionally regardless of where the values come from (see
# docs/architecture.md#authentication).
if [ ! -f "$ENV_FILE" ]; then
  echo "No .env.dev.local found — generating one for local development."
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"

  DB_PASSWORD="$(openssl rand -hex 24)"
  DB_ROOT_PASSWORD="$(openssl rand -hex 24)"
  INTERNAL_PROXY_SECRET="$(openssl rand -hex 32)"

  # macOS/BSD sed requires -i '' ; GNU sed requires -i without an argument. Try BSD form first.
  sed_inplace() {
    if sed --version >/dev/null 2>&1; then
      sed -i "$1" "$2" # GNU sed
    else
      sed -i '' "$1" "$2" # BSD sed (macOS)
    fi
  }

  sed_inplace "s/^DB_PASSWORD=.*/DB_PASSWORD=$DB_PASSWORD/" "$ENV_FILE"
  sed_inplace "s/^DB_ROOT_PASSWORD=.*/DB_ROOT_PASSWORD=$DB_ROOT_PASSWORD/" "$ENV_FILE"
  sed_inplace "s/^INTERNAL_PROXY_SECRET=.*/INTERNAL_PROXY_SECRET=$INTERNAL_PROXY_SECRET/" "$ENV_FILE"
  # Match the fixed dev identity that packages/frontend/proxy.config.mjs injects.
  sed_inplace "s/^ALLOWED_USERS=.*/ALLOWED_USERS=local-dev@example.com/" "$ENV_FILE"

  echo "Generated $ENV_FILE with fresh random secrets."
  echo "If this is a brand-new database, it will be created empty — see README.md for how to"
  echo "import a Hibiscus data dump."
  echo ""
fi

export $(grep -v '^#' "$ENV_FILE" | xargs)

echo "Starting local database..."
docker compose -f "$ROOT_DIR/docker-compose.dev.yml" --env-file "$ENV_FILE" up -d
docker compose -f "$ROOT_DIR/docker-compose.dev.yml" --env-file "$ENV_FILE" ps

cleanup() {
  echo ""
  echo "Shutting down..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true

  read -r -p "Also stop the local database container? [y/N] " stop_db
  if [ "$stop_db" = "y" ] || [ "$stop_db" = "Y" ]; then
    docker compose -f "$ROOT_DIR/docker-compose.dev.yml" --env-file "$ENV_FILE" down
  else
    echo "Leaving the database container running (data persists in its volume either way)."
  fi
  echo "Done."
}
trap cleanup EXIT INT TERM

echo "Starting backend..."
(cd "$ROOT_DIR/packages/backend" && pnpm start:local) &
BACKEND_PID=$!

echo "Starting frontend..."
(cd "$ROOT_DIR/packages/frontend" && pnpm start:local) &
FRONTEND_PID=$!

echo ""
echo "hibiscus-frontend running:"
echo "  Frontend: http://localhost:4200"
echo "  Backend:  http://localhost:$PORT"
echo ""
echo "Press Ctrl+C to stop the frontend and backend (you'll be asked about the database)."

wait
