# rtgf-ai-stack

**INTenX AI Development Infrastructure**

Monorepo for the AI development stack — local model infrastructure, session archival, knowledge curation, observability, security governance, and inter-session coordination.

---

## Structure

```
rtgf-ai-stack/
├── lore/           — Session archival + knowledge curation (LORE)
├── gateway/        — LiteLLM config (Ollama routing, cost attribution)
├── interface/      — Telegram bot (rtgf-interface)
├── hooks/          — SENTINEL Claude Code security hooks
├── observability/  — Opcode + OTel/Grafana config
├── compose/        — Docker Compose (LibreChat, gateway)
├── scripts/        — Shared service scripts (ollama-setup.sh, wsl-audit)
└── relay/          — Inter-session coordination (RELAY — planned)
```

---

## Components

### LORE — Library Of Refined Evidence (`lore/`)
Git-native LLM conversation archival and knowledge flow management.
- Agent-agnostic session import (Claude Code, ChatGPT, Gemini)
- Knowledge Flow states: `hypothesis → codified → validated → promoted`
- Per-client isolation via separate knowledge repos
- Tools: `lore/tools/cli/` — import, export, flow, sync, query, orphan detection
- Gemini → LibreChat importer: `lore/tools/cli/gemini-librechat-import.py`

**Status:** ✅ Production — Claude Code archival operational, 100+ sessions. Gemini importer built.

See [`lore/README.md`](lore/README.md) for usage.

---

### Gateway — LiteLLM (`gateway/`)
Single endpoint routing Ollama local models. Per-client cost attribution and spend tracking.
- Endpoint: `http://Ubuntu-AI-Hub:4000`
- Ollama-only (cloud API keys not yet configured)
- SQLite spend tracking

**Status:** ✅ Deployed on Ubuntu-AI-Hub, port 4000. Auto-starts via `/etc/wsl.conf` boot command.

---

### Telegram Interface (`interface/`)
Telegram bot providing conversational access to the AI stack via LiteLLM gateway.
- `interface/bot.js` — main bot entry point
- Routes to LiteLLM gateway for model selection

**Status:** ✅ Built. Conversation history and LORE context injection pending.

---

### SENTINEL — Claude Code Security Hooks (`hooks/`)
Defense-in-depth security layer for Claude Code sessions.
- `pre-tool-use.sh` — blocks dangerous patterns (rm -rf, credential access, cross-client paths, unreviewed force pushes)
- `post-tool-use.sh` — audit logging to `~/.claude/audit/YYYY-MM-DD.jsonl`
- Cedar-style policy directory (`hooks/policy/`)
- Install: `bash hooks/install-hooks.sh`

**Status:** ✅ Built. Install on each WSL instance via `install-hooks.sh`.

---

### LibreChat (via `compose/`)
Deployed AI chat interface with full conversation history, search, and RAG.
- UI: `http://localhost:3080`
- MongoDB: primary conversation store
- Meilisearch: full-text search across all conversations (port 7700)
- pgvector + RAG API: vector search for semantic retrieval
- ~10,400 messages imported (ChatGPT + Gemini sessions, Jan 2025 – Feb 2026)

**Status:** ✅ Deployed on Ubuntu-AI-Hub. Running via Docker Compose.

---

### Observability (`observability/`)
Session browsing and infrastructure monitoring.
- **Opcode:** Windows desktop app for Claude Code session browsing ✅ Installed
- **OTel + Grafana:** Real-time cross-WSL dashboards — planned

**Status:** ✅ Opcode operational. OTel/Grafana pending.

---

### Scripts (`scripts/`)
Shared operational scripts across all WSL instances.
- `ollama-setup.sh` — Ollama environment setup (canonical: `/mnt/c/Temp/wsl-shared/`)
- `wsl-audit` — WSL/Docker health monitoring (installed at `~/.local/bin/wsl-audit`)
- `gateway-startup.sh` — LiteLLM gateway auto-start for Ubuntu-AI-Hub

**Status:** ✅ All built and operational.

---

### RELAY (`relay/`)
Inter-session coordination — agent registry, handoff protocol, specialized agent roles.

**Status:** ⬜ Planned.

---

## Defense-in-Depth Security Layers

| Layer | Name | Technology | Status |
|-------|------|-----------|--------|
| 1 | Kernel | eBPF syscall enforcement (Tetragon/Leash) | ⬜ Planned |
| 2 | Container | Docker isolation + Cedar policies | ⬜ Planned |
| 3 | Application | SENTINEL Claude Code hooks | ✅ Built |
| 4 | Gateway | LiteLLM routing + cost controls | ✅ Deployed |
| 5 | Archive | LORE session archival + audit trail | ✅ Production |
| 6 | Governance | AGaC overlays, human-in-loop gates | ⬜ Planned |

---

## Session Context

- **Agent guidance:** [`AGENT_GUIDANCE.md`](AGENT_GUIDANCE.md)
- **Stack state + decisions:** [`STACK-SESSION-CONTEXT.md`](STACK-SESSION-CONTEXT.md)
- **PRD:** [`PRD.md`](PRD.md)

---

## Knowledge Repositories

Per-client private repos on GitHub (INTenX org):

| Repo | Client |
|------|--------|
| `intenx-knowledge` | INTenX (internal) |
| `sensit-knowledge` | Sensit Technologies |
| `makanui-knowledge` | Makanui LLC |
| `ratio11-knowledge` | Ratio11 Electronics |
| `beaglebone-knowledge` | BeagleBone Projects |
| `test-knowledge` | Development/testing |

---

## License

Apache 2.0
