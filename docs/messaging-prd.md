# PRD: Inter-Session Messaging

**Version:** 0.1
**Date:** 2026-03-13
**Owner:** INTenX / AI Stack session
**Status:** Draft

---

## Problem Statement

Multiple Claude Code sessions run concurrently across WSL instances and client projects. There is no reliable way for sessions to communicate, coordinate, or hand off information in real time. BATON handles async task handoff but not general-purpose messaging. Sessions operate in isolation unless the human manually carries context between them.

---

## Goals

1. Sessions can send and receive messages across WSL instance boundaries.
2. Delivery is reliable — sender knows the message was received.
3. Visibility is scoped — sessions only see messages they are entitled to.
4. The system is simple enough to operate without a running service (file-based at Phase 1).
5. Failure is handled gracefully — retried, escalated if path exists, then flagged for human review.

## Non-Goals

- Real-time push delivery (Phase 1 is poll-based)
- Replacing BATON for task handoff
- Message encryption or authentication between sessions
- External (non-WSL) delivery

---

## Users

| User | Role |
|------|------|
| Claude Code sessions | Primary senders and receivers |
| Human (Cole) | Admin — owns registry, reviews flagged failures |
| Telegram bot | Future: relay inbound messages to a named session |

---

## Architecture

### Phase 1 — File-Based Mailboxes (current)

```
C:\temp\messages\
  <wsl-instance>\
    <session-name>\        ← inbox: unread .md files
    archive\               ← consumed messages (never deleted)
```

Each session polls its inbox directory. On message receipt, the session processes the message and writes an `.ack` file back to the sender's inbox.

### Target Structure (Phase 2)

```
C:\temp\intenx-messages\
  <client>\
    <portfolio>\
      <project>\
        mailboxes\
          <session>\
        topics\            ← broadcast within project
      _topics\             ← broadcast within portfolio
  _global\
    topics\                ← platform-wide broadcast
```

Migration is coordinated — a message is dropped in each current mailbox when cutover is ready.

---

## Message Format

### Required fields

Every message must include these three fields in the header:

```markdown
**From:** C:\temp\messages\<wsl-instance>\<session-name>
**To:** C:\temp\messages\<wsl-instance>\<session-name>
**Sent:** 2026-03-13T18:00:00Z

<freeform body>
```

All other fields (Subject, Type, Priority, Expires) are optional conventions. The full `From` path enables reply without lookup.

### Filename convention

```
YYYY-MM-DD-HH-MM-<topic>.md
```

### ACK format

After consuming a message, the recipient writes an ack back to the sender's inbox:

```
<original-filename>.ack
```

Content is freeform — can include a summary or just be empty.

---

## Permission Model

Mirrors GitHub token scopes: Org → Portfolio → Project → Session.

| Level | Can message |
|-------|-------------|
| Session | Own project sessions only |
| Project coordinator | All sessions within the project |
| Portfolio coordinator | All projects within the portfolio |
| Org / AI Stack | Cross-portfolio |

**Coordinator-as-dispatcher:** Sessions that need to reach outside their project route through their project coordinator. Direct cross-project writes are not permitted except for coordinator-level sessions.

**Critical escalation:** Sessions may have a configured escalation target. When a message is marked critical, it is delivered simultaneously to the coordinator AND the escalation target. Not all sessions have an escalation path — this is optional.

**Registry:** Human/admin-maintained. Sessions cannot modify registry entries or permission assignments.

---

## Delivery and ACK Model

### Happy path

1. Sender writes `.md` file to recipient's inbox
2. Recipient's polling loop detects file, processes it
3. Recipient writes `.ack` to sender's inbox
4. Sender detects `.ack` — delivery confirmed

### Failure handling

Uniform timeout windows (tune per-priority in a future revision):

| Step | Trigger | Action |
|------|---------|--------|
| Retry 1 | No ACK after 5 min | Resend message |
| Retry 2 | No ACK after 10 min | Resend message |
| Escalate | No ACK after 15 min | Deliver to escalation target (if configured) |
| Flag | No ACK after 25 min | Write to human-review queue; no further retries |

If no escalation path is configured for the recipient, skip the escalate step and go directly to flag at 15 minutes.

---

## Retention Policy

| Category | Hot retention | Archive |
|----------|--------------|---------|
| Operational messages | 14 days | Indefinite in archive/ |
| Heartbeats / status pings | 3 days | Not archived |
| Escalation / critical | 30 days hot → 90 days compressed | 1 year |
| ACKs | Same as originating message | Same |

Read messages are moved to `archive/` immediately on consumption — never deleted from archive.

---

## Polling

Sessions poll on a schedule. The check command is silent when the inbox is empty.

```bash
check-mailbox <wsl-instance> <session-name>
```

### Recommended intervals

| Condition | Interval |
|-----------|----------|
| Session start or recent message | 1 minute |
| No messages for 30+ minutes | 30 minutes |
| Message received while on 30m | Switch back to 1 minute |

---

## Registry

Central session registry at `/mnt/c/temp/messages/MESSAGING.md`. Contains:
- WSL instance, session name, role description, mailbox path
- Human-maintained — sessions register themselves but cannot modify other entries or permission rules

---

## Known Gaps (Phase 1)

| Gap | Impact | Resolution |
|-----|--------|------------|
| Poll-based delivery | Up to 1-minute latency | Acceptable for Phase 1 |
| No ACK automation | Sessions must implement ack logic manually | Automate in `check-mailbox` v2 |
| No failure/retry automation | Sender must manually check for missing ACKs | Build `mailbox-watchdog` script in Phase 2 |
| Cross-WSL write requires Windows path | All sessions must mount `/mnt/c/temp/messages/` | Works on current setup; document as requirement |
| g3-planning may still use local path | Won't receive cross-WSL messages | Migrate to shared path |

---

## Phased Roadmap

### Phase 1 — File-Based Polling (current)
- ✅ Shared mailbox directory at `C:\temp\messages\`
- ✅ `check-mailbox` script — silent when empty, whitelisted in allowedTools
- ✅ Session registry in MESSAGING.md
- ✅ Archive on consumption
- ⬜ ACK file writing in `check-mailbox`
- ⬜ Failure/retry watchdog script
- ⬜ Human-review queue for flagged delivery failures

### Phase 2 — Structured Namespace
- ⬜ Migrate to `C:\temp\intenx-messages\<client>\<portfolio>\<project>\` structure
- ⬜ Permission enforcement (coordinator-only cross-project writes)
- ⬜ Topic/broadcast channels within project and portfolio

### Phase 3 — Push Delivery
- ⬜ inotifywait or equivalent — instant delivery without polling
- ⬜ Telegram relay for human-visible escalations
- ⬜ Per-priority timeout configuration
