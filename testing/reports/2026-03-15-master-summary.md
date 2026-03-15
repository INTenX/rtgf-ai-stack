# AI Stack Testing — Master Summary
**Generated:** 2026-03-15
**Runs:** Run 1 (2026-03-14) + Edge Cases + Regressions (2026-03-15)
**Tester:** AI Stack Testing Session (`stack-testing`)

---

## What This Is

The AI Stack is a set of platform components that run on INTenXDev (this machine) and Ubuntu-AI-Hub (remote). This document summarizes what each component does, what was tested, and what was found.

---

## Component Map

```
User → Telegram Bot (Ubuntu-AI-Hub)
           ↓
    LiteLLM Gateway (Ubuntu-AI-Hub, port 4000)
           ↓ routes to
    Anthropic API  OR  Ollama (local models, Windows/AMD)
           ↓
    CHRONICLE (session memory + knowledge search)
           ↓ all tool calls protected by
    WARD (security hooks, pre-tool-use)
           ↓ sessions communicate via
    Inter-Session Messaging (shared Windows filesystem)
           ↓ task handoff via
    BATON (planned — not yet built)
```

---

## WARD — Security Hooks

**What it does:** Intercepts every Claude Code tool call before it executes. Blocks dangerous operations, logs everything to an audit file, sends Telegram alerts on blocks.

| # | Test | What We Did | Result |
|---|------|-------------|--------|
| 1 | rm -rf block | Tried `rm -rf /tmp/...` | ✅ PASS — blocked, audit entry written |
| 2 | Safe command passes | Ran `ls /tmp` | ✅ PASS — no block, no noise |
| 3 | Audit log fields | Checked a block entry for required fields | ✅ PASS — all 7 fields present |
| 4 | Credential file (Read tool) | Tried to `Read /etc/passwd` | ✅ PASS — blocked |
| 5 | Policy deployment | Ran `install-hooks.sh --dry-run` | ✅ PASS — all steps correct |
| 6 | Hook latency | Measured overhead across 45 tool calls | ✅ PASS* — avg 143ms, max 418ms |
| 7A | Audit review skill | Ran skill commands against a log with blocks | ✅ PASS — correct output, professional |
| 7B | Audit review skill (clean) | Ran skill on a log with no blocks | ✅ PASS — no false alarms |
| 8 | Bash access to cred files | Tried `cat /etc/passwd` via Bash | ❌ FAIL → **WARD-001** |

**WARD-001 (fixed):** `cat /etc/passwd` via Bash was not blocked — the path protection only covered the Read/Write/Edit tools, not shell commands. Fix: added `bash-credential-file` pattern to policy.

**Edge case — WARD-EC-001 (new, unfixed):** After the fix, any Bash heredoc that *contains* a credential path as a string gets blocked — even test scripts and documentation. The pattern is too broad; it doesn't distinguish between actually accessing a file and mentioning a filename in code. Needs regex anchoring to line-start.

---

## Inter-Session Messaging

**What it does:** File-based message passing between Claude Code sessions. Sessions write `.md` files to each other's mailboxes on a shared Windows filesystem path (`/mnt/c/temp/messages/`). The `check-mailbox` script reads, displays, archives messages, and writes ACKs back to the sender.

| # | Test | What We Did | Result |
|---|------|-------------|--------|
| 1 | Delivery within SLA | Wrote a message, confirmed it appeared | ✅ PASS — instant (filesystem write) |
| 2 | ACK on consumption | Consumed a message, checked sender's mailbox for ACK | ✅ PASS* — ACK delivered, but From: malformed |
| 3 | Silent when empty | Ran check-mailbox on empty mailbox | ✅ PASS — no output, exit 0 |
| 4 | Concurrent writes | Wrote two messages in rapid succession | ✅ PASS — both files intact, unique names |
| 5 | Malformed message | Wrote a file with no headers, consumed it | ✅ PASS* — no crash, but silently consumed |
| 6 | Cross-WSL visibility | Wrote from INTenXDev to SensitDev path, confirmed visible | ✅ PASS |
| 7 | Recipient unavailable | Tried to write to non-existent mailbox directory | ✅ PASS — clean failure, no auto-creation |

