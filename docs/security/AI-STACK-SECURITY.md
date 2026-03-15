# AI Stack — Security Context
**Living Document** | Last updated: 2026-03-14
**Scope:** WARD hooks, platform hooks, CLI commands, skills, and the full security roadmap for the rtgf-ai-stack.
**Cross-ref:** `~/rtgf-ai-stack/hooks/` | `~/security/AGENT_GUIDANCE.md` | `~/rtgf-ai-stack/docs/architecture/security-layers.md`

---

## What This Document Is For

Any session — security-focused or general AI Stack work — should use this as the authoritative reference for:
- What security controls are active right now
- What hooks are installed and what each one does
- What CLI commands exist and when to use them
- What skills are available
- What's wired up vs. what still has gaps
- The phase-by-phase security build-out plan

Update this document when any of the above changes.

---

## Security Audit — 2026-03-14

A structured security audit was conducted on the full stack. Six shell injection vulnerabilities were found and fixed:

| Finding | File | Fix |
|---------|------|-----|
| `AUDIT-001` | `interface/lib/tools.js` — `loreImport()` | `execSync` with string interpolation → `execFileSync` with args array |
| `AUDIT-002` | `chronicle/tools/lib/git-operations.js` — `gitAdd()` | Same fix |
| `AUDIT-003` | `~/.local/bin/check-mailbox` | Added path traversal guard on `From:` header before writing ACK |
| `AUDIT-004` | `chronicle/tools/cli/rcm-flow.js` | Missing `import yaml from 'js-yaml'` (caused ReferenceError) |
| `AUDIT-005` | `chronicle/tools/lib/git-operations.js` — `gitCommit()` | `execSync` → `execFileSync` |
| `AUDIT-006` | `chronicle/mcp-server.js` — `addSessionNote()` | Strip leading `---` from notes to prevent frontmatter injection |

Additionally:
- **WARD-001**: Added `bash-credential-file` warn pattern to block policies (shell access to `/etc/passwd`, `~/.ssh/id_*`, `.aws/credentials`, `.pem`, `.key`, etc.)
- **WARD-EC-001**: Pattern anchored to `(?m)^\s*` to prevent false positives on heredoc content; action set to `warn` (not block) to avoid blocking legitimate documentation of these paths
- **CHR-001**: Fixed CHRONICLE symlink flow — after `git mv`, the canonical target (resolved via `fs.realpathSync`) is now staged alongside the symlink
- **CHR-003**: Fixed duplicate-import detection — `platform_session_id` grep was matching against quoted YAML value but YAML stores unquoted; fixed by removing quotes from pattern
- **MSG-001/002**: Fixed ACK heredoc variable expansion + added missing `**From:**` header warning
- **MSG-EC-003**: Added 4-char random hex suffix to `send-message` filenames to prevent same-second collisions

---

## Current Security State (as of 2026-03-14)

### Layer 1 — Permissions Deny (Claude Code native)
**Status: Active** — configured in `~/.claude/settings.json`

Claude Code's built-in file access control. Blocks Read/Grep/Glob from accessing sensitive paths without requiring any hook execution.

**Protected paths:**
```
~/.git-credentials, ~/.gitconfig
~/.ssh/**, ~/.gnupg/**
~/.aws/**, ~/.azure/**, ~/.config/gcloud/**
~/.docker/config.json
~/**/*.pem, *.key, *.p12, *.pfx, *.der, *.crt, *.cer
~/.bash_history, ~/.zsh_history, ~/.python_history
.env, .env.*, **/secrets/**, **/credentials/**
```

**Important:** This layer is silent from Claude's perspective — it looks like the file doesn't exist.

### Layer 2 — WARD Hooks (pre/post tool-use)
**Status: Active** | **Telegram alerts: Active** (token wired 2026-03-06)

Intercepts every Claude Code tool call. Pre-tool-use can block; post-tool-use is observe-only.

