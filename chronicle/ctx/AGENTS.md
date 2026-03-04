# SCOPE - AI Agent Discovery Instructions

**Module:** Context Scope Management (SCOPE)
**Discovery Path:** Deterministic, non-inferential

---

## Purpose

This file provides AI agents (Claude, ChatGPT, Gemini, etc.) with explicit instructions for discovering, importing, managing, and exporting LLM conversation sessions within the SCOPE framework.

---

## Discovery Protocol

### 1. Determine CTX Root

**If working in RTGF-enabled repository:**
```bash
# Check for CTX capability in config.yaml
yq eval '.capabilities.rcm.enabled' config.yaml

# Get knowledge repo path
CTX_ROOT=$(yq eval '.capabilities.rcm.knowledge_repo' config.yaml)
```

**If working in standalone CTX repository:**
```bash
# Assume current directory is CTX root
CTX_ROOT=$(pwd)
```

### 2. Validate CTX Structure

Required directory structure:
```
$CTX_ROOT/ctx/
├── archive/
│   ├── raw/{platform}/
│   └── canonical/{year}/{month}/
├── flows/
│   ├── hypothesis/
│   ├── codified/
│   ├── validated/
│   └── promoted/
├── schemas/canonical-v1.yaml
└── config.yaml
```

**Validation command:**
```bash
test -f "$CTX_ROOT/ctx/config.yaml" && \
test -d "$CTX_ROOT/ctx/archive/canonical" && \
test -d "$CTX_ROOT/ctx/flows" && \
echo "CTX structure valid" || echo "CTX not initialized"
```

---

## Session Import (Manual)

### Import from Claude Code

**Locate session file:**
```bash
# Claude Code session files location
SESSION_DIR=~/.claude/projects/-home-cbasta*/
SESSION_FILE=$(find $SESSION_DIR -name "*.jsonl" -type f | head -1)
```

**Import command:**
```bash
ctx-import \
  --source "$SESSION_FILE" \
  --platform claude-code \
  --target "$CTX_ROOT" \
  --fidelity standard
```

**What happens:**
1. Session copied to `ctx/archive/raw/claude-code/{session-id}.jsonl`
2. Converted to canonical YAML using `tools/adapters/claude-code.js`
3. Saved to `ctx/archive/canonical/2026/02/{date}_{title}_{short-id}.yaml`
4. Symlinked to `ctx/flows/hypothesis/` (auto-import state)
5. Git commit created: `ctx(import): Import claude-code session {session-id}`

### Import from ChatGPT

**Export from ChatGPT:**
1. ChatGPT UI → Settings → Data Controls → Export Data
2. Download `conversations.json`

**Import command:**
```bash
ctx-import \
  --source ~/Downloads/conversations.json \
  --platform chatgpt \
  --target "$CTX_ROOT"
```

### Import from Gemini

**Export from Gemini:**
1. Gemini UI → Activity → Download conversations
2. Download JSON export

**Import command:**
```bash
ctx-import \
  --source ~/Downloads/gemini-export.json \
  --platform gemini \
  --target "$CTX_ROOT"
```

---

## Session Discovery

### List Sessions by State

```bash
# List all hypothesis sessions (untagged, auto-imported)
ls -lh "$CTX_ROOT/ctx/flows/hypothesis/"

# List codified sessions (tagged, structured)
ls -lh "$CTX_ROOT/ctx/flows/codified/"

# List validated sessions (quality-checked)
ls -lh "$CTX_ROOT/ctx/flows/validated/"

# List promoted sessions (RAG-indexed)
ls -lh "$CTX_ROOT/ctx/flows/promoted/"
```

### Search Sessions

**Use `ctx-search` for full-text + filter search across all knowledge repos:**

```bash
CTX_SEARCH="node ~/rtgf-ai-stack/chronicle/tools/cli/ctx-search.js"

# Full-text search (title + tags + message content)
$CTX_SEARCH "librechat docker restart"
$CTX_SEARCH "ollama embedding models"

# Filter by flow state
$CTX_SEARCH --state codified
$CTX_SEARCH "security" --state validated

# Filter by tags
$CTX_SEARCH --tags "docker,security"
$CTX_SEARCH "restart policy" --tags "docker"

# Filter by date range
$CTX_SEARCH --since 2026-02-01 --until 2026-02-28

# Show content snippets (useful for picking the right session to read)
$CTX_SEARCH "circuit designer" --show-content

# Most recent N sessions
$CTX_SEARCH --recent 10

# Machine-readable output
$CTX_SEARCH "ollama" --format list
$CTX_SEARCH "docker" --format json

# Force rebuild index (after new sessions imported)
$CTX_SEARCH --rebuild

# Search via MeiliSearch (requires CHRONICLE_MEILI_KEY env var)
export CHRONICLE_MEILI_KEY=<key-from-ubuntu-ai-hub>
$CTX_SEARCH "librechat" --source meili

# Index sessions into MeiliSearch (run once, then keep updated with --rebuild)
$CTX_SEARCH --push-meili
```

