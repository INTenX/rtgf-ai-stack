#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="${CODEX_HOOKS_LOG_DIR:-$ROOT_DIR/logs}"
mkdir -p "$LOG_DIR"

payload="${1:-}"
if [[ -z "$payload" ]]; then
  payload='{}'
fi

node -e '
const fs = require("fs");
const path = process.argv[1];
const raw = process.argv[2] || "{}";
let obj = {};
try { obj = JSON.parse(raw); } catch {}
const row = {
  ts: new Date().toISOString(),
  title: obj.title || null,
  msg: obj.msg || null,
  event: obj.event || obj.type || null,
};
fs.appendFileSync(path, JSON.stringify(row) + "\n");
' "$LOG_DIR/notify-summary.jsonl" "$payload"
