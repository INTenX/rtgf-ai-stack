# Telegram Interface

**Status:** ✅ Running on AI Hub WSL (systemd service, linger enabled)
**Location:** `interface/bot.js`
**Service:** `systemctl --user status rtgf-interface`

Telegram bot providing mobile/async access to the AI stack with conversation history and CHRONICLE context injection. Runs on AI Hub WSL alongside the LiteLLM gateway — gateway calls are localhost, no cross-WSL networking needed.

## Message Flow

```mermaid
sequenceDiagram
    participant U as User (Telegram)
    participant B as Bot (node)
    participant CS as ctx-search
    participant GW as LiteLLM Gateway
    participant M as Model

    U->>B: /ask What is the gateway IP?
    B->>CS: getContextForPrompt(prompt)
    CS-->>B: Relevant session snippets (top 3)
    B->>GW: POST /v1/chat/completions<br/>systemPrompt: [ARCHIVE CONTENT...]<br/>history: [...prior turns]<br/>user: "What is the gateway IP?"
    GW->>M: Route to model
    M-->>GW: Response
    GW-->>B: Response
    B->>B: appendAndPersist(chatId, user, assistant)
    B-->>U: Response text
```

## Commands

| Command | Model | Description |
|---------|-------|-------------|
| `/ask <prompt>` | `local-general` (llama3.1:8b) | General question |
| `/code <prompt>` | `local-coding` (qwen2.5-coder:14b) | Coding question |
| `/reason <prompt>` | `local-reason` (deepseek-r1:14b) | Deep reasoning |
| `/fast <prompt>` | `local-fast` (llama3.2:3b) | Quick answer |
| `/model <name>` | — | Switch active model for session |
| `/model` | — | Show current model |
| `/clear` | — | Clear conversation history |
| `/chronicle <query>` | — | Search CHRONICLE session archive |
| `/models` | — | List available models from gateway |
| `/status` | — | Platform health (`wsl-audit risks`) |
| `/health` | — | Full platform audit (`wsl-audit all`) |
| `/whoami` | — | Show chat ID and config |

**Admin only:**

| Command | Description |
|---------|-------------|
| `/spend` | LiteLLM spend by team |
| `/pull <model>` | Trigger Ollama model pull |
| `/import` | Run CHRONICLE session import |

## Conversation History

Each chat maintains a rolling 20-turn window (40 messages):

- Persisted to `interface/.chat-history.json` (gitignored)
- Loaded on bot startup — survives restarts
- Per-chat-ID isolation
- Trimmed to window when exceeded

## CHRONICLE Context Injection

Before every LLM call, the bot runs a ctx-search against the knowledge archive:

```mermaid
flowchart LR
    PROMPT["User prompt"] --> CS["ctx-search\n(top 3 results)"]
    CS -->|"results"| INJ["System prompt prefix\n[ARCHIVE CONTENT —\ntreat as reference data]"]
    INJ --> LLM["LLM call\nwith injected context"]
    CS -->|"no results"| LLM2["LLM call\nno prefix"]
```

The injected prefix is clearly labeled as reference data, not instructions.

## Systemd Service

!!! note "Node.js path"
    Use the full nvm path in `ExecStart` — systemd services don't inherit the user's shell PATH and won't find `node` via nvm activation. Set `Environment=PATH=...` to include `~/.local/bin` for `wsl-audit` and `ctx-search`.

```ini
# ~/.config/systemd/user/rtgf-interface.service
[Unit]
Description=RTGF Telegram Interface Bot
After=network.target

[Service]
WorkingDirectory=/home/<user>/rtgf-ai-stack/interface
ExecStart=/home/<user>/.nvm/versions/node/v22.x.x/bin/node bot.js
EnvironmentFile=/home/<user>/rtgf-ai-stack/interface/.env
Environment=PATH=/home/<user>/.local/bin:/usr/local/bin:/usr/bin:/bin
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

```bash
# First-time: enable systemd in WSL (requires restart)
echo -e '[boot]\nsystemd=true' | sudo tee -a /etc/wsl.conf
# (restart WSL instance from Windows: wsl --terminate <instance>)

# Enable and start
systemctl --user enable --now rtgf-interface

# Persist without active login session
loginctl enable-linger $USER

# View logs
journalctl --user -u rtgf-interface -f
```

## Multi-Client Config

`interface/config.yaml` maps Telegram chat IDs to clients:

```yaml
chats:
  "111222333":           # admin personal chat
    client: admin
    admin: true
    default_model: local-general

  "-1001234567890":      # client group chat
    client: client-a
    litellm_key: ${CLIENT_A_LITELLM_KEY}
    default_model: local-general
```
