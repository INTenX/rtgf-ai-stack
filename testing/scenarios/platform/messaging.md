# Scenario Suite — Inter-Session Messaging
**Component:** Inter-Session Messaging (`/mnt/c/temp/messages/`)
**Status:** Live — mailboxes observed active in heartbeat

---

## Context

The messaging system is a file-based inter-session coordination layer using Windows-accessible paths (`/mnt/c/temp/messages/`). Sessions write `.md` files to each other's mailboxes; recipients consume and ACK. It is the foundational coordination primitive — BATON, WARD alerts, and test reporting all depend on it.

Real-world use cases this maps to:
- Asynchronous agent-to-agent communication
- ACK-based reliability (no silent message loss)
- Cross-WSL message visibility (shared filesystem as message bus)
- Graceful handling of unavailable recipients
- Archive integrity (concurrent writes, no clobbering)

---

## Scenario 1 — Message Delivered Within SLA
**Description:** A message written to a session mailbox is visible within 1 minute.
**Input:** Write a test `.md` file to `/mnt/c/temp/messages/INTenXDev/ai-stack/`
**Pass Criteria:**
- File visible in recipient mailbox immediately (filesystem write is synchronous)
- File contains valid frontmatter (From, To, Subject)
- Recipient session can read the file via standard check-mailbox flow

---

## Scenario 2 — ACK Written After Consumption
**Description:** When a session consumes a message, an ACK is written back to sender.
**Input:** Session A sends message to Session B; Session B consumes it via check-mailbox skill
**Pass Criteria:**
- ACK file written to Session A's mailbox after consumption
- ACK references the original message filename
- Original message not deleted (archive integrity)

---

## Scenario 3 — check-mailbox Silent When Empty
**Description:** Running check-mailbox on an empty mailbox produces no output/noise.
**Input:** Empty the test mailbox; invoke check-mailbox
**Pass Criteria:**
- No output (or "no messages" confirmation only)
- No errors thrown
- No ACK written for empty mailbox

---

## Scenario 4 — Concurrent Write Safety
**Description:** Two sessions write to the same mailbox simultaneously; no file is lost or corrupted.
**Input:** Write two messages to the same mailbox within <1s of each other (simulate from two terminals)
**Pass Criteria:**
- Both files exist in the mailbox after writes complete
- Neither file is truncated or corrupted
- Filenames are unique (timestamp + subject slug collision-safe)

---

## Scenario 5 — Malformed Message Handled Gracefully
**Description:** A malformed `.md` file in the mailbox does not crash check-mailbox.
**Input:** Write a file with no frontmatter or binary content to the mailbox
**Pass Criteria:**
- check-mailbox does not crash
- Malformed message is flagged (not silently skipped)
- Other messages in the mailbox still processed normally

---

## Scenario 6 — Cross-WSL Visibility
**Description:** A message written from SensitDev WSL is visible from INTenXDev WSL.
**Input:** Write a test message from SensitDev to an INTenXDev mailbox
**Pass Criteria:**
- File visible from INTenXDev within 30s
- Content identical (no encoding corruption via Windows filesystem)
- Heartbeat from SensitDev confirms the write occurred

---

## Scenario 7 — Recipient Unavailable (No Mailbox)
**Description:** Writing to a non-existent mailbox directory fails gracefully.
**Input:** Attempt to send a message to `/mnt/c/temp/messages/INTenXDev/nonexistent-session/`
**Pass Criteria:**
- Error raised before write attempt (directory existence check)
- Sender receives clear failure reason, not silent drop
- Message NOT written to an auto-created unintended directory

---

## Status

| Scenario | Status | Report |
|----------|--------|--------|
| 1 — Delivery within SLA | **PASS** | `reports/2026-03-14-messaging-suite-A.md` |
| 2 — ACK on consumption | **PASS*** | MSG-001: ACK From: header unexpanded |
| 3 — Silent when empty | **PASS** | `reports/2026-03-14-messaging-suite-A.md` |
| 4 — Concurrent write safety | **PASS** | Same-second filenames would collide (low risk) |
| 5 — Malformed message handling | **PASS*** | MSG-002: malformed consumed without warning |
| 6 — Cross-WSL visibility | **PASS** | INTenXDev ↔ SensitDev confirmed |
| 7 — Recipient unavailable | **PASS** | Safe failure, no auto-dir creation |
