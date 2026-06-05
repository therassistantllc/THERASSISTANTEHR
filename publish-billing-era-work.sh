#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/workspaces/THERASSISTANTREPLIT}"
BRANCH_NAME="${BRANCH_NAME:-billing-portfolio-claimless-era-ledger}"
TARGET_APP_PATH="${TARGET_APP_PATH:-artifacts/therassistant-ehr}"
ZIP_PATH="${ZIP_PATH:-C:/Users/Thera/Documents/Codex/2026-06-05/files-mentioned-by-the-user-pasted/outputs/billing-portfolio-claimless-era-changes.zip}"
SUMMARY_PATH="${SUMMARY_PATH:-C:/Users/Thera/Documents/Codex/2026-06-05/files-mentioned-by-the-user-pasted/outputs/billing-portfolio-claimless-era-summary.md}"
MIGRATION_REL="supabase/migrations/20260701000000_billing_portfolio_claimless_era_ledgers.sql"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "Not a git repo: $REPO_DIR" >&2
  exit 1
fi

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
command -v unzip >/dev/null || { echo "unzip is required" >&2; exit 1; }

win_to_wsl_path() {
  local path="$1"
  if [[ "$path" =~ ^([A-Za-z]):/(.*)$ ]]; then
    local drive="${BASH_REMATCH[1],,}"
    local rest="${BASH_REMATCH[2]}"
    printf '/mnt/%s/%s' "$drive" "$rest"
  else
    printf '%s' "$path"
  fi
}

ZIP_PATH="$(win_to_wsl_path "$ZIP_PATH")"
SUMMARY_PATH="$(win_to_wsl_path "$SUMMARY_PATH")"

if [[ ! -f "$ZIP_PATH" ]]; then
  echo "Package not found: $ZIP_PATH" >&2
  exit 1
fi

cd "$REPO_DIR"

current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "main" ]]; then
  echo "Expected repo on main before starting, found: $current_branch" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is dirty. Commit/stash unrelated changes before publishing." >&2
  git status --short
  exit 1
fi

git fetch origin main
git switch -c "$BRANCH_NAME"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

unzip -q "$ZIP_PATH" -d "$tmp_dir"

package_root="$tmp_dir/artifacts/therassistant-ehr"
if [[ ! -d "$package_root" ]]; then
  echo "Package did not contain artifacts/therassistant-ehr" >&2
  exit 1
fi

mkdir -p "$TARGET_APP_PATH"
cp -a "$package_root"/. "$TARGET_APP_PATH"/

if [[ ! -f "$TARGET_APP_PATH/$MIGRATION_REL" ]]; then
  echo "Missing migration after copy: $TARGET_APP_PATH/$MIGRATION_REL" >&2
  exit 1
fi

echo "Copied packaged files. Changed files:"
git status --short

app_dir="$REPO_DIR/$TARGET_APP_PATH"
if [[ -f "$app_dir/package.json" ]]; then
  cd "$app_dir"
  if command -v pnpm >/dev/null && [[ -f pnpm-lock.yaml ]]; then
    pnpm run typecheck
    pnpm run build
  elif command -v npm >/dev/null && [[ -f package-lock.json ]]; then
    npm run typecheck
    npm run build
  elif command -v npm >/dev/null; then
    npm run typecheck
    npm run build
  else
    echo "No package manager available; skipped typecheck/build" >&2
  fi
fi

cd "$REPO_DIR"
git add "$TARGET_APP_PATH"
git commit -m "Add billing portfolio claimless ERA ledger support"
git push -u origin "$BRANCH_NAME"

if command -v gh >/dev/null; then
  pr_body_file="$tmp_dir/pr-body.md"
  if [[ -f "$SUMMARY_PATH" ]]; then
    cp "$SUMMARY_PATH" "$pr_body_file"
  else
    cat > "$pr_body_file" <<'BODY'
Adds billing-company portfolio support and claimless ERA patient ledger posting.

Validation:
- Ran available project verification before commit.
BODY
  fi
  gh pr create \
    --base main \
    --head "$BRANCH_NAME" \
    --title "Add billing portfolio claimless ERA ledger support" \
    --body-file "$pr_body_file"
else
  echo "gh not available. Branch pushed; open a PR to main from $BRANCH_NAME manually." >&2
fi
