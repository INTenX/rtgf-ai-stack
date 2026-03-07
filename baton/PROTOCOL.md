# BATON Protocol

Inter-session coordination protocol for the INTenX AI Stack. Enables sessions and agents to hand off work to each other via a shared file store.

---

## Overview

```
Session A (drops baton)
     │
     │  baton drop "Refactor the gateway module"
     ▼
/mnt/c/Temp/wsl-shared/baton/pending/<id>.json
     │
     │  baton claim <id>  (Session B picks it up)
     ▼
/mnt/c/Temp/wsl-shared/baton/claimed/<id>.json
     │
     │  baton complete <id> --result "Done, see commit abc123"
     ▼
/mnt/c/Temp/wsl-shared/baton/completed/<id>.json
```

The shared store at `/mnt/c/Temp/wsl-shared/baton/` is accessible from all WSL instances on the same Windows host.

---

## Baton Packet

```json
{
  "id": "uuid-v4",
  "created": "2026-03-06T00:00:00.000Z",
  "from": "AI Stack",
  "to": "any",
  "type": "task | handoff | alert",
  "priority": "high | normal | low",
  "subject": "One-line summary",
  "body": "Full description, acceptance criteria, relevant context",
  "context": {
    "chronicle_refs": ["session-id-prefix"],
    "inline": "Any extra context to pass along"
  },
  "status": "pending | claimed | completed | abandoned",
  "claimed_at": null,
  "claimed_by": null,
  "completed_at": null,
  "result": null
}
```

### Field notes

| Field | Notes |
|-------|-------|
| `from` | Session name or "user" if dropped via Telegram |
| `to` | Session name, WSL instance name, or "any" for first-claimer |
| `type` | `task` = do this work; `handoff` = continue from where I left off; `alert` = FYI only |
| `priority` | `high` surfaces first in `baton list` |
| `context.chronicle_refs` | Session IDs the receiver should read before starting |

---

## CLI

```bash
# Drop a new baton
baton drop "Subject line" [--to session-name] [--type task] [--priority normal] [--body "..."] [--ref session-id]

# List pending batons
baton list [--all]

# Claim a baton (move pending → claimed)
baton claim <id-prefix>

# Complete a claimed baton
baton complete <id-prefix> [--result "summary of what was done"]

# Show full detail of a baton
baton show <id-prefix>

# Abandon a baton (move to completed with status=abandoned)
baton abandon <id-prefix> [--reason "why"]
```

---

## Telegram commands

```
/baton list           — Show pending batons
/baton drop <subject> — Drop a new task baton (type=task, from=user)
/baton show <id>      — Show full baton detail
```

Claim and complete are CLI-only (require a working session to claim responsibility).

---

## Store layout

```
/mnt/c/Temp/wsl-shared/baton/
  pending/    — Dropped, not yet claimed
  claimed/    — In progress by a session
  completed/  — Done or abandoned (archive)
```

---

## Session start check

On session start, run `baton list` to surface any pending batons. WARD hook integration (future): fire `baton list` as part of the session start hook and prepend output to the context if any batons are pending.