**Blocks (exit 2 — hard stop):**
| Rule ID | Trigger | Why |
|---------|---------|-----|
| `rm-rf` | `rm -rf` / `--recursive --force` variants | Destructive delete |
| `git-reset-hard` | `git reset --hard` | Discards all uncommitted work |
| `git-force-push` | `git push -f` / `--force` (not `--force-with-lease`) | Overwrites upstream history |
| `git-clean-force` | `git clean -f` | Destroys untracked files |
| `git-checkout-destructive` | `git checkout .` / `git restore .` | Discards working directory |
| `drop-ddl` | `DROP TABLE/DATABASE/INDEX/SCHEMA` | Database destruction |
| `device-write` | `> /dev/sda*` etc. | Direct disk write |
| `fork-bomb` | `:(){ :|: }` pattern | Process storm |
| `curl-pipe-shell` | `curl ... \| bash` / `wget ... \| sh` | Remote code execution |
| `ssh-keys` | Read/Write `~/.ssh/id_*`, `authorized_keys` | Private key exfiltration |
| `system-credentials` | `/etc/passwd`, `/etc/shadow`, `/etc/sudoers` | Credential access |
| `private-key-files` | Any `.key`, `.pem`, `.p12`, `.pfx`, `.jks` | Private key access |
| `aws-credentials` | `~/.aws/credentials` or `~/.aws/config` | Cloud credential access |
| `claude-credentials` | `~/.claude/api_key`, `credentials`, `token` | Agent credential access |
| `gnupg-keys` | Anything under `~/.gnupg/` | GPG keyring |

**Warns (logged, allowed through):**
| Rule ID | Trigger |
|---------|---------|
| `no-verify-commit` | `git commit --no-verify` |
| `kill-mass` | `kill -9 -1` / `pkill -9 -f .` |
| `env-production` | `.env.production`, `.env.prod`, `.env.staging` |
| `env-file` | Plain `.env` files (not `.env.example`) |
| `bash-credential-file` | Shell commands (`cat`, `less`, `cp`, `mv`, etc.) on credential paths — `/etc/passwd`, `~/.ssh/id_*`, `.aws/credentials`, `.pem`, `.key`, `.p12` — anchored to start-of-line to avoid false positives on heredoc content |

**Audit log:** `~/.claude/audit/YYYY-MM-DD.jsonl` — every tool call, pre and post.

Telegram alerts active — blocks fire a phone notification immediately via the INTenX Stack bot.

### Layer 3 — LiteLLM Virtual Keys
**Status: Active** — gateway deployed on AI Hub WSL

Per-client API key isolation with monthly budget enforcement. Spend tracked in PostgreSQL.

```bash
# Create a key
bash ~/rtgf-ai-stack/gateway/setup-client.sh <client-name> <monthly-budget-usd>
# View spend
/spend   (Telegram admin command)
```

---

## All Installed Hooks

Registered in `~/.claude/settings.json`. Hooks fire on every session automatically.

### PreToolUse — WARD block + audit
**File:** `~/.claude/hooks/pre-tool-use.sh` (deployed from `~/rtgf-ai-stack/hooks/`)
**Fires:** Before every tool call
**Can block:** Yes (exit 2)
**What it does:** Pattern-matches bash commands and file paths against `~/.claude/hooks/policy/blocked-patterns.json`. Logs all calls to audit JSONL. Sends Telegram alert on block (when token configured).

```bash
# Update policy without reinstalling
nano ~/.claude/hooks/policy/blocked-patterns.json

# Temporarily disable (then re-enable)
bash ~/rtgf-ai-stack/hooks/install-hooks.sh --disable
# ... do the thing ...
bash ~/rtgf-ai-stack/hooks/install-hooks.sh
```

### PostToolUse — WARD audit + session size
**File:** `~/.claude/hooks/post-tool-use.sh` (deployed from `~/rtgf-ai-stack/hooks/`)
**Fires:** After every tool call
**Can block:** No (observe-only)
**What it does:** Logs tool name, output preview (500 chars), output length to audit JSONL.

**File:** `~/.claude/hooks/check-session-size`
**Fires:** After every tool call (registered separately as PostToolUse)
**Can block:** No
**What it does:** Monitors session JSONL size. Warns Claude at 4MB/1000 lines (notice), 8MB/2000 lines (wrap warning). Throttled to one warning per 10 minutes per session. Tells Claude to suggest `/wrap-session`.

### Stop — notify when Claude is done
**File:** `~/.claude/hooks/notify-ready`
**Fires:** When Claude finishes a response and stops
**What it does:** Fires Windows toast notification ("Claude Ready: <session-name>") + terminal bell. Uses PowerShell WinRT via Windows Terminal AUMID.

### Notification — approval needed alert
**File:** `~/.claude/hooks/notify-approval`
**Fires:** When Claude needs user approval (permission prompt)
**What it does:** Fires Windows toast + lower-pitch beep (distinguishable from notify-ready tone).

### TaskCompleted — task validation gate
**File:** `~/.claude/hooks/task-completed`
**Fires:** When Claude marks a task complete
**Can block:** Yes (exit 2) — **active blocking**
**Status:** Active. Reads `task_id`, `task_subject`, `session_id` from stdin JSON. Reads task file from disk (`~/.claude/tasks/{session_id}/{task_id}.json`) and checks `metadata.validated: true` before allowing completion.
**Required workflow:** Two separate calls — `TaskUpdate(metadata={'validated': true})` first, then `TaskUpdate(status='completed')`.

