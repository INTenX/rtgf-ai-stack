# Security & Code Quality Audit Report
**Date:** 2026-03-15
**Scope:** All AI Stack components — WARD, Inter-Session Messaging, CHRONICLE, LiteLLM Gateway, Telegram Interface
**Tester:** AI Stack Testing Session

---

## Summary

| Severity | Count |
|----------|-------|
| High | 2 |
| Medium | 4 |
| Low / Info | 3 |

All findings are local or inter-session attack surface. No internet-exposed vulnerabilities found.

---

## HIGH — Command Injection

### AUDIT-001 — `loreImport()` — Unsanitized shell interpolation
**File:** `interface/lib/tools.js:55-56`
**Severity:** High

```js
const cmd = target
  ? `ctx-import --source ${target} --platform claude-code`
  : 'ctx-import --auto'
return execSync(cmd, ...)
```

`target` is interpolated directly into a shell command string. Any string containing shell metacharacters (`;`, `&&`, `$(...)`, backticks) would execute arbitrary commands. The current call site (bot.js:499) invokes `loreImport()` with no argument (auto mode only), so the vulnerable path is not currently reachable via Telegram. However, the function API exposes the injection surface if a future caller passes user-controlled input.

**Fix:** Pass arguments as an array to `execSync` with `{ shell: false }`, or sanitize `target` to a valid file path before use.

---

### AUDIT-002 — `gitAdd()` — Unquoted path list passed to shell
**File:** `chronicle/tools/lib/git-operations.js:87-88`
**Severity:** High

```js
const fileList = Array.isArray(files) ? files.join(' ') : files;
execSync(`git add ${fileList}`, { cwd: rcmRoot, stdio: 'inherit' });
```

File paths are joined with spaces and interpolated without quoting. Paths with spaces or special characters (e.g., `$(command)`) are treated as multiple arguments or executed as shell code. The `flowTransition()` caller passes internally-constructed paths, so this is not immediately exploitable, but any future caller passing external input is at risk.

**Fix:** Use `execFileSync('git', ['add', ...files])` to avoid shell parsing entirely.

---

## MEDIUM — Input Validation / Defense Gaps

### AUDIT-003 — `check-mailbox` — ACK write path derived from untrusted header
**File:** `~/.local/bin/check-mailbox:47-61`
**Severity:** Medium

```bash
FROM_RAW="$(grep -m1 '^\*\*From:\*\*' "$f" | sed 's/\*\*From:\*\* *//')"
FROM_WSL="$(echo "$FROM_RAW" | sed ...)"
# ...
cat > "${FROM_WSL}/${ACK_NAME}" <<ACKEOF
```

The ACK write destination is derived from the `**From:**` header in the received message. A malicious sender could set `From:` to any path — for example, `/mnt/c/temp/messages/../../../home/cbasta/` — and cause ACK files to be written outside the messages directory. The guard `[[ -d "$FROM_WSL" ]]` requires the target to be an existing directory, which limits impact but does not prevent writes to directories the sender intentionally controls.

**Fix:** Validate that `FROM_WSL` is prefixed with `/mnt/c/temp/messages/` before using it as a write destination.

---

### AUDIT-004 — `rcm-flow.js` — `yaml` variable used but never imported
**File:** `chronicle/tools/cli/rcm-flow.js:30`
**Severity:** Medium

```js
import { flowTransition, isGitRepo, initGitIfNeeded } from '../lib/git-operations.js';
// ...
return yaml.load(content);  // ← yaml is undefined
```

`loadConfig()` calls `yaml.load()` but `yaml` is never imported. This function is not called during normal `promote` / `list` / `status` operations (verified by testing), so it is a latent crash waiting to be triggered when config loading is needed. If future code paths call `loadConfig()`, the ReferenceError will crash the process.

**Fix:** Add `import yaml from 'js-yaml'` (or equivalent) at the top of `rcm-flow.js`.

---

### AUDIT-005 — `gitCommit()` — Commit message embedded in shell string
**File:** `chronicle/tools/lib/git-operations.js:108`
**Severity:** Medium

```js
const cmd = `git commit -m "${commitMsg}"`;
execSync(cmd, { cwd: rcmRoot, stdio: 'inherit' });
```

`commitMsg` is embedded inside double-quotes in a shell string. If `commitMsg` contains a double-quote, the shell command breaks. While current callers construct `commitMsg` from controlled values (state names and session IDs), this is fragile.

**Fix:** Use `execFileSync('git', ['commit', '-m', commitMsg])`.

---