**Getting the MeiliSearch key** (on Ubuntu-AI-Hub):
```bash
docker inspect chat-meilisearch | python3 -c "
import sys,json; d=json.load(sys.stdin)
for e in d[0]['Config']['Env']:
    if 'MEILI' in e: print(e)
"
```

**Index cache location:** `~/.chronicle-fts.json` — rebuilt automatically when stale (>24h) or with `--rebuild`.

### Read Session

```bash
# Read canonical YAML
SESSION_FILE="$CTX_ROOT/ctx/flows/hypothesis/2026-02-08_openclaw_55fc0e3d.yaml"
cat "$SESSION_FILE"

# Parse session metadata
yq eval '.session.metadata' "$SESSION_FILE"

# Extract message count
yq eval '.messages | length' "$SESSION_FILE"
```

---

## Flow Management

### Promote Session Through States

**hypothesis → codified** (manual tagging)
```bash
ctx-flow promote \
  --session 55fc0e3d \
  --from hypothesis \
  --to codified \
  --tags "openclaw,workflow,multi-client,wsl"
```

**codified → validated** (quality check)
```bash
ctx-flow promote \
  --session 55fc0e3d \
  --to validated \
  --quality-score 85 \
  --reason "Comprehensive planning discussion with actionable outcomes"
```

**validated → promoted** (RAG export)
```bash
ctx-flow promote \
  --session 55fc0e3d \
  --to promoted \
  --export markdown \
  --rag-workspace client-a
```

**What happens during promotion:**
1. `git mv ctx/flows/{from_state}/{session}.yaml ctx/flows/{to_state}/`
2. Update `session.flow_state.current` in YAML
3. Git commit: `ctx(flow): Promote session 55fc0e3d ({from} → {to})`
4. If `--export` flag: run `ctx-export` to generate Markdown

### Manual Flow Operations (Git-native)

**IMPORTANT: Always use `git mv`, never `mv` or `cp`**

```bash
# Move session from hypothesis to codified
cd "$CTX_ROOT"
git mv \
  ctx/flows/hypothesis/2026-02-08_openclaw_55fc0e3d.yaml \
  ctx/flows/codified/2026-02-08_openclaw_55fc0e3d.yaml

# Update flow_state in file
yq eval '.session.flow_state.current = "codified"' -i \
  ctx/flows/codified/2026-02-08_openclaw_55fc0e3d.yaml

# Commit
git add ctx/flows/codified/2026-02-08_openclaw_55fc0e3d.yaml
git commit -m "ctx(flow): Codify session 55fc0e3d (hypothesis → codified)"
```

---

## Export to RAG Systems

### Export to Markdown (AnythingLLM)

```bash
# Export single session
ctx-export \
  --input "$CTX_ROOT/ctx/flows/promoted/2026-02-08_openclaw_55fc0e3d.yaml" \
  --format markdown \
  --output /path/to/anythingllm/documents/client-a/

# Export all promoted sessions
ctx-export \
  --input "$CTX_ROOT/ctx/flows/promoted/*.yaml" \
  --format markdown \
  --output /path/to/anythingllm/documents/client-a/
```

**Markdown format includes:**
- YAML frontmatter (metadata, tags, participants)
- Human-readable conversation flow
- Tool use blocks (formatted code)
- Thinking blocks (expandable sections)

### Export to JSON (API consumption)

```bash
ctx-export \
  --input "$CTX_ROOT/ctx/flows/validated/*.yaml" \
  --format json \
  --output /tmp/ctx-export/
```

---

## Auto-Sync (Daemon Mode)

### Enable Auto-Import for Claude Code

```bash
# Start watcher in background
ctx-sync \
  --watch ~/.claude/projects/ \
  --platform claude-code \
  --target "$CTX_ROOT" \
  --auto-flow hypothesis \
  --daemon &

# Check daemon status
ps aux | grep ctx-sync

# Stop daemon
pkill -f ctx-sync
```

**What auto-sync does:**
1. Watches `~/.claude/projects/` for new `.jsonl` files
2. Detects session close events (file modification stops)
3. Auto-imports to `ctx/archive/raw/` and `ctx/archive/canonical/`
4. Auto-promotes to `ctx/flows/hypothesis/`
5. Git commit: `ctx(import): Auto-import claude-code session {session-id}`

**Configuration:**
Edit `ctx/config.yaml`:
```yaml
auto_sync:
  enabled: true
  daemon_mode: true
  watch_interval: 5000  # milliseconds
  auto_commit: true
```

---

## RIS Assembly (RTGF Integration)

When CTX is deployed within an RTGF project, AI agents should include CTX context in Research Information Synthesis (RIS).

### Check CTX Capability

```bash
# Check if CTX is enabled
yq eval '.capabilities.rcm.enabled' config.yaml
```

### Include CTX in RIS

**Add to RIS document:**

```markdown
## Runtime Context (CTX)

**Knowledge Repository:** {path from config.yaml}

**Recent Sessions (Last 7 days):**
- [Session Title 1] - {tags} - {flow_state}
- [Session Title 2] - {tags} - {flow_state}

**Relevant Sessions for Current Task:**
- Query: ctx-search --tags {current_task_tags}
- Found: {N} sessions
- Most relevant: {session_title} ({session_id})

**Recommended Actions:**
- Import current session after completion
- Tag with: {suggested_tags}
- Promote to: {suggested_state}
```

