#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REMOTE="${PURCHASING_REMOTE:-dawid}"
SOURCE_BRANCH="${PURCHASING_SOURCE_BRANCH:-feat/handling-purchasing}"
TARGET_BRANCH="${PURCHASING_TARGET_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
COMMITS="${PURCHASING_COMMITS:-d1e2ad6d c9fc374a 64c42197}"
RUN_INSTALL="${PURCHASING_RUN_INSTALL:-true}"
RUN_INITIALIZE="${PURCHASING_RUN_INITIALIZE:-false}"
START_APP="${PURCHASING_START_APP:-false}"
PUBLIC_URL="${PURCHASING_PUBLIC_URL:-}"
ENV_FILE="${PURCHASING_ENV_FILE:-apps/mercato/.env.local}"

info() {
  printf '\n[purchasing-vps] %s\n' "$1"
}

fail() {
  printf '\n[purchasing-vps] ERROR: %s\n' "$1" >&2
  exit 1
}

print_help() {
  cat <<'EOF'
Usage:
  yarn ops:purchasing:vps

Environment variables:
  PURCHASING_REMOTE=dawid
  PURCHASING_SOURCE_BRANCH=feat/handling-purchasing
  PURCHASING_TARGET_BRANCH=<current branch by default>
  PURCHASING_COMMITS="d1e2ad6d c9fc374a 64c42197"
  PURCHASING_PUBLIC_URL=http://187.124.0.124:3000
  PURCHASING_ENV_FILE=apps/mercato/.env.local
  PURCHASING_RUN_INSTALL=true
  PURCHASING_RUN_INITIALIZE=false
  PURCHASING_START_APP=false

Example:
  PURCHASING_REMOTE=dawid \
  PURCHASING_TARGET_BRANCH=main \
  PURCHASING_PUBLIC_URL=http://187.124.0.124:3000 \
  yarn ops:purchasing:vps
EOF
}

upsert_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  if grep -q "^${key}=" "$file"; then
    perl -0pi -e "s#^${key}=.*#${key}=${value}#m" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  print_help
  exit 0
fi

if ! command -v git >/dev/null 2>&1; then
  fail "git is required"
fi

if ! command -v yarn >/dev/null 2>&1; then
  fail "yarn is required"
fi

if [[ -n "$(git status --porcelain)" ]]; then
  fail "worktree is dirty; commit or stash changes before running this script"
fi

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  fail "remote '$REMOTE' does not exist"
fi

if [[ -n "$PUBLIC_URL" ]]; then
  info "Writing public app URL to $ENV_FILE"
  upsert_env_value "$ENV_FILE" "APP_URL" "$PUBLIC_URL"
  upsert_env_value "$ENV_FILE" "NEXT_PUBLIC_APP_URL" "$PUBLIC_URL"
fi

info "Fetching $REMOTE/$SOURCE_BRANCH"
git fetch "$REMOTE" "$SOURCE_BRANCH"

info "Checking out target branch $TARGET_BRANCH"
git checkout "$TARGET_BRANCH"

for commit in $COMMITS; do
  if git merge-base --is-ancestor "$commit" HEAD 2>/dev/null; then
    info "Commit $commit already present, skipping"
    continue
  fi
  info "Cherry-picking $commit"
  git cherry-pick "$commit"
done

if [[ "${RUN_INSTALL}" == "true" ]]; then
  info "Installing dependencies"
  yarn install
fi

info "Building packages"
yarn build:packages

info "Generating app artifacts"
yarn generate

info "Running database migrations"
yarn db:migrate

if [[ "${RUN_INITIALIZE}" == "true" ]]; then
  info "Running initialize"
  yarn initialize
fi

info "Running app typecheck"
yarn workspace @open-mercato/app typecheck

if [[ "${APP_URL:-}" == "http://0.0.0.0:3000" || "${NEXT_PUBLIC_APP_URL:-}" == "http://0.0.0.0:3000" ]]; then
  printf '\n[purchasing-vps] WARNING: APP_URL or NEXT_PUBLIC_APP_URL still points to 0.0.0.0:3000\n'
  printf '[purchasing-vps] Set them to the public host before login testing.\n'
fi

if [[ -n "$PUBLIC_URL" ]]; then
  printf '[purchasing-vps] Public app URL written to %s\n' "$ENV_FILE"
fi

printf '\n[purchasing-vps] Purchasing deployment prep finished successfully.\n'
printf '[purchasing-vps] Current branch: %s\n' "$(git rev-parse --abbrev-ref HEAD)"
printf '[purchasing-vps] Current HEAD: %s\n' "$(git rev-parse --short HEAD)"

if [[ "${START_APP}" == "true" ]]; then
  info "Starting app"
  AUTO_SPAWN_WORKERS=false AUTO_SPAWN_SCHEDULER=false yarn dev:app
else
  printf '\n[purchasing-vps] To start app manually run:\n'
  printf 'AUTO_SPAWN_WORKERS=false AUTO_SPAWN_SCHEDULER=false yarn dev:app\n'
fi