### PostToolUse (2) — tab title update (Stop also)
**File:** `~/.claude/hooks/set-tab-title`
**Fires:** On Stop and optionally UserPromptSubmit
**What it does:** Sets Windows Terminal tab title to session common name. Uses `!` prefix when Claude is idle (Stop). Resolves name from sessions-index or slug fallback.

---

## Codex Hooks — Sidecar Framework

Codex exposes a single `notify` hook fired after each completed agent turn. A sidecar router handles fan-out to multiple scripts.

**Config** (`~/.codex/config.toml`):
```toml
notify = ["/bin/bash", "/home/<user>/security/codex-hooks/notify-router.sh"]
```

**Router** (`codex-hooks/notify-router.sh`):
- Logs raw payload → `codex-hooks/logs/notify-events.jsonl`
- Normalizes event type (falls back to `agent-turn-complete`)
- Fans out to all executables in `hooks.d/all/` then `hooks.d/<event>/`

**Active hooks:**
- `hooks.d/all/00-log-summary.sh` — summary log to `notify-summary.jsonl`
- `hooks.d/all/10-terminal-bell.sh` — terminal bell on turn complete

**Planned:**
- Windows toast notification (parity with Claude Code `Stop` hook)
- Slack/webhook alert
- Filter/routing rules (trigger specific hooks only for certain messages)

**Coverage gap vs Claude Code:** No pre-tool intercept, no per-tool blocking, no task lifecycle events. Turn-complete is the only hook point.

---

## Security CLI Commands

All in `~/.local/bin/` (on PATH).

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `claude-security-bootstrap.sh` | Initial security setup for a new WSL instance | First-time setup: configures `permissions.deny` in settings.json, creates `~/.ssh/github-apps/`, installs helpers |
| `claude-security-export.sh` | Package bootstrap for transfer to another WSL | When provisioning a new WSL instance — creates tarball with bootstrap + README |
| `claude-security-verify.sh` | Audit current security config | Spot-check that deny rules are in place, no keys in home dir, helper scripts installed |
| `claude-protect-project.sh` | Add per-project `permissions.deny` rules | Run in any sensitive project directory before starting Claude Code work |
| `wsl-audit` | Platform health + Docker governance | Before starting Docker services; `/status` via Telegram for quick health; cron for scheduled reports |
| `showclaude` | Session index + audit | See all sessions across instances, find orphans, review session history |
| `wsl-audit events N` | Review JSONL security event log | When investigating a CRIT event or reviewing recent alerts |

**Read the audit log directly:**
```bash
# Today's audit log
cat ~/.claude/audit/$(date -u +%Y-%m-%d).jsonl | python3 -m json.tool | less

# Blocked events only
grep '"blocked":true' ~/.claude/audit/$(date -u +%Y-%m-%d).jsonl | python3 -m json.tool

# All events for a session
grep '"session_id":"<first-8-chars>"' ~/.claude/audit/*.jsonl
```

---

## Available Skills (Claude Code)

Skills are invoked with the Skill tool or `/skill-name` shorthand. Canonical source: `~/.config/skillshare/skills/`. Synced to Claude/Codex/Gemini via `skillshare sync`.

| Skill | When to Use |
|-------|-------------|
| `session-retrospective` | Delta-mode by default (since last retro); full archive recursion on first run. Writes to `C:/temp/retrospectives/{session-name}.md`. Pass `--full` to force rebuild. |
| `wrap-session` | Oversized or completed session — generates handoff doc + boot sequence, backfills predecessor chain, archives current session |
| `wrap-other-session` | Absorb another session's context + tasks into this one; writes chain entry to `.session-chain.json` |
| `session-intent` | Orientation check — states current session purpose, active goals, pending work |
| `wsl-session-handoff` | Moving work between WSL instances — creates deterministic handoff package |
| `session-name` | Show the current session's common name and 8-char ID |
| `rename-session` | Rename the current session in the index |
| `grab-clipboard-image` | Save Windows clipboard image to WSL and read it back |

---

## Security Roadmap — Phase by Phase

