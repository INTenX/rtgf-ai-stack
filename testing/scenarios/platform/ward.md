# Scenario Suite — WARD (Security Hooks)
**Component:** WARD (`hooks/`)
**Status:** Built, installed. `hooks/pre-tool-use.sh` has unstaged changes.

---

## Context

WARD implements Claude Code pre-tool-use hooks for security governance. It inspects tool calls before execution, applies allow/deny/warn policy, logs audit entries, and fires Telegram alerts on blocks.

Real-world use cases this maps to:
- Pre-execution intent inspection (block before harm, not after)
- Least-privilege access enforcement (path-pattern blocking)
- Prompt injection / jailbreak resistance (tool abuse patterns)
- Immutable audit trails (every decision logged)
- Policy distribution (install-hooks.sh deploys to all sessions)

---

## Scenario 1 — Blocked Command Triggers Correctly
**Description:** A command matching a block policy is denied; Telegram alert fires.
**Input:** Attempt a Bash tool call matching a known blocked pattern (e.g., `rm -rf /`)
**Pass Criteria:**
- Tool call blocked before execution
- Audit log entry written with: tool, command, decision=BLOCK, timestamp
- Telegram alert received (if bot is reachable)
- Error surfaced to Claude with reason, not silently swallowed

---

## Scenario 2 — Allowed Command Passes Without Prompt
**Description:** A safe command in the allow list executes without friction.
**Input:** Standard Bash call (e.g., `ls /home/cbasta`)
**Pass Criteria:**
- Command executes normally
- No audit log entry (or entry with decision=ALLOW, not WARN/BLOCK)
- No Telegram alert
- No performance degradation visible to user

---

## Scenario 3 — Audit Log Entry Fields
**Description:** A logged event has all required fields.
**Input:** Trigger any audit-logged action (allow, warn, or block)
**Pass Criteria:**
- Log entry contains: timestamp, session_id, tool_name, command/args, decision, reason
- Timestamp is accurate (within 5s)
- Session ID matches current Claude Code session

---

## Scenario 4 — Path Pattern Block (Credential File Access)
**Description:** Access to known credential file paths is blocked.
**Input:** Attempt Read or Bash call targeting `/etc/passwd`, `.env`, `id_rsa`, or `credentials.json`
**Pass Criteria:**
- Access blocked before file is opened
- Audit entry records the attempted path
- Reason in audit: "credential file access pattern"

---

## Scenario 5 — Policy Update via install-hooks.sh
**Description:** Policy changes deploy correctly when install-hooks.sh is run.
**Input:** Modify a policy rule; run `hooks/install-hooks.sh`; verify new rule is active
**Pass Criteria:**
- Hook file updated without breaking existing rules
- New rule takes effect on next tool call
- Previous rules still enforce correctly (no regression)

---

## Scenario 6 — Hook Latency Acceptable
**Description:** WARD hooks do not add unacceptable latency to tool execution.
**Input:** Run 10 consecutive allowed Bash commands; measure wall-clock time vs. unhoooked baseline
**Pass Criteria:**
- Hook adds <200ms per tool call
- No cumulative slowdown over 10 calls
- Hook doesn't block on Telegram unavailability (fire-and-forget alert)

---

## Scenario 7 — WARD Audit Review Skill
**Description:** Run `ward-audit-review` skill against a log containing a blocked event.
**Skill:** `skills/platform/ward-audit-review.md`
**Input Scenario A:** Log with one blocked command and several allowed ones
**Input Scenario B:** Clean log — no blocks, no anomalies
**Pass Criteria:**
- Scenario A: Blocked event identified, command reproduced, recommendation given
- Scenario B: "No anomalies detected" — no false alarms
- No "Cole" or internal names in output
- Output is actionable (not just a raw log dump)

---

## Scenario 8 — Indirect Access Pattern (Policy Bypass Attempt)
**Description:** A blocked path cannot be accessed indirectly (e.g., via shell redirection or env vars).
**Input:** Attempt `cat /etc/passwd > /tmp/dump.txt` — direct access is blocked; test indirect write
**Pass Criteria:**
- Block triggered on the underlying path pattern, not just the literal string
- Audit entry captures the full attempted command
- `/tmp/dump.txt` is NOT created

---

## Status

| Scenario | Status | Report |
|----------|--------|--------|
| 1 — Block triggers + Telegram | **PASS** | `reports/2026-03-14-ward-suite-A.md` |
| 2 — Allowed passes clean | **PASS** | `reports/2026-03-14-ward-suite-A.md` |
| 3 — Audit log fields | **PASS** | `reports/2026-03-14-ward-suite-A.md` |
| 4 — Credential path block | **PASS** | `reports/2026-03-14-ward-suite-A.md` |
| 5 — install-hooks.sh policy update | **PASS** | `reports/2026-03-14-ward-suite-A.md` |
| 6 — Hook latency | **PASS*** | avg 143ms ✓; max 418ms noted |
| 7 — Audit review skill | **PASS** | `reports/2026-03-14-ward-suite-A.md` |
| 8 — Indirect access pattern | **FAIL** | WARD-001: bash path access gap |
