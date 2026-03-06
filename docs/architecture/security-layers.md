# Security Layers

Defense-in-depth security across all AI operations. Each layer is independently deployable and progressively more restrictive.

## Security Architecture

```mermaid
graph TB
    subgraph P2["Phase 2 — Active"]
        WD["WARD\nClaude Code hooks\nPre/post tool-use logging\nBlock policies"]
        AU["Audit Log\n~/.claude/audit/YYYY-MM-DD.jsonl\nImmutable JSONL"]
        WA["wsl-audit\nPlatform health\nDocker restart detection\nEvent log"]
    end

    subgraph P3["Phase 3 — Active"]
        GK["Gateway Keys\nLiteLLM virtual keys\nPer-client budget enforcement\nSpend visibility"]
        TG["Telegram WARD Alerts\nBlock notification\nPhone alert on CRITICAL"]
    end

    subgraph P4["Phase 4 — Planned"]
        TGG["Telegram Gate\nCommand authorization\nAdmin-only escalation"]
    end

    subgraph P5["Phase 5 — Planned"]
        CP["Cedar Policies\nDeclarative allow/deny\nRole-based access"]
    end

    subgraph P6["Phase 6 — Planned"]
        LH["Leash / eBPF\nRuntime syscall enforcement\nNetwork policy"]
    end

    TOOL["Tool Call"] --> WD
    WD -->|"blocked"| BLOCK["Block + Alert"]
    WD -->|"allowed"| AU
    AU --> EXEC["Execute"]

    BUDGET["API Call"] --> GK
    GK -->|"over budget"| REJECT["Reject 429"]
    GK -->|"within budget"| ROUTE["Route to model"]

    style P2 fill:#1b5e20,color:#fff
    TG --> BLOCK
    style P3 fill:#1b5e20,color:#fff
    style P4 fill:#4a148c,color:#fff
    style P5 fill:#311b92,color:#fff
    style P6 fill:#212121,color:#fff
    style BLOCK fill:#b71c1c,color:#fff
    style REJECT fill:#b71c1c,color:#fff
```

## WARD — Block Policies

Current blocked patterns in `hooks/policy/blocked-patterns.json`:

| Pattern | Severity | Action |
|---------|----------|--------|
| `rm -rf` | CRITICAL | Block |
| `git reset --hard` | CRITICAL | Block |
| `git push --force` (to main/master) | CRITICAL | Block |
| `DROP TABLE` / `DROP DATABASE` | CRITICAL | Block |
| SSH private key operations | CRITICAL | Block |
| Private key file access (`.pem`, `.key`) | HIGH | Warn |
| Environment file writes (`.env`) | HIGH | Warn |

## Audit Log Format

Every tool call generates a JSONL entry:

```json
{
  "timestamp": "2026-03-05T14:22:01Z",
  "session_id": "abc123",
  "tool": "Bash",
  "command": "git status",
  "decision": "allow",
  "severity": "info",
  "matched_rule": null
}
```

Log location: `~/.claude/audit/YYYY-MM-DD.jsonl`

## wsl-audit Governance

!!! danger "Mandatory before starting Docker services"
    Run `wsl-audit compose` before starting any new Docker service. Checks for missing restart policies and memory caps.

```mermaid
flowchart LR
    WA["wsl-audit"] --> S["status\nOS + memory"]
    WA --> D["docker\nContainer states"]
    WA --> P["processes\nCPU/memory top"]
    WA --> C["compose\nPolicy compliance"]
    WA --> R["risks\nActive issues only"]
    WA --> AL["all\nFull report"]
    WA --> W["watch N\nLive refresh"]
    WA --> EV["events N\nJSONL event log"]
```

CRIT events trigger Telegram alerts (configured in `~/.local/share/wsl-audit/alert.env`).

## Phase Rollout

```mermaid
timeline
    title Security Phase Rollout
    Phase 2 : WARD hooks (built)
             : Audit log (active)
             : wsl-audit events (active)
    Phase 3  : LiteLLM virtual keys (active)
             : Per-client budget limits (active)
             : WARD Telegram alerts (active)
    Phase 4  : Telegram gate (planned)
             : Admin escalation flow
    Phase 5  : Cedar policy engine (planned)
             : Declarative RBAC
    Phase 6  : Leash / eBPF (planned)
             : Runtime syscall enforcement
```
