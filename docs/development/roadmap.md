# Roadmap

## Phase Status

```mermaid
gantt
    title RTGF AI Stack — Phase Delivery
    dateFormat YYYY-MM-DD
    axisFormat %b %Y

    section Phase 0-1
    Foundation + wsl-audit         :done, p1, 2026-01-01, 2026-02-15

    section Phase 2
    WARD hooks                     :done, p2a, 2026-02-15, 2026-02-22
    LiteLLM gateway + PostgreSQL   :done, p2b, 2026-02-15, 2026-02-22
    wsl-audit event log            :done, p2c, 2026-02-15, 2026-02-22

    section Phase 3
    ctx-search CLI (MiniSearch BM25) :done, p3a, 2026-02-22, 2026-03-01
    Telegram bot + conversation history :done, p3b, 2026-02-22, 2026-03-05
    CHRONICLE context injection     :done, p3c, 2026-02-22, 2026-03-05
    Bot migration to AI Hub WSL    :done, p3d, 2026-03-05, 2026-03-06
    WARD Telegram alerts           :done, p3e, 2026-03-06, 2026-03-06
    Daily import cron + Hub pull   :done, p3f, 2026-03-06, 2026-03-06
    ChatGPT + Gemini adapters      :done, p3g, 2026-03-06, 2026-03-06

    section Phase 4
    WARD audit digest + /ward cmd  :done, p4a, 2026-03-06, 2026-03-06
    Telegram confirmation gate     :done, p4b, 2026-03-06, 2026-03-06
    Hub security bootstrap         :done, p4c, 2026-03-06, 2026-03-06
    Intent classifier routing      :done, p4d, 2026-03-06, 2026-03-10
    LanceDB semantic search        :done, p4e, 2026-03-10, 2026-03-14
    BATON Phase 2 CLI              :done, p4f, 2026-03-14, 2026-03-14
    Wrap signal detector cron      :done, p4g, 2026-03-14, 2026-03-14
    Auto-prune hypothesis cron     :done, p4h, 2026-03-14, 2026-03-14
    CI/CD cron + hook registration :done, p4i, 2026-03-14, 2026-03-14
    Security audit + hardening     :done, p4j, 2026-03-14, 2026-03-14
    Mem0 memory integration        :p4k, 2026-03-20, 2026-04-01
    Client group chat wiring       :p4l, 2026-03-20, 2026-03-30

    section Phase 5
    BATON session registry         :p5a, 2026-04-01, 2026-04-10
    BATON spawn model              :p5b, 2026-04-10, 2026-04-20
    Cedar policies                 :p5c, 2026-04-15, 2026-05-01
    Leash/eBPF enforcement         :p5d, 2026-05-01, 2026-05-20
```

## Detailed Phase Breakdown

### ✅ Phase 0–1: Foundation
- Ollama running on Windows AMD GPU
- wsl-audit platform health tool
- CHRONICLE session archival (100+ sessions)
- Knowledge repos deployed (6 repos on GitHub INTenX org)
- LibreChat web UI

### ✅ Phase 2: Security Foundation
- WARD Claude Code hooks (`hooks/`)
- LiteLLM gateway deployed on Ubuntu-AI-Hub
- PostgreSQL backend for spend tracking
- Per-client virtual key isolation (`setup-client.sh`)
- wsl-audit event log + Telegram CRIT alerts
- CHRONICLE security fields (flow_state, quality_score)

### ✅ Phase 3: Context + Interface
- [x] ctx-search CLI (MiniSearch BM25)
- [x] Telegram bot with conversation history
- [x] CHRONICLE context injection in every LLM call
- [x] systemd service on Ubuntu-AI-Hub (survives reboots)
- [x] Self-healing gateway discovery
- [x] Bot migrated to AI Hub WSL alongside gateway
- [x] WARD Telegram block alerts (phone notification on block)
- [x] Daily CHRONICLE import cron (INTenXDev → GitHub → Hub pull)
- [x] ChatGPT import (`chronicle-import-chatgpt`)
- [x] Gemini import (`chronicle-import-gemini`)
- [x] LiteLLM client keys for intenx-dev ($100/mo) and sensit-dev ($50/mo)
- [x] /claude + /claudefast commands (Anthropic models, needs ANTHROPIC_API_KEY)

### ✅ Phase 4 (Partial): Operations + Automation
- [x] WARD daily audit digest (`/ward` command + 7:05am scheduled)
- [x] Telegram confirmation gate for `/pull` and `/import`
- [x] Hub security bootstrap (WARD hooks + permissions.deny + ward.env)
- [x] Intent classifier — automatic model routing (coding vs general vs fast) in bot
- [x] LanceDB semantic search layer for CHRONICLE
- [x] BATON Phase 2 — `baton` CLI (drop/list/claim/complete/show/abandon)
- [x] Wrap signal detector — hourly cron, Telegram alert on compaction/age/size
- [x] Auto-prune hypothesis sessions — weekly cron (30d stale, no curation)
- [x] CI/CD cron registration — all crons registered idempotently on deploy
- [x] Security audit + hardening — 6 shell injection fixes (`execFileSync` array form), `bash-credential-file` WARD pattern, path traversal guard in `check-mailbox`, frontmatter injection guard in MCP server
- [ ] Mem0 — semantic per-user memory (replaces flat `.chat-history.json`)
- [ ] Client group chat wiring (add team Telegram IDs to config.yaml)

### ⬜ Phase 5: BATON + Governance
- [ ] BATON session registry (`registry.json`) — live index of what's running
- [ ] BATON spawn model — `baton-spawn` via headless claude or tmux injection
- [ ] Cedar declarative RBAC policies
- [ ] Leash/eBPF kernel-level enforcement (gates on Cedar)

## Current Gaps

| Gap | Impact | Fix |
|-----|--------|-----|
| **GW-002** ANTHROPIC_API_KEY expired on Hub | `/claude` and `/claudefast` return auth error | Refresh key in `compose/gateway.env` on Ubuntu-AI-Hub, restart `litellm-gateway` |
| Client group chat IDs unknown | Can't route sensit-dev traffic to their key | Add bot to group, run `/whoami`, update `config.yaml` |
| BATON registry not built | Sessions can't discover each other | Phase 5: build registry.json + heartbeat integration |
| Mem0 not integrated | Per-user memory is flat JSON | Phase 5: swap `.chat-history.json` for Mem0 graph |