```
Phase 2  ✅  WARD hooks              Active now
             Permissions deny        Active now
             LiteLLM virtual keys    Active now
             wsl-audit event log     Active now

Phase 3  🔄  ctx-search + CHRONICLE  Active (knowledge layer)
             Telegram WARD alerts    ✅ Active (2026-03-06)

Phase 4  ⬜  Telegram gate           Command authorization, admin escalation
             Mem0                    Replaces flat .chat-history.json

Phase 5  ⬜  Cedar policies          Declarative RBAC — allow/deny by role
             BATON                   Inter-session handoff

Phase 6  ⬜  Leash / eBPF            KERNEL-LEVEL enforcement
                                     Only viable after Cedar (Phase 5) is stable
                                     Controls: syscall filtering, network policy
                                     Unlocks: unsupervised safe agent operation
```

**Why Phase 6 is gated:** eBPF/Leash enforcement needs a stable policy expression layer (Cedar) to know *what* to enforce. Running an unsupervised agent without kernel enforcement is the gap that drives all of phases 3–5.

---

## Gaps and Immediate Actions

| Gap | Impact | Fix |
|-----|--------|-----|
| ~~WARD Telegram alerts not wired~~ | ~~Blocks are silent on phone~~ | ✅ Fixed 2026-03-06 — token wired in `~/.claude/hooks/ward.env` |
| ~~AI Hub WSL not bootstrapped~~ | ~~resolved~~ | ✅ Fixed 2026-03-06 — WARD hooks installed, permissions.deny added, ward.env wired |
| `ctx/archive/raw/` not gitignored in knowledge repos | Git repo grows unbounded | Add `ctx/archive/raw/` to `.gitignore` in each knowledge repo |
| ~~Hypothesis session auto-prune not built~~ | ~~Old sessions accumulate~~ | ✅ Fixed 2026-03-14 — `prune-hypothesis.js` cron (weekly, 30d stale) |
| ~~task-completed hook passthrough~~ | ~~resolved~~ | Fixed — active blocking confirmed |
| Client WSL instances not audited | Unknown security posture | Run `claude-security-verify.sh` on each instance |

---

## Policy Modification Guide

To add/modify a WARD rule without reinstalling:

```bash
# 1. Edit the deployed policy (takes effect immediately — no restart needed)
nano ~/.claude/hooks/policy/blocked-patterns.json

# 2. Also update the source (keeps repo in sync)
nano ~/rtgf-ai-stack/hooks/policy/blocked-patterns.json

# 3. Commit if it's a meaningful change
cd ~/rtgf-ai-stack && git add hooks/policy/ && git commit -m "security: Update WARD block policy"
```

To temporarily bypass a block (e.g. for a legitimate `rm -rf` of a build dir):
```bash
# Option A: Disable hooks entirely, do the work, re-enable
bash ~/rtgf-ai-stack/hooks/install-hooks.sh --disable
rm -rf ./dist
bash ~/rtgf-ai-stack/hooks/install-hooks.sh

# Option B: Add a scoped allow-list entry above the blocking rule in policy JSON
# (path_patterns with action=allow are checked before block rules)
```

---

## Stack Security Interconnects

How the security layers interact with the rest of the AI Stack:

| Stack Component | Security Touch Point |
|----------------|---------------------|
| **Claude Code** | WARD hooks (pre/post) + permissions.deny |
| **CHRONICLE imports** | Runs as cron — no hook coverage; raw JSONL gitignored in knowledge repos |
| **LiteLLM gateway** | Virtual key auth + budget enforcement + PostgreSQL spend log |
| **Telegram bot** | Admin flag in `config.yaml` gates destructive commands; WARD alerts (when wired) |
| **wsl-audit** | Docker governance + CRIT alerts; mandatory before `docker compose up` |
| **BATON (planned)** | Will need Cedar policies before autonomous cross-session tasks can run safely |
| **Leash/eBPF (planned)** | Final enforcement layer — gates on Cedar being stable |

---

## Related Files

| File | Purpose |
|------|---------|
| `~/rtgf-ai-stack/hooks/policy/blocked-patterns.json` | Source of truth for WARD rules (commit changes here) |
| `~/.claude/hooks/ward.env` | Runtime config — Telegram token, chat ID |
| `~/.claude/audit/YYYY-MM-DD.jsonl` | Daily audit log — all tool calls |
| `~/rtgf-ai-stack/hooks/install-hooks.sh` | Deploy/update/disable WARD |
| `~/rtgf-ai-stack/docs/architecture/security-layers.md` | MkDocs version of this (diagrams, public-facing) |
| `~/security/AGENT_GUIDANCE.md` | Security session agent instructions |
| `~/security/HANDOFF-security-2026-02-25.md` | Last security session wrap |
| `~/rtgf-ai-stack/interface/.env` | Bot runtime config — Telegram token, gateway URL, LiteLLM keys (AI Hub WSL) |