**MSG-001 (fixed):** ACK `From:` header showed literal `${WSL_INSTANCE}` instead of the actual instance name. Fix: corrected heredoc escaping (`\\${VAR}` → `\` + expanded variable).

**MSG-002 (fixed):** Malformed messages (no `**From:**` header) were consumed without any indication. Fix: check-mailbox now prints a WARN to stderr.

**Edge case — MSG-EC-003 (new, unfixed):** Two messages written in the same second produce identical filenames. The second write silently overwrites the first. Fix: append a random hex suffix to filenames.

---

## LiteLLM Gateway

**What it does:** Proxy that routes all LLM requests to the right backend (Anthropic, OpenAI, or local Ollama models). Tracks spend per virtual key in PostgreSQL, enforces budget caps, controls which models each key can access.

| # | Test | What We Did | Result |
|---|------|-------------|--------|
| 1 | Basic routing | Sent a request with the default virtual key | ✅ PASS* — gateway routes correctly; Anthropic key expired |
| 2 | Budget cap enforcement | Created a key with max_budget=0, made a request | ❌ FAIL → **GW-001** |
| 3 | Ollama fallback | Requested `llama3.2:3b`, confirmed Ollama responded | ✅ PASS — "OLLAMA OK" returned |
| 4 | Spend in PostgreSQL | Queried `/spend/logs` after requests | ✅ PASS — entries present with model, tokens, timestamp |
| 5 | Invalid key rejected | Sent request with a bad API key | ✅ PASS — 401 with clear error |
| 6 | Key setup skill | Evaluated the `litellm-key-setup` skill content | ✅ PASS — correct, professional, no internal names |

**GW-001 (documented, not a code bug):** Budget caps set in dollars (`max_budget`) have no effect on Ollama models because local models cost $0. The spend never exceeds the cap because spend = $0 always. Fix: use `tpm_limit` (tokens per minute) and `max_parallel_requests` to rate-limit local model usage. Skill documentation updated.

**GW-002 (infrastructure, not a code bug):** The Anthropic API key in the gateway is expired. All `claude-sonnet` and `claude-haiku` routes return 401. Ollama routes unaffected. Key needs to be refreshed in `compose/gateway.env`.

**Edge cases (all PASS):** Unknown model alias → helpful error. Missing auth header → 401. Malformed JSON → parse error. Gateway handles all gracefully.

---

## CHRONICLE

**What it does:** Session archival and knowledge management. Imports Claude Code sessions into a knowledge repository, manages their lifecycle (hypothesis → codified → validated → promoted), and provides search via `ctx-search` and an MCP server that other agents can call.

| # | Test | What We Did | Result |
|---|------|-------------|--------|
| 1 | Import well-formed session | Imported a real session JSONL | ✅ PASS — correct frontmatter, git commit, correct directory |
| 2 | Import with missing fields | (pending — needs test fixture) | ⏸ Pending |
| 3 | Flow promotion regression | Re-ran the original failing test after fix | ✅ PASS — `flow_state` and `tags` now update correctly |
| 4 | Orphan detection | Ran `rcm-find-orphans.js` | ✅ PASS — found 31 unimported sessions |
| 5 | ctx-search relevance | Searched for "LiteLLM gateway" | ✅ PASS — 36 results, top result relevant |
| 6 | MCP server tool coverage | Called all 4 MCP tools via stdin | ✅ PASS — all respond with correct structure |
| 7 | Contradiction handling | (pending — needs conflicting session fixtures) | ⏸ Pending |
| 8 | Chronicle import skill | Evaluated the `chronicle-import` skill content | ✅ PASS — correct, professional |

**CHR-001 (fixed):** The original bug — `rcm-flow.js promote` moved the file but didn't update `flow_state:` or `tags:` in the YAML frontmatter. Root cause: the flow directories use symlinks pointing to canonical files; the fix staged both the symlink and the resolved canonical file.

**CHR-003 (new, unfixed):** Re-importing the same session JSONL creates a new dated entry instead of updating or skipping. Session `b2de9cb3` now has 6 copies in the knowledge base. Fix: check for existing `platform_session_id` before importing.

**CHR-004 (new, unfixed):** Promoting a session that's already in the target state (double-promote) creates a second dated entry in that state. Root cause: multiple hypothesis symlinks exist from CHR-003 duplicates. Fix CHR-003 → CHR-004 resolves.

---

## Skills (Platform)

Three operational skills were tested as part of the component runs:

| Skill | Scenario A | Scenario B | Result |
|-------|-----------|-----------|--------|
| `ward-audit-review` | Log with blocked events | Clean log | ✅ PASS both |
| `litellm-key-setup` | Standard key | Budget-capped key | ✅ PASS — updated with Ollama rate-limit guidance |
| `chronicle-import` | Full import workflow | — | ✅ PASS |

---

## Open Bugs

| ID | Severity | Component | Description | Status |
|----|----------|-----------|-------------|--------|
| WARD-EC-001 | Medium | WARD | Bash heredocs containing credential path strings as text trigger false positive blocks | Open |
| CHR-003 | Medium | CHRONICLE | Duplicate imports: same session imported multiple times creates multiple entries | Open |
| CHR-004 | Medium | CHRONICLE | Double-promote creates duplicate entries in target flow state | Open |
| MSG-EC-003 | Medium | Messaging | Same-second filename collision silently overwrites message | Open |
| GW-002 | High (infra) | Gateway | Anthropic API key expired — cloud model routes return 401 | Open (manual key refresh needed) |

---

## What's Next

| Component | Status | Next Step |
|-----------|--------|-----------|
| WARD | ✅ Approved (1 open edge case) | Wait for WARD-EC-001 fix, then retest |
| Messaging | ✅ Approved (1 open edge case) | Wait for MSG-EC-003 fix, then retest |
| LiteLLM Gateway (Ollama) | ✅ Approved | Refresh Anthropic key (GW-002) |
| LiteLLM Gateway (Cloud) | ❌ Blocked | Anthropic key refresh required |
| CHRONICLE (search/MCP/import) | ✅ Approved | — |
| CHRONICLE (flow promotion) | ✅ Approved (post-fix) | Fix CHR-003/004 deduplication |
| Telegram Interface | ⏸ Pending | Needs live bot test (Ubuntu-AI-Hub access) |
| BATON | ⏸ Not built | — |
| End-to-End | ⏸ Gated | Waiting on GW-002 (Anthropic key) |
