# Regression Test Report — Suite C (75df69e fix)
**Date:** 2026-03-15
**Commit:** `75df69e` — fix(chronicle): CHR-003 dedup grep pattern — remove spurious single quotes
**Tester:** AI Stack Testing Session

---

## Results

| Bug | Regression Result |
|-----|-----------------|
| CHR-003 — dedup by platform_session_id | ✅ PASS |
| CHR-004 — double-promote blocked | ✅ PASS |

---

## CHR-003 — PASS

Re-importing `b2de9cb3` now skips correctly:

```
⏭️  Already imported — skipping (use --force-reimport to override)
   Existing: .../2026-03-08_..._b2de9cb3.md
```

The grep pattern no longer wraps the ID in single quotes. Dedup check matches the unquoted YAML frontmatter correctly. No new entry created.

---

## CHR-004 — PASS

Attempting to promote a session already in `codified` to `codified` now throws:

```
Error: Invalid transition: codified → codified.
Valid transitions from codified: validated, hypothesis
```

The tool now detects the current flow state and blocks invalid same-state transitions explicitly. No duplicate entry created.

**Note:** Two pre-existing duplicate entries for `da16c2bc` remain in `codified/` from before the fix. These are data artifacts — not a bug in the current code.

---

## Full Bug Resolution Status

| Bug | Filed | Fixed | Verified |
|-----|-------|-------|---------|
| WARD-001 | Run 1 | 87a7809 | ✅ Suite A regression |
| CHR-001 | Run 1 | 87a7809 | ✅ Suite A regression |
| MSG-001 | Run 1 | 87a7809 | ✅ Suite A regression |
| MSG-002 | Run 1 | 87a7809 | ✅ Suite A regression |
| GW-001 | Run 1 | 87a7809 (docs) | ✅ Suite A regression |
| WARD-EC-001 | Edge cases | af7d5d1 | ✅ Suite B regression |
| MSG-EC-003 | Edge cases | af7d5d1 | ✅ Suite B regression |
| CHR-003 | Edge cases | 75df69e | ✅ Suite C regression |
| CHR-004 | Edge cases | 75df69e | ✅ Suite C regression |

**9/9 bugs resolved and verified. GW-002 (Anthropic key — infrastructure) still open.**
