---
skill_id: platform/ward-audit-review
domain: platform
trigger: WARD, audit log, security review, blocked command, tool block, audit digest
version: "1.0"
---

# Skill: WARD Audit Review

## Purpose

Review WARD audit logs to understand what tool calls were made, what was blocked, and whether any blocks warrant follow-up. WARD is the pre/post-tool-use security hook — every tool call is logged, dangerous patterns are blocked and alerted.

## Audit Log Location

```
~/.claude/audit/YYYY-MM-DD.jsonl
```

One file per day, UTC date. Each line is a JSON entry.

## Quick Review

```bash
# Today's log
cat ~/.claude/audit/$(date -u '+%Y-%m-%d').jsonl | python3 -m json.tool | less

# Count blocks today
grep '"blocked":true' ~/.claude/audit/$(date -u '+%Y-%m-%d').jsonl | wc -l

# Show only blocked entries
grep '"blocked":true' ~/.claude/audit/$(date -u '+%Y-%m-%d').jsonl | python3 -c "
import sys, json
for line in sys.stdin:
    e = json.loads(line)
    print(f\"{e['ts']} | {e['tool']} | {e['block_id']} | {e['block_reason']}\")
"

# Full digest via Telegram
/audit          # from Telegram bot
```

## Audit Entry Fields

| Field | Meaning |
|-------|---------|
| `ts` | UTC timestamp |
| `event` | `pre_tool_use` or `post_tool_use` |
| `session_id` | First 16 chars of session ID |
| `tool` | Tool name (Bash, Read, Write, Edit, etc.) |
| `input` | Truncated tool input (300 chars) |
| `blocked` | true if blocked, false if allowed |
| `block_id` | Policy rule ID that triggered the block |
| `block_reason` | Human-readable reason |
| `severity` | `info`, `medium`, `high` |

## Responding to Blocks

**Legitimate work was blocked:**

1. Check `~/.claude/hooks/policy/blocked-patterns.json` for the rule
2. If the pattern is too broad, narrow it — don't delete it
3. If the work genuinely requires the blocked action, document why and add a one-time exception comment
4. Rebuild the policy from the repo: `bash ~/rtgf-ai-stack/hooks/install-hooks.sh`

**Suspicious block (unexpected tool call):**

1. Note the session ID (`session_id` field)
2. Find the session JSONL: `~/.claude/projects/*/<session-id>.jsonl`
3. Review the session context around that timestamp
4. If unexplained, escalate to human review

## Policy File

```
~/.claude/hooks/policy/blocked-patterns.json
```

Source of truth is the repo:
```
~/rtgf-ai-stack/hooks/policy/blocked-patterns.json
```

After editing the repo version, redeploy:
```bash
bash ~/rtgf-ai-stack/hooks/install-hooks.sh
```

## Block Categories (Current Policy)

| Category | Examples | Severity |
|----------|---------|---------|
| Destructive file ops | `rm -rf`, `git clean -f` | High — block |
| Force push | `git push --force` to main | High — block |
| SQL DDL drops | `DROP TABLE`, `DROP DATABASE` | High — block |
| Credential files | SSH keys, `.pem`, `.p12` | High — block |
| Unsafe pipe | `curl \| bash`, `wget \| sh` | High — block |
| Env files | `.env` access, `--no-verify` | Medium — warn |

## When to Escalate

Escalate to the human (via Telegram or direct) when:
- A block occurs in a production session (Ubuntu-AI-Hub, deployed service)
- The same block pattern fires repeatedly in the same session
- A block fires on a tool call that the session should never have attempted
