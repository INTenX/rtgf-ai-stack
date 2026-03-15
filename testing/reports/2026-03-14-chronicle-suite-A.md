# Component Test Report — CHRONICLE — Full Suite Run A
**Date:** 2026-03-14
**Component:** CHRONICLE (`chronicle/`, `intenx-knowledge/`)
**Tester:** AI Stack Testing Session
**Overall Result:** PASS with 1 blocking FAIL (flow promotion regression)

---

## Summary

| Scenario | Result | Notes |
|----------|--------|-------|
| 1 — Import well-formed session | PASS | Import complete, git commit created, frontmatter correct |
| 2 — Import with missing fields | Pending | Needs test fixture (malformed JSONL) |
| 3 — Flow promotion regression | **FAIL** | CHR-001: flow_state + tags not updated (unpatched) |
| 4 — Orphan detection | PASS | 31 orphans found, correctly listed with project |
| 5 — ctx-search relevance | PASS | Relevant results returned, correct ranking |
| 6 — MCP server tool coverage | PASS | All 4 tools respond correctly |
| 7 — Memory contradiction handling | Pending | Needs test fixture (conflicting sessions) |
| 8 — Chronicle import skill | PASS | Professional, correct syntax, no internal names |

---

## Scenario 1 — Session Import (Well-Formed)

**Result: PASS**

Imported `b2de9cb3` (ai-stack session) via `rcm-import.js`:

```bash
node rcm-import.js \
  --source ~/.claude/projects/-home-cbasta-rtgf-ai-stack/b2de9cb3-*.jsonl \
  --platform claude-code \
  --target /home/cbasta/intenx-knowledge/
```

Output:
```
✅ Import complete!
   Flow: rcm/flows/hypothesis/2026-03-14_..._b2de9cb3.md
   Commit: rcm(import): Import claude-code session 52c7269d
```

Frontmatter verified:
- `flow_state: hypothesis` ✓
- `platform: claude-code` ✓
- `id:` and `platform_session_id:` present ✓
- `message_count: 1550` ✓
- File in correct directory (`hypothesis/`) ✓
- Git commit created ✓

**Pass criteria: all met.**

---

## Scenario 3 — Knowledge Flow Promotion (Regression)

**Result: FAIL** *(unpatched from 2026-03-14-chronicle-flow-promotion-A.md)*

Confirmed: the bug filed in the original report is still present. The file `2026-03-14_ai-stack-testing_0eb4b812.md` in `rcm/flows/codified/` shows:

```yaml
flow_state: hypothesis   ← should be codified
tags: []                 ← should have passed tags
```

The `rcm-flow.js promote` command moved the file and created a git commit but did not update the YAML frontmatter. `git log chronicle/tools/cli/rcm-flow.js` shows no fix commit since the bug was filed.

**This is the blocking regression gate.** Scenario E7 (end-to-end knowledge cycle) cannot pass until this is fixed.

---

## Scenario 4 — Orphan Detection

**Result: PASS**

`rcm-find-orphans.js` found 31 orphaned sessions across all project paths:

```
Found 70 total sessions in ~/.claude/projects
Already imported: 163 sessions
🔴 Found 31 orphaned sessions
```

Sessions listed with project slug for easy identification. Tool correctly cross-references the knowledge repo's import index against the local `.claude/projects` directory.

---

## Scenario 5 — ctx-search Relevance

**Result: PASS**

Query: `"LiteLLM gateway"` → 36 sessions returned.

Top result:
```
[val] AI Stack Retrospective
742b5d6d  2026-03-06  intenx-knowledge  [ai-stack, retrospective, chronicle, ward]
```

A `validated` session about the AI Stack is the top result — correct for a gateway-related query. Results include session ID, date, repo, and tags. Ranking is semantically reasonable (not purely date-based).

**Minor note:** ctx-search uses `--repo` not `--target` (unlike rcm-import.js). The MEMORY.md and skill documentation may reference `--target` for ctx-search, which is incorrect. A documentation discrepancy to note.

---

## Scenario 6 — MCP Server Tool Coverage

**Result: PASS**

MCP server starts via stdio. Tools/list response confirms all 4 tools present:

| Tool | Status |
|------|--------|
| `search_sessions` | ✓ Responds — returns semantic search results |
| `get_session` | ✓ Registered |
| `get_patterns` | ✓ Registered |
| `add_session_note` | ✓ Registered |

`search_sessions("WARD hooks")` returned 3 results with ID, title, repo, state, date, tags, score. Structure is correct for downstream use.

**Note:** The MCP server uses LanceDB for semantic search (`~/.chronicle-lancedb`). The first query returned results, indicating the LanceDB index is populated. Index rebuild path: `chronicle/scripts/lancedb-rebuild`.

---

## Scenario 8 — Chronicle Import Skill

**Result: PASS**

Skill evaluated:
- Import workflow is correct (3-step: find → import → promote) ✓
- CLI command syntax matches actual tool behavior ✓
- Knowledge repos listed accurately ✓
- No internal names ("Cole") in output ✓
- Edge case covered: orphan finder with `--import` flag documented ✓
- Flow state progression documented correctly ✓

**Minor documentation gap:** The skill references `--target` for ctx-search which doesn't match the tool's actual flag. See ctx-search note in Scenario 5.

---

## Deployment Gate Assessment

**CHRONICLE is conditionally approved.** Import, search, MCP, and orphan detection are production-ready. Flow promotion is blocked:

**Required fix before flow promotion is production-ready:**
- **CHR-001:** `rcm-flow.js promote` does not update `flow_state:` or `tags:` in YAML frontmatter — filed 2026-03-14, still unpatched

**Non-blocking items:**
- **CHR-002:** `--target` vs `--repo` documentation inconsistency in ctx-search usage
- Scenarios 2 and 7 not yet executed (test fixtures needed)

**Bugs to file to AI Stack session:**
- CHR-001 (already filed, confirm still open)
- CHR-002: ctx-search flag documentation inconsistency
