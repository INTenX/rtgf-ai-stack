#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="${CODEX_HOOKS_DIR:-$SCRIPT_DIR/hooks.d}"
LOG_DIR="${CODEX_HOOKS_LOG_DIR:-$SCRIPT_DIR/logs}"

mkdir -p "$LOG_DIR"

payload="${1:-}"
if [[ -z "$payload" ]]; then
  exit 0
fi

ts="$(date -Iseconds)"
printf '%s\t%s\n' "$ts" "$payload" >> "$LOG_DIR/notify-events.jsonl"

json_get() {
  local key="$1"
  node -e '
const input = process.argv[1] || "{}";
const key = process.argv[2];
try {
  const obj = JSON.parse(input);
  const v = obj[key];
  if (typeof v === "string") process.stdout.write(v);
} catch (_) {}
' "$payload" "$key"
}

normalize_event() {
  local raw="$1"
  if [[ -z "$raw" ]]; then
    echo "agent-turn-complete"
    return
  fi

  raw="${raw// /-}"
  raw="${raw//_/-}"
  echo "${raw,,}" | tr -cd '[:alnum:]-'
}

run_hook_dir() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0

  local f
  while IFS= read -r -d '' f; do
    if [[ -x "$f" ]]; then
      "$f" "$payload" || true
    fi
  done < <(find "$dir" -maxdepth 1 -type f -perm -u=x -print0 | sort -z)
}

raw_event="$(json_get event)"
if [[ -z "$raw_event" ]]; then
  raw_event="$(json_get type)"
fi

normalized_event="$(normalize_event "$raw_event")"

run_hook_dir "$HOOKS_DIR/all"
run_hook_dir "$HOOKS_DIR/$normalized_event"

exit 0
