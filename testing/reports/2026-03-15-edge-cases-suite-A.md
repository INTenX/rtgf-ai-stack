# Edge Case Test Report — All Components — Suite A
**Date:** 2026-03-15
**Tester:** AI Stack Testing Session
**Scope:** Post-fix regression validation + edge case coverage across WARD, Messaging, LiteLLM Gateway, CHRONICLE

---

## Regression Results (Run 1 Bug Fixes)

| Bug | Fix | Regression Result |
|-----|-----|------------------|
| WARD-001: Bash credential access | Added `bash-credential-file` policy pattern | ✅ PASS — `cat /etc/passwd` blocked via Bash |
| CHR-001: Flow promotion frontmatter | `realpathSync` + stage canonical file | ✅ PASS — `flow_state` + `tags` now updated |
| MSG-001: ACK From: unexpanded vars | `\\${VAR}` in heredoc | ✅ PASS — ACK From: now shows correct path |
| MSG-002: Malformed message silent | WARN to stderr when no From: header | ✅ PASS — Warning output confirmed |
| GW-001: Budget cap docs | Added `tpm_limit` / `max_parallel_requests` guidance | ✅ PASS — Documentation update (no runtime test needed) |

All 5 bug fixes verified. Regression suite: **5/5 PASS**.

---

## WARD Edge Cases

### WARD-EC-1 — False Positive: Credential Path Strings in Python Heredocs
**Result: FAIL (new finding)**

A Python script passed as a bash heredoc was blocked when the script source contained credential-like path strings as literal content (e.g., testing the policy itself).

**Reproduction:**
```bash
python3 << 'PYEOF'
# ... code containing the string "etc/shadow" or "id_rsa" ...
PYEOF
```

The `bash-credential-file` pattern matches against the entire Bash `command` field, including all content of inline heredocs. The pattern uses `re.DOTALL` so it spans newlines. Any Python/bash script that mentions a credential path as a string — for testing, documentation, or example purposes — is blocked.

**Impact:** Medium. Affects writing test harnesses, policy documentation scripts, or any code that processes credential-related paths programmatically. Legitimate use cases like "write a script that finds orphaned key files" would be blocked.

**Recommendation:** Add a negative lookahead for quoted strings and comments, or limit the pattern to match only command invocations at the start of a line:
```
^\\s*(cat|head|tail|...)\s+...
```
Or use `re.MULTILINE` and anchor to line start so it only matches actual command invocations, not strings inside scripts.

---

### WARD-EC-2 — Pattern Boundary: --force-with-lease Correctly Passes
**Result: PASS**

The `git-force-push` pattern correctly uses `(?!-with-lease)` negative lookahead. `git push --force-with-lease` is not blocked; `git push --force origin main` is blocked.

---

### WARD-EC-3 — rm -rf Buried in Pipe Chain
**Result: PASS** (verified via policy file analysis)

`echo start && rm -rf /tmp/test` → blocked by `rm-rf` pattern (DOTALL mode catches it).

---

### WARD-EC-4 — git clean -n (dry-run safe)
**Result: PASS**

The `git-clean-force` pattern `git\s+clean\s+-[a-zA-Z]*[fF]` matches `-f` variants but not `-n`. `git clean -n` is not blocked.

---

## Messaging Edge Cases

### MSG-EC-1 — Large Message (>10KB)
**Result: PASS**

12KB message consumed and archived without truncation. ACK written correctly. No crash.

---

### MSG-EC-2 — Unicode Content
**Result: PASS**

Message with Japanese, Arabic, emoji, and mathematical symbols (`∑∂∫`) consumed and displayed correctly via `cat`. No encoding corruption observed on the WSL-Windows shared filesystem path.

---

### MSG-EC-3 — Filename Collision (Same-Second Writes)
**Result: FAIL (confirmed finding)**

Two writes to the same mailbox within <1 second with the same filename overwrote each other. The second write silently replaced the first — no error, no warning, 1 message received instead of 2.

**Impact:** In practice, this requires two simultaneous tool calls which is uncommon for a single session. For automated dispatch (BATON), this could cause silent message loss.

**Recommendation:** Append a random suffix or microsecond timestamp to filenames to prevent collision:
```bash
FNAME="${TS}-${SLUG}-$(head -c4 /dev/urandom | xxd -p).md"
```

---

