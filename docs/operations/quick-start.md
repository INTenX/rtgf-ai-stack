# Quick Start

## Environment

**Tested with:**

- WSL2 on Windows 11, Ubuntu 22.04+ distros
- Two WSL instances: one for development (Dev WSL), one as gateway host (AI Hub WSL)
- Ollama on Windows with a GPU (AMD or NVIDIA); CPU-only works but is slow
- Docker Desktop or Docker Engine on the gateway host WSL
- Node.js 18+ on the Dev WSL (tested with v22)
- Telegram bot token via [BotFather](https://t.me/BotFather) (required for the interface)

A single WSL instance works for testing — just run both the gateway and bot on the same machine.

## 1. Start Ollama

```powershell
# Windows — start Ollama server (not the app icon)
& "C:\Users\<user>\AppData\Local\Programs\Ollama\ollama.exe" serve
```

Or from WSL:
```bash
source /mnt/c/Temp/wsl-shared/ollama-setup.sh
```

## 2. Start LiteLLM Gateway (AI Hub WSL)

```bash
cd ~/rtgf-ai-stack
# Fill in secrets first
cp gateway/.env.example gateway/.env
# Edit gateway/.env with LITELLM_MASTER_KEY

docker compose -f compose/gateway.yml up -d
```

Verify: `curl http://localhost:4000/health`

## 3. Start Telegram Bot (AI Hub WSL)

Run the bot on the same WSL instance as the gateway — `GATEWAY_URL=http://localhost:4000`, no cross-WSL routing needed.

```bash
# Node.js via nvm — install if not present
curl -o /tmp/nvm-install.sh https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh
bash /tmp/nvm-install.sh
bash -i -c 'nvm install 22'

# Symlink node/npm for systemd (doesn't inherit nvm)
ln -sf ~/.nvm/versions/node/v22.*/bin/node ~/.local/bin/node
ln -sf ~/.nvm/versions/node/v22.*/bin/npm ~/.local/bin/npm

# Install bot + chronicle dependencies
cd ~/rtgf-ai-stack/interface && npm install
cd ~/rtgf-ai-stack/chronicle && npm install

# Clone knowledge repos for CHRONICLE context injection
for repo in intenx-knowledge sensit-knowledge makanui-knowledge ratio11-knowledge beaglebone-knowledge test-knowledge; do
  git clone --depth 1 https://github.com/INTenX/$repo.git ~/$repo
done

# Fill in secrets
cp .env.example interface/.env
# Edit interface/.env: TELEGRAM_TOKEN, GATEWAY_URL=http://localhost:4000, LITELLM_MASTER_KEY, ADMIN_CHAT_ID

# Enable systemd (if not already — requires WSL restart)
echo -e '[boot]\nsystemd=true' | sudo tee -a /etc/wsl.conf

# Enable and start service
systemctl --user enable --now rtgf-interface
loginctl enable-linger $USER

# Check it's running
journalctl --user -u rtgf-interface -f
```

## 4. Activate WARD Hooks

```bash
bash ~/rtgf-ai-stack/hooks/install-hooks.sh
# Edit ~/.claude/hooks/ward.env with TELEGRAM_TOKEN and TELEGRAM_CHAT_ID
```

## 5. Verify Everything

In Telegram, send `/help` to your bot — you should see the full command menu.

| Check | Command |
|-------|---------|
| Gateway health | `/models` |
| Platform health | `/status` |
| Your chat ID | `/whoami` |
| CHRONICLE search | `/chronicle test query` |

## Common Issues

### "Error fetching models: user aborted a request"

Ollama unreachable or LiteLLM not connected to DB.

```bash
# On AI Hub WSL
docker compose -f compose/gateway.yml ps
docker compose -f compose/gateway.yml logs litellm | tail -20
```

### Bot not responding after Windows reboot

Gateway IP changed. The bot auto-discovers — wait ~5s and retry. If persistent:

```bash
# Check what IP gateway is on now (from Dev WSL)
ip route show
```

### "Budget limit reached"

```bash
# Create or reset a key (on AI Hub WSL)
bash ~/rtgf-ai-stack/gateway/setup-client.sh <client> <budget>
# Update LITELLM_DEFAULT_KEY in interface/.env
```
