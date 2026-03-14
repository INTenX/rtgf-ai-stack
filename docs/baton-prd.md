# PRD: BATON — Inter-Session Coordination

**Version:** 0.1
**Date:** 2026-03-14
**Owner:** INTenX / AI Stack session
**Status:** Draft

---

## Problem Statement

Claude Code sessions operate in isolation. There is no mechanism for one session to delegate work to another, inject task-specific context into a new session, or collect results without human intervention. The current file-based messaging system (Phase 1) enables ad-hoc coordination between already-running sessions but cannot spawn new sessions, manage their lifecycle, or control the communication topology between them.

The result: parallelism requires human effort, context is carried manually, and autonomous multi-session workflows are not possible.

---

## Goals

1. An orchestrator session can spawn an ephemeral session with a well-defined task and scoped context.
2. Spawned sessions receive the right context — no more, no less — via a tiered lookup model.
3. Results flow back to the orchestrator without human intervention.
4. Spawned sessions can communicate with each other when the orchestrator explicitly permits it.
5. The system prevents runaway recursion — sub-sessions request more sessions via the orchestrator; they cannot spawn independently.
6. The file-based messaging system (Phase 1) remains operational as a bridge while the spawn model matures.

## Non-Goals

- Replacing CHRONICLE for session archival
- Real-time push delivery or streaming between sessions
- External (non-WSL) session spawning in Phase 1
- Encryption or authentication between sessions
- General-purpose task queue or job scheduler

---

## Users

| User | Role |
|------|------|
| Designated orchestrator sessions | Spawn and manage ephemeral sessions |
| Ephemeral sub-sessions | Execute discrete tasks, return results |
| Human (Cole) | Approves orchestrator designation, reviews failures |
| Telegram bot | Future: relay spawn requests and status to human |

---

## Architecture

### Session Models

BATON supports two coordination models. Both are first-class. The spawn model is the long-term target; the mailbox model bridges the gap and may be deprecated once spawn is stable.

**Model A — Spawn New Session**
Orchestrator creates a fresh Claude Code process with a task package. The session boots, executes, wraps, and returns results.

```
Orchestrator → [BATON spawn] → New Claude Code process
                                  ↓ boot with task package
                                  ↓ tiered context load
                                  ↓ execute task
                                  ↓ wrap + archive to CHRONICLE
                                  ↓ write result to orchestrator mailbox
Orchestrator ← [check-mailbox] ← result reference
```

**Model B — Coordinate Running Session**
Orchestrator writes a task message to an existing session's mailbox. The session consumes it on its next check-mailbox cycle and responds via its own mailbox.

```
Orchestrator → [send-message] → existing session mailbox
                                  ↓ session polls + consumes
                                  ↓ executes task
                                  ↓ writes result to orchestrator mailbox
Orchestrator ← [check-mailbox] ← result
```

---

### Session Registry

BATON maintains a registry of known sessions and their spawn configurations.

**Location:** `/mnt/c/temp/baton/registry.json`

```json
{
  "sessions": {
    "ai-stack": {
      "wsl_instance": "INTenXDev",
      "project_path": "/home/cbasta/rtgf-ai-stack",
      "is_orchestrator": true,
      "allowed_to_spawn": ["chronicle-worker", "research-worker", "code-worker"],
      "mailbox": "/mnt/c/temp/messages/INTenXDev/ai-stack"
    },
    "chronicle-worker": {
      "wsl_instance": "INTenXDev",
      "project_path": "/home/cbasta/rtgf-ai-stack",
      "is_orchestrator": false,
      "spawn_template": "workers/chronicle-worker.md",
      "mailbox_template": "/mnt/c/temp/messages/INTenXDev/chronicle-worker-{ts}"
    }
  }
}
```

**Orchestrator designation** is explicit in the registry. A session is not an orchestrator by default. Human sets `is_orchestrator: true`. Sub-sessions cannot promote themselves.

---

### Task Package

When an orchestrator spawns a session, it writes a task package — a structured markdown file that the new session reads on boot.

**Location:** `/mnt/c/temp/baton/tasks/{task-id}.md`

