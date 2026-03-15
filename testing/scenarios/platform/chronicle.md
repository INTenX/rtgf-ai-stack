# Scenario Suite — CHRONICLE
**Component:** CHRONICLE (`chronicle/`)
**Status:** Partially tested — flow promotion bug filed (FAIL, 2026-03-14)

---

## Context

CHRONICLE is the session archival and knowledge management layer. It ingests Claude Code sessions, manages knowledge flow states (hypothesis → codified → validated → promoted), and serves a search interface (ctx-search, MCP server). It is the primary memory/RAG layer for the stack.

Real-world use cases this maps to:
- Persistent session memory (retain context across conversations)
- Knowledge flow management (promote facts as confidence grows)
- Semantic retrieval (find relevant past sessions for current query)
- Citation integrity (every recalled fact should be sourceable)
- Cold start handling (newly imported sessions available for search)

---

## Scenario 1 — Session Import (Well-Formed)
**Description:** Import a valid JSONL session file; verify it appears in search.
**Skill:** `skills/platform/chronicle-import.md`
**Input:** A well-formed `.jsonl` session file with known content
**Pass Criteria:**
- Import completes without error
- Session appears in `intenx-knowledge/` with correct frontmatter
- `flow_state: hypothesis` in frontmatter
- `ctx-search` returns the session for a query matching its content

---

## Scenario 2 — Session Import (Missing Fields)
**Description:** Import a session with incomplete frontmatter; graceful handling expected.
**Skill:** `skills/platform/chronicle-import.md`
**Input:** JSONL file missing `platform` or `cwd` fields
**Pass Criteria:**
- Import does not crash
- Partial frontmatter written (no silent data loss)
- Tool outputs a warning or error, not silent success
- Session NOT indexed with corrupted fields

---

## Scenario 3 — Knowledge Flow Promotion (hypothesis → codified)
**Description:** Promote a session with tags; verify frontmatter updated.
**Input:** `rcm-flow.js promote --session <id> --to codified --tags "testing,platform"`
**Pass Criteria:**
- `flow_state:` in frontmatter updates to `codified`
- `tags:` in frontmatter reflects passed tags
- File moved to `rcm/flows/codified/` via `git mv`
- Git commit created
**Note:** This was FAIL on 2026-03-14. Regression test — confirm fix before marking PASS.

---

## Scenario 4 — Orphan Detection
**Description:** Sessions not yet imported are detected and surfaced.
**Input:** Place a `.jsonl` file in an expected source dir without importing; run orphan detection
**Pass Criteria:**
- Orphan detected and listed
- Import command suggested or auto-run
- After import, no longer listed as orphan

---

## Scenario 5 — ctx-search Relevance
**Description:** Semantic search returns relevant sessions for a known query.
**Input:** Query: "LiteLLM gateway setup" (after importing a session containing this topic)
**Pass Criteria:**
- Imported session appears in top 3 results
- Result includes session ID, date, and summary
- Irrelevant sessions ranked lower (no false positives at rank 1)

---

## Scenario 6 — MCP Server Tool Coverage
**Description:** All four MCP tools return correct results.
**Input:** Call `search_sessions`, `get_session`, `get_patterns`, `add_session_note` in sequence
**Pass Criteria:**
- `search_sessions("WARD hooks")` returns ≥1 relevant result
- `get_session(<id>)` returns full session metadata
- `get_patterns` returns a non-empty list
- `add_session_note(<id>, "test note")` persists without error; visible on re-read

---

## Scenario 7 — Memory Contradiction Handling
**Description:** Two sessions contain contradicting facts; search surfaces both.
**Input:** Import session A ("LiteLLM port is 4000") and session B ("LiteLLM port is 8080"); query "what port does LiteLLM use?"
**Pass Criteria:**
- Both sessions returned in results
- Results include date (recency sortable)
- System does not silently pick one as authoritative

---

## Scenario 8 — Chronicle Import Skill (Platform Skill)
**Description:** Run the `chronicle-import` skill; verify output is correct import commands.
**Skill:** `skills/platform/chronicle-import.md`
**Pass Criteria:**
- Output contains correct `rcm-import.js` command with proper flags
- No "Cole" or internal names in output
- Edge case handled: skill given a session ID that does not exist

---

## Status

| Scenario | Status | Report |
|----------|--------|--------|
| 1 — Import well-formed | **PASS** | `reports/2026-03-14-chronicle-suite-A.md` |
| 2 — Import missing fields | Pending | Needs malformed JSONL test fixture |
| 3 — Flow promotion regression | **FAIL** | CHR-001 unpatched — `reports/2026-03-14-chronicle-suite-A.md` |
| 4 — Orphan detection | **PASS** | 31 orphans found correctly |
| 5 — ctx-search relevance | **PASS** | 36 results, top result relevant |
| 6 — MCP tool coverage | **PASS** | All 4 tools registered and responding |
| 7 — Contradiction handling | Pending | Needs conflicting session test fixtures |
| 8 — Import skill | **PASS** | Professional, correct; minor doc gap noted |
