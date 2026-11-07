#!/bin/bash
# Builds the per-OS release archives (Node runtime + app, no Docker / Node install needed).
#
# Usage:  NODE_VERSION=22.x.y [TARGETS="darwin-arm64 linux-x64"] scripts/package-release.sh <version>
#
# Env:
#   NODE_VERSION  required, exact Node release to bundle (e.g. 22.23.4). No default.
#   TARGETS       optional, space-separated list of targets to build. This only selects what to
#                 build; when unset all of linux-x64 linux-arm64 darwin-x64 darwin-arm64 win-x64
#                 are built.
#
# Output: release/hibiscus-frontend-<version>-<target>.(tar.gz|zip); downloads cached in
# release/.cache.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$ROOT_DIR/release"
CACHE_DIR="$OUT_DIR/.cache"
ALL_TARGETS="linux-x64 linux-arm64 darwin-x64 darwin-arm64 win-x64"

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>" >&2
  exit 1
fi
if [ -z "${NODE_VERSION:-}" ]; then
  echo "NODE_VERSION is not set (e.g. NODE_VERSION=22.23.4)" >&2
  exit 1
fi
NODE_VERSION="${NODE_VERSION#v}"
TARGETS="${TARGETS:-$ALL_TARGETS}"

for target in $TARGETS; do
  case " $ALL_TARGETS " in
    *" $target "*) ;;
    *) echo "Unknown target: $target (known: $ALL_TARGETS)" >&2; exit 1 ;;
  esac
done

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# Downloads a Node archive into the cache (once) and verifies it against SHASUMS256.txt.
fetch_node() {
  local archive="$1"
  local base="https://nodejs.org/dist/v$NODE_VERSION"
  local sums="$CACHE_DIR/SHASUMS256-$NODE_VERSION.txt"
  if [ ! -f "$sums" ]; then
    curl -fsSL "$base/SHASUMS256.txt" -o "$sums"
  fi
  if [ ! -f "$CACHE_DIR/$archive" ]; then
    curl -fsSL "$base/$archive" -o "$CACHE_DIR/$archive.part"
    mv "$CACHE_DIR/$archive.part" "$CACHE_DIR/$archive"
  fi
  local expected
  expected="$(grep " $archive\$" "$sums" | cut -d' ' -f1)"
  if [ -z "$expected" ]; then
    echo "No checksum for $archive in SHASUMS256.txt" >&2
    exit 1
  fi
  local actual
  actual="$(sha256_of "$CACHE_DIR/$archive")"
  if [ "$expected" != "$actual" ]; then
    rm -f "$CACHE_DIR/$archive"
    echo "Checksum mismatch for $archive (expected $expected, got $actual)" >&2
    exit 1
  fi
}

write_readme() {
  local file="$1" start="$2"
  cat >"$file" <<README
Hibiscus frontend $VERSION - local test build
==============================================

A web frontend for a Hibiscus home-banking database. This archive contains everything it
needs (including Node.js); no Docker and no Node install required.

Start:   run $start
         It asks whether to use the demo data or your own MariaDB (Hibiscus) database.
Open:    http://127.0.0.1:8080 (opened automatically)
Stop:    Ctrl+C in the terminal window.
Options: $start --help

macOS: if the system blocks the start, remove the quarantine flag once:
  xattr -dr com.apple.quarantine <this folder>

For testing only. Do not use it to serve other people.
README
}

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found" >&2
  exit 1
fi
if echo "$TARGETS" | grep -q "win-x64" && ! command -v zip >/dev/null 2>&1; then
  echo "zip not found (needed for win-x64)" >&2
  exit 1
fi

cd "$ROOT_DIR"
pnpm build

mkdir -p "$OUT_DIR" "$CACHE_DIR"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# Common app/ layout, staged once.
DEPLOY_DIR="$WORK_DIR/deploy"
APP_STAGE="$WORK_DIR/app"
# deploy copies the whole package (src, configs, .turbo, ...) and installs the production
# dependencies; only package.json and node_modules are taken from it. dist/ is copied
# explicitly from the build output.
pnpm --filter @hibiscus-frontend/backend deploy --prod --legacy "$DEPLOY_DIR"
DEMO_DATA="$ROOT_DIR/packages/backend/demo-data/demo-data.json.gz"
if [ ! -f "$DEMO_DATA" ]; then
  echo "Missing $DEMO_DATA (written by the backend build)" >&2
  exit 1
fi
mkdir -p "$APP_STAGE/demo-data" "$APP_STAGE/launcher"
cp "$DEPLOY_DIR/package.json" "$APP_STAGE/package.json"
cp -R "$DEPLOY_DIR/node_modules" "$APP_STAGE/node_modules"
cp -R "$ROOT_DIR/packages/backend/dist" "$APP_STAGE/dist"
cp -R "$ROOT_DIR/packages/frontend/dist/frontend/browser" "$APP_STAGE/public"
cp "$DEMO_DATA" "$APP_STAGE/demo-data/"
cp -R "$ROOT_DIR/packages/launcher/dist" "$APP_STAGE/launcher/dist"

PRODUCED=()
for target in $TARGETS; do
  name="hibiscus-frontend-$VERSION-$target"
  stage="$WORK_DIR/$target/$name"
  mkdir -p "$stage"

  if [ "$target" = "win-x64" ]; then
    archive="node-v$NODE_VERSION-win-x64.zip"
    fetch_node "$archive"
    unzip -q "$CACHE_DIR/$archive" -d "$WORK_DIR/$target/node-extract"
    mv "$WORK_DIR/$target/node-extract/node-v$NODE_VERSION-win-x64" "$stage/node"
  else
    archive="node-v$NODE_VERSION-$target.tar.gz"
    fetch_node "$archive"
    mkdir -p "$stage/node"
    tar -xzf "$CACHE_DIR/$archive" -C "$stage/node" --strip-components=1
  fi

  cp -R "$APP_STAGE" "$stage/app"

  if [ "$target" = "win-x64" ]; then
    printf '@echo off\r\n"%%~dp0node\\node.exe" "%%~dp0app\\launcher\\dist\\main.js" %%*\r\n' >"$stage/start.cmd"
    write_readme "$stage/README.txt" "start.cmd"
    sed -i.bak 's/$/\r/' "$stage/README.txt" && rm -f "$stage/README.txt.bak"
    out="$OUT_DIR/$name.zip"
    rm -f "$out"
    (cd "$WORK_DIR/$target" && zip -qr "$out" "$name")
  else
    cat >"$stage/start.sh" <<'START'
#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/node/bin/node" "$DIR/app/launcher/dist/main.js" "$@"
START
    chmod +x "$stage/start.sh"
    write_readme "$stage/README.txt" "./start.sh"
    out="$OUT_DIR/$name.tar.gz"
    rm -f "$out"
    tar -czf "$out" -C "$WORK_DIR/$target" "$name"
  fi
  PRODUCED+=("$out")
done

echo
echo "Produced:"
for f in "${PRODUCED[@]}"; do
  du -h "$f" | cut -f1 | tr '\n' ' '
  echo "$f"
done
