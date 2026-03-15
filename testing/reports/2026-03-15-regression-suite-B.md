# Regression Test Report — Suite B (af7d5d1 fixes)
**Date:** 2026-03-15
**Commit:** `af7d5d1` — fix: address edge case bug reports
**Tester:** AI Stack Testing Session

---

## Results

| Bug | Fix Claimed | Regression Result |
|-----|-------------|------------------|
| WARD-EC-001 | Pattern anchored `(?m)^\s*`, action → warn | ✅ PASS |
| CHR-003 | Dedup by platform_session_id in rcm-import.js | ❌ FAIL — dedup check broken |
| CHR-004 | Resolves as side-effect of CHR-003 | ❌ FAIL — blocked on CHR-003 |
| MSG-EC-003 | 4-char random hex suffix via send-message | ✅ PASS |

---

## WARD-EC-001 — PASS

Python heredoc containing credential path strings (`/etc/passwd`, `/etc/shadow`, `id_rsa`) now executes without being blocked. Audit log confirms `blocked=False`, `severity=info`. The false positive is gone.

---

## CHR-003 — FAIL (dedup check broken)

Re-importing `b2de9cb3` still creates a new dated entry. The `findExistingImport()` function uses grep with single quotes around the ID:

```js
`grep -rl "platform_session_id: '${platformSessionId}'" "${canonicalRoot}"`
```

But the actual YAML frontmatter has no quotes:
```yaml
platform_session_id: b2de9cb3-7995-46a1-bd20-e86d20760bed
```

Grep with quotes: **0 matches**. Grep without quotes: **6 matches**.

The dedup check always returns null → import always proceeds → duplicates still accumulate.

**Fix needed:** Remove the single quotes from the grep pattern:
```js
`grep -rl "platform_session_id: ${platformSessionId}" "${canonicalRoot}"`
```

---

## CHR-004 — FAIL (blocked on CHR-003)

Cannot verify until CHR-003 is actually fixed.

---

## MSG-EC-003 — PASS

Two rapid `send-message` calls produced distinct filenames:
```
test-msg-0czl-9a24.md
test-msg-0czl-dd44.md
```
Both delivered to mailbox, both consumed correctly. Collision prevention working.

Also confirmed: `send-message` is a proper script at `~/.local/bin/send-message` with a sent-tracking feature (writes `.meta` files to sender's `sent/` directory — new capability not previously tested).

---

## Summary

2/4 fixes verified. CHR-003 has a one-line fix needed (remove single quotes from grep pattern). Filed to AI Stack session.