### MSG-EC-4 — ACK Idempotency (consuming already-consumed message)
**Result: N/A** — Messages are archived on consume, so re-running check-mailbox on empty mailbox is the idempotency test. Already confirmed PASS in Scenario 3.

---

## LiteLLM Gateway Edge Cases

### GW-EC-1 — Unknown Model Alias
**Result: PASS**

Request with `model: "nonexistent-model-xyz"` returns:
```
"Invalid model name passed in model=nonexistent-model-xyz. Call /v1/models to view available models."
```
Clear error, actionable guidance, no crash.

---

### GW-EC-2 — Missing Authorization Header
**Result: PASS**

Request without `Authorization` header returns HTTP 401 with `"Authentication Error, No api key passed in."` — correct behavior.

---

### GW-EC-3 — Malformed JSON Payload
**Result: PASS**

Malformed JSON (`{invalid json`) returns:
```
"Invalid JSON payload: unexpected character: line 1 column 2 (char 1)"
```
No crash, clear parse error.

---

## CHRONICLE Edge Cases

### CHR-EC-1 — Duplicate Import (Same JSONL Imported Twice)
**Result: FAIL (new finding — CHR-003)**

Re-importing `b2de9cb3` JSONL a second time created a new dated entry rather than deduplicating. The knowledge base now contains 6 entries for the same `platform_session_id`:

```
2026-03-07_..._b2de9cb3.md  rcm_id=17989ab6
2026-03-08_..._b2de9cb3.md  rcm_id=190b962d
2026-03-09_..._b2de9cb3.md  rcm_id=308f006b
2026-03-12_..._b2de9cb3.md  rcm_id=202d9124
2026-03-14_..._b2de9cb3.md  rcm_id=52c7269d
2026-03-15_..._b2de9cb3.md  rcm_id=dc5d4ddb  ← today's duplicate import
```

**Root cause:** `rcm-import.js` does not check whether a file with the same `platform_session_id` already exists. Each import generates a new `id:` (UUID) and a new dated filename.

**Impact:** Medium. Repeated imports of a long-running session accumulate stale copies. Search returns duplicates for the same session. Knowledge base grows unbounded without explicit cleanup.

**For live sessions (growing JSONL):** Multiple imports may be intentional (each import captures a later snapshot). But the current implementation provides no mechanism to supersede an old import. Recommendation: Add a `--deduplicate` flag that replaces the most recent entry for the same `platform_session_id` rather than creating a new one.

---

### CHR-EC-2 — Double Promote (Re-Promote Already-Promoted Session)
**Result: FAIL (new finding — CHR-004)**

Promoting a session that's already in `codified` to `codified` again produced a second dated symlink in the codified directory. The command reported "hypothesis → codified" (found an older hypothesis symlink) and created `2026-02-27_..._da16c2bc.md` alongside the existing `2026-02-26_..._da16c2bc.md`.

**Root cause:** `rcm-flow.js` searches for the session by ID prefix in the specified source state (`--from hypothesis`). Multiple symlinks for the same session ID exist in hypothesis (from multiple imports of the same session — see CHR-003). The promote command finds and moves them one at a time without checking the target state for existing entries.

**Impact:** Medium. Repeated promotes accumulate duplicate entries in the target flow state. Same root cause as CHR-003 — absence of deduplication by `platform_session_id`.

---

## New Bugs Filed

| Bug | Severity | Component | Description |
|-----|----------|-----------|-------------|
| **WARD-EC-001** | Medium | WARD | False positive: credential path strings in bash heredocs blocked (affects test/doc scripts) |
| **MSG-EC-003** | Medium | Messaging | Filename collision: same-second writes overwrite without error |
| **CHR-003** | Medium | CHRONICLE | Re-import creates duplicate entries instead of deduplicating by `platform_session_id` |
| **CHR-004** | Medium | CHRONICLE | Double-promote creates duplicate entries in target flow state |

---

## Overall Edge Case Summary

| Component | Edge Cases Run | PASS | FAIL |
|-----------|---------------|------|------|
| WARD | 4 | 3 | 1 (WARD-EC-001 false positive) |
| Messaging | 3 | 2 | 1 (MSG-EC-003 filename collision) |
| LiteLLM Gateway | 3 | 3 | 0 |
| CHRONICLE | 2 | 0 | 2 (CHR-003 + CHR-004 deduplication) |
| **Regressions** | **5** | **5** | **0** |