### AUDIT-006 — `addSessionNote()` — Note content appended to file without validation
**File:** `chronicle/mcp-server.js:293-294`
**Severity:** Medium (context-dependent)

```js
const noteBlock = `\n\n---\n**Agent note** (${timestamp}):\n${note}\n`;
await fs.writeFile(session.file_path, raw + noteBlock, 'utf8');
```

Note content is appended verbatim to a Markdown file. If the MCP server is accessible to untrusted agents (future multi-agent scenarios), arbitrary content including YAML frontmatter delimiters (`---`), script tags, or LLM prompt-injection text could be injected. Currently the MCP server is local-only and restricted to Claude Code.

**Fix:** For defense in depth, strip or escape `---` at the start of lines in note content to prevent frontmatter corruption.

---

## LOW / INFO

### AUDIT-007 — `.env` files contain plaintext secrets (not committed)
**Severity:** Low (local disk only)

`interface/.env` contains `TELEGRAM_TOKEN` and `LITELLM_MASTER_KEY`. `gateway/.env` contains `LITELLM_MASTER_KEY` and `POSTGRES_PASSWORD`. Both files are properly gitignored and are NOT tracked in the repository.

**Risk:** Secrets are readable by any process running as `cbasta` on INTenXDev or Ubuntu-AI-Hub. No change needed unless additional users or processes share the environment.

**Note:** The audit initially flagged these as "committed secrets" — this was incorrect. Files are gitignored.

---

### AUDIT-008 — `runCtxSearch()` — `JSON.stringify` correctly sanitizes query (no issue)
**File:** `interface/lib/chronicle.js:15`

```js
`node ${CTX_SEARCH} ${JSON.stringify(query)} --format json --recent ${limit}`
```

`JSON.stringify(query)` produces a properly double-quoted string, preventing whitespace splitting. `limit` is a numeric default. No injection risk in current form.

---

### AUDIT-009 — LiteLLM Gateway — No network-layer binding concern
**File:** `gateway/config.yaml`

The gateway config does not explicitly bind to `0.0.0.0`; it relies on Docker port mapping (`4000:4000`). The service is accessible within Ubuntu-AI-Hub's local network. No external exposure unless port-forwarded. Acceptable for current architecture.

---

## No Bugs Filed From

- **WARD hook** (`hooks/pre-tool-use.sh`) — No injection vectors found. Policy file is JSON-parsed, not eval'd. Audit log writes are append-only with controlled fields. Telegram alert uses `requests.post()` with a data dict, not shell.
- **`send-message` script** — Message construction uses quoted heredoc; filename uses controlled timestamp + hex suffix. No injection path found.
- **`wslAudit()` call in bot.js (cron jobs)** — `job.args[0]` is passed as the subcommand. Cron jobs are defined in `config.yaml` (not user-editable via Telegram), so this is not user-controlled at runtime.

---

## Bugs Filed

| ID | Severity | Component | File | Description |
|----|----------|-----------|------|-------------|
| AUDIT-001 | High | Interface | `interface/lib/tools.js:55` | `loreImport()` — unsanitized `target` arg in shell interpolation |
| AUDIT-002 | High | CHRONICLE | `chronicle/tools/lib/git-operations.js:88` | `gitAdd()` — file paths joined without quoting |
| AUDIT-003 | Medium | Messaging | `~/.local/bin/check-mailbox:61` | ACK write destination derived from untrusted From: header |
| AUDIT-004 | Medium | CHRONICLE | `chronicle/tools/cli/rcm-flow.js:30` | `yaml` variable used but never imported — latent crash |
| AUDIT-005 | Medium | CHRONICLE | `chronicle/tools/lib/git-operations.js:108` | Commit message in shell string — fragile double-quote handling |
| AUDIT-006 | Medium | CHRONICLE | `chronicle/mcp-server.js:293` | Note content appended without validation |

---

## Recommendations (Priority Order)

1. **Immediately:** Fix AUDIT-002 (`gitAdd`) — use `execFileSync` to prevent path injection. Low-effort, high-impact.
2. **Soon:** Fix AUDIT-004 (`yaml` import) — add the missing import before this becomes a live crash.
3. **Soon:** Fix AUDIT-001 (`loreImport`) — refactor to use array-form exec when `target` path support is needed.
4. **Planned:** Fix AUDIT-003 (`check-mailbox`) — add `FROM_WSL` prefix validation when BATON automated dispatch is built.
5. **Backlog:** Fix AUDIT-005/AUDIT-006 for defensive hygiene as CHRONICLE matures.