### Query CTX for Task Context

```bash
# Find related sessions before starting work
ctx-search \
  --tags $(basename $PWD) \
  --date-range $(date -d '30 days ago' +%Y-%m-%d):$(date +%Y-%m-%d) \
  --flow-state codified,validated,promoted

# Read top result for context
SESSION=$(ctx-search --tags openclaw | head -1)
cat "$CTX_ROOT/ctx/flows/codified/$SESSION"
```

---

## Multi-Client Workflows

### Determine Target Repository

**Rule:** Session destination based on working directory

```bash
# Determine client from current path
case "$PWD" in
  */client-a/*) CTX_ROOT="/home/cbasta/client-a-knowledge" ;;
  */client-b/*) CTX_ROOT="/home/cbasta/client-b-knowledge" ;;
  */client-c/*) CTX_ROOT="/home/cbasta/client-c-knowledge" ;;
  *) CTX_ROOT="/home/cbasta/personal-knowledge" ;;
esac
```

### Import to Correct Repository

```bash
# Auto-detect target based on working directory
ctx-import \
  --source "$SESSION_FILE" \
  --platform claude-code \
  --auto-detect-target \
  --fallback ~/personal-knowledge/
```

### Verify Isolation

```bash
# Ensure no session cross-contamination
diff -r ~/client-a-knowledge/ctx/ ~/client-b-knowledge/ctx/
# Expected: Only directory structure matches, no shared session files
```

---

## Quality Guidelines

### When to Promote Sessions

**hypothesis → codified:**
- ✅ Session has clear, actionable outcomes
- ✅ Add descriptive tags (3-5 keywords)
- ✅ Verify title accurately describes content

**codified → validated:**
- ✅ Quality score ≥ 70 (estimate based on usefulness)
- ✅ Information is accurate and complete
- ✅ Would reference this session in future work

**validated → promoted:**
- ✅ High-value knowledge (quality score ≥ 85)
- ✅ Suitable for RAG ingestion (reusable patterns/solutions)
- ✅ No sensitive information (if sharing repo)

### Tagging Best Practices

**Good tags:**
- Technical: `openclaw`, `rtgf`, `git-native`, `claude-code`
- Category: `workflow`, `bug-fix`, `planning`, `architecture`
- Client: `client-a`, `client-b`, `personal`
- Domain: `multi-client`, `wsl`, `linux`, `automation`

**Avoid:**
- Generic: `discussion`, `conversation`, `session`
- Redundant: `llm` (all sessions are LLM conversations)
- Too specific: `2026-02-08` (use date search instead)

---

## Troubleshooting

### Session Not Importing

```bash
# Check file format
file "$SESSION_FILE"
# Expected: JSON Lines data (JSONL) for Claude Code

# Check adapter availability
ls -l /home/cbasta/rtgf-ctx/tools/adapters/

# Verbose import
ctx-import --source "$SESSION_FILE" --platform claude-code --verbose
```

### Git Conflicts

```bash
# If git mv fails due to uncommitted changes
cd "$CTX_ROOT"
git status

# Commit pending changes first
git add ctx/flows/
git commit -m "ctx(flow): Checkpoint before promotion"

# Retry flow operation
ctx-flow promote --session 55fc0e3d --to codified
```

### Missing Dependencies

```bash
# Check Node.js version
node --version
# Required: ≥18.0.0

# Reinstall dependencies
cd /home/cbasta/rtgf-ctx/
npm install

# Verify CLI tools
which ctx-import ctx-export ctx-flow
```

---

## Reference Commands Summary

```bash
# Import session
ctx-import --source {file} --platform {platform} --target {rcm_root}

# Export to Markdown
ctx-export --input {yaml_files} --format markdown --output {dir}

# Promote through flow
ctx-flow promote --session {id} --to {state} --tags {tags}

# Search sessions
ctx-search --tags {tags} --date-range {start}:{end} --flow-state {state}

# Auto-sync daemon
ctx-sync --watch {dir} --platform {platform} --daemon

# List sessions by state
ls -lh $CTX_ROOT/ctx/flows/{hypothesis|codified|validated|promoted}/

# Read session
cat $CTX_ROOT/ctx/flows/{state}/{session-file}.yaml
```

---

## Next Steps

After mastering basic CTX operations:

1. **Enable auto-sync** - Set up `ctx-sync` daemon for zero-toil archival
2. **Curate hypothesis sessions** - Review auto-imported sessions, promote valuable ones
3. **Build RAG knowledge base** - Export promoted sessions to AnythingLLM
4. **Multi-platform import** - Start importing ChatGPT and Gemini sessions
5. **Search & discovery** - Use `ctx-search` to find relevant past context

---

## See Also

- **README.md** - SCOPE module contract and architecture
- **schemas/canonical-v1.yaml** - Session schema definition
- **config.yaml** - SCOPE configuration reference
