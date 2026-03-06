# LiteLLM Gateway

**Status:** ✅ Deployed (AI Hub WSL — gateway host)
**Location:** `gateway/` + `compose/gateway.yml`
**Endpoint:** `http://<hub-ip>:4000/v1`

Single OpenAI-compatible proxy routing all model calls with per-client budget enforcement.

## Request Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant G as LiteLLM :4000
    participant DB as PostgreSQL
    participant OL as Ollama
    participant AN as Anthropic

    C->>G: POST /v1/chat/completions<br/>Authorization: Bearer <virtual-key>
    G->>DB: Validate key + check budget
    alt over budget
        DB-->>G: 429 Budget exceeded
        G-->>C: 429 Budget limit reached
    else within budget
        DB-->>G: OK
        G->>G: Resolve model alias
        alt local-* alias + Ollama up
            G->>OL: Forward to Ollama
            OL-->>G: Response
        else Ollama down or cloud model
            G->>AN: Forward to Anthropic
            AN-->>G: Response
        end
        G->>DB: Record spend
        G-->>C: Response
    end
```

## Model Aliases

**Local (Ollama):**

| Alias | Backend |
|-------|---------|
| `local-general` | `ollama/llama3.1:8b` |
| `local-coding` | `ollama/qwen2.5-coder:14b` |
| `local-reasoning` | `ollama/deepseek-r1:14b` |
| `local-fast` | `ollama/llama3.2:3b` |
| `local-compact` | `ollama/phi4-mini` |
| `local-coding-fast` | `ollama/qwen2.5-coder:7b` |

**Cloud (Anthropic):**

| Alias | Backend | Required env |
|-------|---------|-------------|
| `claude-sonnet` | `anthropic/claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| `claude-haiku` | `anthropic/claude-haiku-4-5-20251001` | `ANTHROPIC_API_KEY` |

Cloud models are enabled by adding `ANTHROPIC_API_KEY` to `gateway/.env` and restarting the gateway.

## Client Key Setup

```bash
# Create a virtual key with monthly budget
bash gateway/setup-client.sh <client-name> <monthly-budget-usd>

# Example
bash gateway/setup-client.sh intenx 200
bash gateway/setup-client.sh sensit 50
```

Keys are stored in `gateway/client-keys/` (gitignored).

## Deployment

```yaml
# compose/gateway.yml (key services)
services:
  litellm:
    image: ghcr.io/berriai/litellm:main-latest
    ports: ["4000:4000"]
    environment:
      DATABASE_URL: postgresql://litellm:litellm@db:5432/litellm
      LITELLM_MASTER_KEY: ${LITELLM_MASTER_KEY}
    depends_on: [db]
    restart: unless-stopped

  db:
    image: postgres:15
    volumes: [litellm-db:/var/lib/postgresql/data]
    restart: unless-stopped
```

## Configuration

`gateway/config.yaml` defines model routing:

```yaml
model_list:
  - model_name: local-general
    litellm_params:
      model: ollama/llama3.1:8b
      api_base: http://host.docker.internal:11434

general_settings:
  store_model_in_db: true
  database_url: "os.environ/DATABASE_URL"
```

## Dashboard

LiteLLM UI at `http://<hub-ip>:4000/ui` — shows spend by team, model usage, key management.