```markdown
**Task-ID:** {uuid}
**From:** C:\temp\messages\INTenXDev\ai-stack
**Spawned-At:** 2026-03-14T17:30:00Z
**Task-Type:** research | code | archive | analysis | coordination
**Priority:** normal | high
**Deadline:** 2026-03-14T18:30:00Z   ← optional

## Objective
{specific, bounded task description}

## Output Format
{what the result should look like — summary, file, CHRONICLE import, etc.}

## Tool Scope
{which tools are permitted — Bash, Read, Write, Edit, MCP tools}

## Explicit Context Refs
- session-id: abc12345  ← pull this from CHRONICLE
- file: /path/to/file   ← load this on first access

## Semantic Query
{task description rephrased as a search query for LanceDB Tier 2 lookup}

## Flow State Filter
{codified,validated | all | hypothesis}

## Communication Permissions
- allowed_peers: []    ← empty = orchestrator only
- return_to: C:\temp\messages\INTenXDev\ai-stack

## Constraints
- max_context_tokens: 10000
- do_not_spawn: true   ← sub-sessions cannot spawn further sessions
```

---

### Tiered Context Model

Based on Anthropic's context engineering research and the CHRONICLE/LanceDB stack. Hard cap: **10K tokens injected at spawn**. References are always preferred over content dumps — the agent loads full content lazily when needed.

```
Tier 0 — Always pushed (every session, every time)
  ├── AGENT_GUIDANCE.md relevant sections
  ├── Task spec, output format, tool scope, task boundaries
  └── Behavioral constraints (do_not_spawn, communication permissions)
  Cost: ~3K–6K tokens

Tier 1 — Deterministic refs (pushed by orchestrator, lazy-loaded)
  ├── Explicit session IDs from task package
  ├── Explicit file handles from task package
  └── BATON message payload if < 2K tokens
  Cost: variable, loaded on first access

Tier 2 — Proactive semantic pull (runs before first agent turn)
  ├── LanceDB query: task description embedding
  ├── Filter: codified + validated flow states only (unless task package says otherwise)
  ├── Top-5 results: inject summaries + session IDs, not full content
  └── Agent loads full session content lazily if needed
  Cost: ~2K–5K tokens

Tier 3 — Reactive tag/flow-state filter (agent-triggered)
  ├── ctx-search --tags {task_tags} --state codified,validated
  └── Triggered when agent detects a specific knowledge domain gap
  Cost: on demand

Tier 4 — Full KB scan (emergency fallback)
  ├── ctx-search across all flow states, all projects
  └── If this tier fires frequently, KB tagging is inadequate
  Cost: potentially high — use sparingly

Tier 5 — Live session JSONL search (recent work not yet in CHRONICLE)
  ├── Search ~/.claude/projects/ JSONL files
  └── For work done in the last 24–48h
  Cost: on demand
```

