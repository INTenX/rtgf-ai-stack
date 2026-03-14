# RTGF AI Stack

**INTenX AI Development Stack** — unified model routing, session archival, security enforcement, and inter-session coordination for AI-first consulting operations.

---

## Choose your documentation

| I want to... | Go to... |
|--------------|----------|
| Understand how the stack fits together | [Architecture Overview](architecture/overview.md) |
| See the memory and knowledge model | [Memory Model](architecture/memory-model.md) |
| Understand security enforcement | [Security Layers](architecture/security-layers.md) |
| Learn about a specific component | [Components](components/chronicle.md) |
| Get something running | [Quick Start](operations/quick-start.md) |
| See what's built and what's next | [Roadmap](development/roadmap.md) |

---

## Stack at a Glance

```mermaid
graph TB
    subgraph Clients["Clients"]
        CC[Claude Code]
        TG[Telegram Bot]
        LC[LibreChat]
    end

    subgraph Gateway["LiteLLM Gateway :4000"]
        GW[Router + Budget Enforcement]
        VK[Virtual Keys per Client]
    end

    subgraph Models["Model Backends"]
        OL[Ollama — Local GPU]
        AN[Anthropic API]
        OA[OpenAI API]
    end

    subgraph Knowledge["Knowledge Layer"]
        CH[CHRONICLE — Session Archive]
        KR[(GitHub Knowledge Repos)]
        CS[ctx-search CLI]
    end

    subgraph Security["Security — WARD"]
        WD[Claude Code Hooks]
        AL[Audit Log JSONL]
        BL[Block Policies]
    end

    CC --> GW
    TG --> GW
    LC --> GW
    GW --> VK
    VK --> OL
    VK --> AN
    VK --> OA

    CC -->|auto-import| CH
    CH --> KR
    TG -->|ctx-search| CS
    CS --> KR

    CC --> WD
    WD --> AL
    WD --> BL
```

---

## Component Status

| Component | Status | Location |
|-----------|--------|----------|
| **Ollama** (local models) | ✅ Operational | Windows/AMD, all WSL |
| **CHRONICLE** (session archival) | ✅ Production | `chronicle/` |
| **LiteLLM Gateway** | ✅ Deployed | AI Hub WSL `:4000` |
| **Telegram Interface** | ✅ Running | `interface/` → systemd |
| **WARD** (Claude Code hooks) | ✅ Built | `hooks/` |
| **wsl-audit** | ✅ Built | `~/.local/bin/wsl-audit` |
| **LibreChat** | ✅ Keep + decouple | AI Hub WSL `:3080` |
| **BATON** (inter-session) | 🔄 Phase 2 — CLI built | `baton/` |
| **Intent Classifier** | ✅ Deployed | `interface/lib/intent.js` |
| **LanceDB semantic search** | ✅ Built | `chronicle/tools/cli/lancedb-index.js` |
| **Wrap signal detector** | ✅ Cron | `scripts/wrap-signal-detector` |
| **Auto-prune hypothesis** | ✅ Cron | `chronicle/tools/cli/prune-hypothesis.js` |

---

## Quick Facts

- **Repo:** `github.com/INTenX/rtgf-ai-stack`
- **WSL layout:** Dev WSL (primary dev + bot) + AI Hub WSL (gateway host)
- **Gateway:** `http://10.5.0.2:4000` (auto-discovered)
- **Ollama:** Windows AMD RX 7600S, accessible from all WSL
- **Knowledge repos:** 7 deployed (intenx, sensit, makanui, ratio11, beaglebone, test + tools)
