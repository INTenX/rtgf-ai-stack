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
    Mem0 memory integration        :p4d, 2026-03-10, 2026-03-20
    Client group chat wiring       :p4e, 2026-03-10, 2026-03-15

    section Phase 5
    BATON transport layer          :p5a, 2026-04-01, 2026-04-20
    Cedar policies                 :p5b, 2026-04-15, 2026-05-01
    Leash/eBPF enforcement         :p5c, 2026-05-01, 2026-05-20
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

### ✅ Phase 4 (Partial): Operations
- [x] WARD daily audit digest (`/ward` command + 7:05am scheduled)
- [x] Telegram confirmation gate for `/pull` and `/import`
- [x] Hub security bootstrap (WARD hooks + permissions.deny + ward.env)
- [ ] Mem0 — semantic per-user memory (replaces flat `.chat-history.json`)
- [ ] Client group chat wiring (add team Telegram IDs to config.yaml)

### ⬜ Phase 5: BATON + Governance
- [ ] BATON inter-session handoff transport
- [ ] Cedar declarative RBAC policies
- [ ] Leash/eBPF kernel-level enforcement (gates on Cedar)

## Current Gaps

| Gap | Impact | Fix |
|-----|--------|-----|
| ANTHROPIC_API_KEY not set on Hub | `/claude` and `/claudefast` return error | Add to `gateway/.env`, restart gateway |
| Client group chat IDs unknown | Can't route sensit-dev traffic to their key | Add bot to group, run `/whoami`, update `config.yaml` |
| `ctx/archive/raw/` not gitignored | Knowledge repos grow with raw session files | Already fixed for `rcm/archive/raw/` — check `ctx/` path |
| Hypothesis sessions accumulate | Git repo size grows unbounded | Build auto-prune cron (>30 days) |
