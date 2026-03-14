#!/usr/bin/env bash
# WARD — PreToolUse Hook
# rtgf-ai-stack/hooks/pre-tool-use.sh → deployed to ~/.claude/hooks/pre-tool-use.sh
#
# Intercepts every Claude Code tool call before execution.
# Logs all calls to audit log, blocks dangerous patterns, alerts on blocks.
#
# Exit 0 = allow  |  Exit 2 = block (stdout becomes Claude's block reason)
#
# Audit log: ~/.claude/audit/YYYY-MM-DD.jsonl
# Config:    ~/.claude/hooks/ward.env  (TELEGRAM_TOKEN, TELEGRAM_CHAT_ID)
# Policy:    ~/.claude/hooks/policy/blocked-patterns.json
#
# Input (stdin): JSON with session_id, tool_name, tool_input, cwd

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_DIR="${HOME}/.claude/audit"
TODAY="$(date -u '+%Y-%m-%d')"
AUDIT_FILE="${AUDIT_DIR}/${TODAY}.jsonl"
POLICY_FILE="${HOOK_DIR}/policy/blocked-patterns.json"

# Load optional Telegram config
TELEGRAM_TOKEN=""
TELEGRAM_CHAT_ID=""
if [[ -f "${HOOK_DIR}/ward.env" ]]; then
    # shellcheck source=/dev/null
    source "${HOOK_DIR}/ward.env" 2>/dev/null || true
fi

mkdir -p "${AUDIT_DIR}"

# Read stdin into temp file (handles large payloads: Write/Edit can be 100KB+)
TMPFILE="$(mktemp /tmp/sentinel-pre-XXXXXX.json)"
trap 'rm -f "$TMPFILE"' EXIT
cat > "$TMPFILE"

# Single Python3 invocation handles parse, check, log, and exit
python3 - \
    "$TMPFILE" \
    "$AUDIT_FILE" \
    "$POLICY_FILE" \
    "${TELEGRAM_TOKEN}" \
    "${TELEGRAM_CHAT_ID}" \
    <<'PYEOF'
import json
import sys
import os
import re
from datetime import datetime, timezone

tmpfile        = sys.argv[1]
audit_file     = sys.argv[2]
policy_file    = sys.argv[3]
telegram_token = sys.argv[4] if len(sys.argv) > 4 else ""
telegram_chat  = sys.argv[5] if len(sys.argv) > 5 else ""

# ── Parse hook input ──────────────────────────────────────────────────────────
try:
    with open(tmpfile) as f:
        data = json.load(f)
except Exception:
    sys.exit(0)  # Parse failure: fail open (allow)

tool_name  = data.get("tool_name", "")
tool_input = data.get("tool_input", {})
session_id = data.get("session_id", "")
cwd        = data.get("cwd", os.getcwd())

# ── Load policy ───────────────────────────────────────────────────────────────
policy = {"bash_patterns": [], "path_patterns": []}
try:
    with open(policy_file) as f:
        policy = json.load(f)
except Exception:
    pass  # No policy: no blocks, still logs

# ── Check bash command patterns ───────────────────────────────────────────────
block_reason = None
block_id     = None
severity     = "info"

if tool_name == "Bash":
    command = tool_input.get("command", "")
    for pat in policy.get("bash_patterns", []):
        try:
            if re.search(pat["pattern"], command, re.IGNORECASE | re.DOTALL):
                severity = pat.get("severity", "high")
                action   = pat.get("action", "warn")
                if action == "block":
                    block_reason = pat.get("description", "blocked pattern")
                    block_id     = pat.get("id", "unknown")
                    break
                # action=warn: continue checking but mark severity
        except re.error:
            pass

# ── Check file path patterns ──────────────────────────────────────────────────
if block_reason is None and tool_name in ("Read", "Write", "Edit", "Glob", "NotebookEdit"):
    file_path = (
        tool_input.get("file_path")
        or tool_input.get("notebook_path")
        or tool_input.get("path")
        or tool_input.get("pattern")
        or ""
    )
    if file_path:
        expanded = os.path.expandvars(os.path.expanduser(str(file_path)))
        for pat in policy.get("path_patterns", []):
            try:
                if re.search(pat["pattern"], expanded, re.IGNORECASE):
                    severity = pat.get("severity", "medium")
                    action   = pat.get("action", "warn")
                    if action == "block":
                        block_reason = pat.get("description", "blocked path")
                        block_id     = pat.get("id", "unknown")
                        break
            except re.error:
                pass

# ── Secret redaction patterns ────────────────────────────────────────────────
_REDACT_PATTERNS = [
    (re.compile(r'sk-ant-[A-Za-z0-9\-_]{20,}'),           '[REDACTED:anthropic-key]'),
    (re.compile(r'\bsk-[A-Za-z0-9]{20,}'),                '[REDACTED:api-key]'),
    (re.compile(r'Bearer\s+[A-Za-z0-9\-._~+/]+=*',
                re.IGNORECASE),                            '[REDACTED:bearer-token]'),
    (re.compile(r'(password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+',
                re.IGNORECASE),                            '[REDACTED:credential]'),
    (re.compile(r'-----BEGIN [A-Z ]+KEY-----[\s\S]+?-----END [A-Z ]+KEY-----'),
                                                           '[REDACTED:private-key]'),
    (re.compile(r'[A-Za-z0-9+/]{40,}={0,2}'),             None),  # long base64 — handled below
]

def redact(s):
    for pattern, replacement in _REDACT_PATTERNS:
        if replacement is not None:
            s = pattern.sub(replacement, s)
    return s

# ── Build compact input summary (truncate + redact large values) ──────────────
input_summary = {}
for k, v in tool_input.items():
    s = redact(str(v))
    input_summary[k] = (s[:300] + "...") if len(s) > 300 else s

# ── Write audit log entry ─────────────────────────────────────────────────────
entry = {
    "ts":           datetime.now(timezone.utc).isoformat(),
    "event":        "pre_tool_use",
    "session_id":   session_id[:16] if session_id else "",
    "tool":         tool_name,
    "input":        input_summary,
    "cwd":          cwd,
    "blocked":      block_reason is not None,
    "block_id":     block_id,
    "block_reason": block_reason,
    "severity":     severity,
}

try:
    with open(audit_file, "a") as f:
        f.write(json.dumps(entry, separators=(",", ":")) + "\n")
except Exception:
    pass  # Audit write failure must not block the tool call

# ── Telegram alert on block ───────────────────────────────────────────────────
if block_reason and telegram_token and telegram_chat:
    import urllib.request
    import urllib.parse

    input_preview = redact(str(tool_input))[:200]
    msg = (
        f"\u26a0\ufe0f WARD BLOCK\n"
        f"Rule:    {block_id}\n"
        f"Reason:  {block_reason}\n"
        f"Tool:    {tool_name}\n"
        f"Input:   {input_preview}\n"
        f"Session: {session_id[:8] if session_id else 'unknown'}\n"
        f"CWD:     {cwd}"
    )
    url     = f"https://api.telegram.org/bot{telegram_token}/sendMessage"
    payload = urllib.parse.urlencode({"chat_id": telegram_chat, "text": msg}).encode()
    try:
        urllib.request.urlopen(url, payload, timeout=3)
    except Exception:
        pass  # Telegram unavailable: don't fail the hook

# ── Exit ──────────────────────────────────────────────────────────────────────
if block_reason:
    print(f"WARD blocked: {block_reason} [{block_id}]")
    print(f"To allow this in a legitimate context: check ~/.claude/hooks/policy/blocked-patterns.json")
    sys.exit(2)

sys.exit(0)
PYEOF