**10K token enforcement:** If Tier 0 + Tier 1 + Tier 2 would exceed 10K, truncate Tier 2 to top-3 summaries. Tier 0 is never truncated. Tier 1 refs are never truncated (they're just references — the cost is at load time).

**Why this matters:** Anthropic found multi-agent systems consume ~15x more tokens than single-agent. Every spawn should be reserved for tasks that justify parallelism. Context noise causes measurable performance degradation past the 10K–20K injected token threshold.

---

### Result Contract

Results flow back via three channels, scoped by task type:

| Task Type | Message (mailbox) | CHRONICLE ID | Artifacts |
|-----------|-------------------|--------------|-----------|
| research | ✓ summary | ✓ | optional |
| code | ✓ status | ✓ | ✓ (file paths) |
| archive | ✓ status | ✓ | — |
| analysis | ✓ findings | ✓ | optional |
| coordination | ✓ ack/status | — | — |

**Result message format:**

```markdown
**From:** C:\temp\messages\INTenXDev\chronicle-worker-{ts}
**To:** C:\temp\messages\INTenXDev\ai-stack
**Task-ID:** {uuid}
**Status:** complete | partial | failed
**Chronicle-Session-ID:** {session-id}

## Result Summary
{1–3 paragraph summary of what was done and what was found}

## Artifacts
- /path/to/file1
- /path/to/file2

## Next Steps (if any)
{optional: what the orchestrator should do next}
```

---

### Communication Topology

**Default:** Sub-sessions communicate only with their orchestrator.

**Peer-to-peer:** Orchestrator can grant permission in the task package via `allowed_peers`. Permitted sessions may write to each other's mailboxes directly. The orchestrator is not in the message path but remains responsible for task completion.

**No downward spawning:** Sub-sessions detect `do_not_spawn: true` in their task package. If a sub-session determines it needs additional sessions, it sends a request back to the orchestrator via its return mailbox — never spawns independently.

**Why:** Agent recursion creates uncontrolled token spend, unpredictable lifetimes, and audit gaps. The orchestrator maintains the full graph of active sub-sessions and their permissions.

---

### Failure Handling

Mirrors the messaging PRD failure model, adapted for session lifecycle:

| Condition | Timeout | Action |
|-----------|---------|--------|
| Sub-session no result | 15 min | Orchestrator sends a check message |
| Sub-session no result | 30 min | Orchestrator re-sends task (retry 1) |
| Sub-session no result | 45 min | Escalate to human via Telegram |
| Sub-session exits with error | Immediate | Write error report to orchestrator mailbox + CHRONICLE archive |
| Spawn failure | Immediate | Log to BATON error log, Telegram alert |

**Heartbeat integration:** The heartbeat script monitors active sessions. If a sub-session disappears from the active sessions list without writing a result, the heartbeat flags it for the orchestrator.

---

## Implementation Phases

### Phase 1 (current) — File-Based Mailbox Bridge
- ✅ Mailbox messaging between running sessions
- ✅ ACK model with retry/escalate/flag
- ✅ send-message + check-unacked scripts
- ✅ Session registry (manual, in MESSAGING.md)

### Phase 2 — Registry + Task Package
- Session registry JSON at `/mnt/c/temp/baton/registry.json`
- Task package schema (markdown + frontmatter)
- `baton-send` script: writes task package + message to target session
- `baton-result` script: formats and writes result back to orchestrator
- Tiered context: Tier 0 + Tier 1 + Tier 2 (proactive LanceDB at spawn)

### Phase 3 — Spawn Model
- `baton-spawn` script: launches `claude --headless` or `claude -p` subprocess with task package injected via `--system-prompt` or initial message
- Sub-session reads BATON task package from known path on boot
- Session lifecycle tracking in registry (spawned, running, wrapped, failed)
- Heartbeat integration: monitor spawned sessions, flag stale ones

### Phase 4 — Orchestrator Intelligence
- Orchestrator can decompose a complex task into sub-tasks automatically
- Parallel spawn for independent sub-tasks
- Result aggregation + synthesis before returning to human
- Telegram gate: human approves high-cost spawns (configurable threshold)

---

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Designated orchestrators only | Prevents runaway recursion, maintains audit trail |
| Sub-sessions request up, never spawn down | Orchestrator owns the session graph |
| Push floor + pull on demand | Matches Anthropic's validated context engineering model |
| 10K token injection cap | Prevents context noise degradation |
| Summaries + IDs, not content dumps | Decouples sub-agent and orchestrator context windows |
| Async fire-and-forget | Keeps orchestrator unblocked; aligns with file-based polling model |
| Peer comms require orchestrator grant | Orchestrator controls topology without being in every message path |
| Phase 1 mailbox model not deprecated immediately | Too much active usage; spawn model proves itself first |

---

## Open Items

- [ ] Task type taxonomy — define canonical types and their result contracts precisely
- [ ] Tool scope language — how are permitted tools specified in the task package? Tool name list? Capability category?
- [ ] Spawn mechanism — `claude --headless`, `claude -p`, or tmux injection? Evaluate options in Phase 3 spike.
- [ ] BATON registry permissions — who can edit `registry.json`? Git-managed? Or runtime-writable?
- [ ] Heartbeat integration spec — exact signal for "sub-session stale without result"
