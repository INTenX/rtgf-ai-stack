---
skill_id: platform/litellm-key-setup
domain: platform
trigger: LiteLLM, virtual key, API key, budget, cost attribution, client key, model routing
version: "1.0"
---

# Skill: LiteLLM Virtual Key Setup

## Purpose

Provision and manage LiteLLM virtual keys for per-client or per-project AI cost attribution. Each key routes through the LiteLLM gateway with spend tracking, budget caps, and model access control.

## Gateway Details

- **Host:** Ubuntu-AI-Hub, port 4000
- **Compose file:** `~/rtgf-ai-stack/compose/gateway.yml` (project: `litellm`)
- **Master key:** in `~/.claude/hooks/ward.env` and session memory (never commit)
- **Database:** PostgreSQL via `litellm-db` container, volume `litellm-db-data`

## Create a Virtual Key

Via LiteLLM Admin UI:
```
http://<ubuntu-ai-hub-ip>:4000/ui
```

Or via API:
```bash
curl -X POST http://localhost:4000/key/generate \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "key_alias": "client-sensit-g3",
    "max_budget": 50.00,
    "budget_duration": "monthly",
    "models": ["claude-sonnet-4-6", "claude-haiku-4-5", "ollama/*"],
    "metadata": {"client": "sensit", "project": "g3-mb-tester"}
  }'
```

## Key Fields

| Field | Notes |
|-------|-------|
| `key_alias` | Human-readable name — use `client-<client>-<project>` convention |
| `max_budget` | Monthly spend cap in USD — set conservatively, increase if needed |
| `budget_duration` | `monthly` for most keys |
| `models` | Allowlist — restrict to models the client should use |
| `metadata` | Tags for spend reporting — always include `client` and `project` |

## Model Routing

LiteLLM proxies to:

| Prefix | Routes to |
|--------|-----------|
| `claude-*` | Anthropic API |
| `gpt-*`, `o1-*` | OpenAI API |
| `ollama/*` | Local Ollama (Windows AMD box) |
| `gemini-*` | Google Vertex |

Use `ollama/qwen2.5-coder:14b` for coding tasks where cost matters. Use `claude-sonnet-4-6` for complex reasoning.

## Check Spend

```bash
curl http://localhost:4000/spend/logs \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  | python3 -m json.tool
```

Or via Telegram: `/ask what is our AI spend this month`

## Service Management

```bash
# Check status
docker compose -f ~/rtgf-ai-stack/compose/gateway.yml -p litellm ps

# Restart gateway (preserves DB)
docker compose -f ~/rtgf-ai-stack/compose/gateway.yml -p litellm restart litellm-gateway

# View logs
docker compose -f ~/rtgf-ai-stack/compose/gateway.yml -p litellm logs -f litellm-gateway
```

## Attribution Model

| Layer | Covers |
|-------|--------|
| LiteLLM virtual keys | Ollama, direct API, Dispatcher agents |
| CHRONICLE session tags | Claude Code Pro, Codex CLI (flat subscription) |
| Combined reporting | Full per-client attribution (future query) |

Always set `metadata.client` when creating keys — this is required for billing reports.
