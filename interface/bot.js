'use strict'

require('dotenv').config()

const fs = require('fs')
const path = require('path')
const TelegramBot = require('node-telegram-bot-api')
const cron = require('node-cron')
const { loadConfig, chatConfig, isAdmin, modelForCommand } = require('./lib/config')
const { ask, listModels, spendSummary } = require('./lib/gateway')
const { searchLore, getContextForPrompt } = require('./lib/chronicle')
const { wslAudit, pullModel, ollamaModels, loreImport, wardDigest, batonList, batonDrop, batonShow, batonDropRelay, batonCheckResult } = require('./lib/tools')
const { dispatchTask, AGENT_TYPES } = require('./lib/dispatcher')
const { classify: classifyIntent } = require('./lib/intent')

// ─── History persistence ──────────────────────────────────────────────────────

const HISTORY_FILE = path.join(__dirname, '.chat-history.json')
const MAX_HISTORY_TURNS = 20  // keep last N user+assistant pairs (40 messages)

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveHistory(allHistory) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(allHistory, null, 2))
  } catch (err) {
    console.error('Failed to save chat history:', err.message)
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────

const TOKEN = process.env.TELEGRAM_TOKEN
if (!TOKEN) {
  console.error('TELEGRAM_TOKEN not set. Copy .env.example to .env and fill in values.')
  process.exit(1)
}

const config = loadConfig()
const bot = new TelegramBot(TOKEN, { polling: true })

// Resolve Ollama host for intent classifier (same logic as ollama-setup.sh)
const { execSync } = require('child_process')
let OLLAMA_HOST_URL = process.env.OLLAMA_HOST || null
if (!OLLAMA_HOST_URL) {
  try {
    const gwIp = execSync("ip route show default | awk '{print $3}'", { encoding: 'utf8' }).trim()
    OLLAMA_HOST_URL = `http://${gwIp}:11434`
  } catch { /* leave null — classifier will use rule-based only */ }
}

// Per-chat runtime state (model overrides, conversation history)
const chatState = {}
const persistedHistory = loadHistory()

function getState(chatId) {
  const id = String(chatId)
  if (!chatState[id]) {
    chatState[id] = {
      model: null,
      history: persistedHistory[id] ?? []
    }
  }
  return chatState[id]
}

function appendAndPersist(chatId, userMsg, assistantMsg) {
  const id = String(chatId)
  const state = getState(chatId)
  state.history.push({ role: 'user', content: userMsg })
  state.history.push({ role: 'assistant', content: assistantMsg })
  // Trim to rolling window (each turn = 2 messages)
  if (state.history.length > MAX_HISTORY_TURNS * 2) {
    state.history = state.history.slice(-MAX_HISTORY_TURNS * 2)
  }
  persistedHistory[id] = state.history
  saveHistory(persistedHistory)
}

console.log('rtgf-interface starting — polling Telegram...')

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Telegram max message length is 4096 chars. Split long output into chunks.
async function send(chatId, text) {
  const MAX = 4000
  const chunks = []
  for (let i = 0; i < text.length; i += MAX) {
    chunks.push(text.slice(i, i + MAX))
  }
  for (const chunk of chunks) {
    await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' })
      .catch(() => bot.sendMessage(chatId, chunk))  // retry without markdown if it fails
  }
}

// Strip ANSI color codes from tool output
function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*m/g, '')
}

// Resolve active model for a chat (override → config default → global default)
function activeModel(chatId, commandModel = null) {
  const state = getState(chatId)
  if (commandModel) return commandModel
  if (state.model) return state.model
  return chatConfig(chatId)?.default_model ?? 'local-general'
}

// ─── Commands ─────────────────────────────────────────────────────────────────

bot.onText(/\/start|\/help/, async (msg) => {
  const chatId = msg.chat.id
  const cfg = chatConfig(chatId)
  const model = activeModel(chatId)

  const adminCommands = isAdmin(chatId) ? `
*Admin:*
/spend — LiteLLM spend by team
/pull <model> — Trigger Ollama model pull
/import — Run CHRONICLE session import
/ward [YYYY-MM-DD] — WARD security event digest (yesterday by default)` : ''

  await send(chatId, `*rtgf-interface* — INTenX AI Stack
Client: ${cfg?.client ?? 'personal'} | Model: \`${model}\`

*Ask (local):*
/ask <prompt> — General question (${modelForCommand('ask')})
/code <prompt> — Coding question (${modelForCommand('code')})
/reason <prompt> — Deep reasoning (${modelForCommand('reason')})
/fast <prompt> — Quick answer (${modelForCommand('fast')})

*Ask (cloud):*
/claude <prompt> — Claude Sonnet (${modelForCommand('claude')})
/claudefast <prompt> — Claude Haiku (${modelForCommand('claude-fast')})

*Stack:*
/status — Platform health (wsl-audit risks)
/health — Full platform audit (wsl-audit all)
/models — Available models
/chronicle <query> — Search CHRONICLE session archive
/dispatch <type> <goal> — Run a focused agent task (research/code/write/analyze)
/relay <session> <message> — Inject message into a named running session
/baton [list|drop|show] — Inter-session task coordination

*Settings:*
/model <name> — Switch active model for this chat
/model — Show current model
/clear — Clear conversation history
/whoami — Show your chat ID and config
${adminCommands}`)
})

bot.onText(/\/whoami/, async (msg) => {
  const chatId = msg.chat.id
  const cfg = chatConfig(chatId)
  await send(chatId, `*Chat ID:* \`${chatId}\`
*Type:* ${msg.chat.type}
*Client:* ${cfg?.client ?? 'default'}
*Model:* ${activeModel(chatId)}
*Admin:* ${isAdmin(chatId) ? 'yes' : 'no'}`)
})

// ── Model switching ────────────────────────────────────────────────────────────

bot.onText(/\/model(?!\w)(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id
  const state = getState(chatId)
  const requested = match[1]?.trim()

  if (!requested) {
    await send(chatId, `Current model: \`${activeModel(chatId)}\`\nUsage: /model <name>`)
    return
  }

  state.model = requested
  await send(chatId, `Model set to \`${requested}\` for this session.`)
})

// ── Conversation history management ───────────────────────────────────────────

bot.onText(/\/clear/, async (msg) => {
  const chatId = msg.chat.id
  const id = String(chatId)
  if (chatState[id]) chatState[id].history = []
  delete persistedHistory[id]
  saveHistory(persistedHistory)
  await send(chatId, 'Conversation history cleared.')
})

// ── AI queries ────────────────────────────────────────────────────────────────

async function handleAsk(msg, prompt, model) {
  const chatId = msg.chat.id
  if (!prompt) {
    await send(chatId, 'Usage: /ask <your question>')
    return
  }
  await bot.sendChatAction(chatId, 'typing')
  try {
    const state = getState(chatId)
    // Run ctx-search concurrently with nothing else pending — adds ~1s, negligible vs LLM latency
    const systemPrompt = await getContextForPrompt(prompt)
    const response = await ask(chatId, model, prompt, { history: state.history, systemPrompt })
    appendAndPersist(chatId, prompt, response)
    await send(chatId, response)
  } catch (err) {
    await send(chatId, `Error: ${err.message}`)
  }
}

bot.onText(/\/ask(?:\s+(.+))?/s, async (msg, match) => {
  await handleAsk(msg, match[1]?.trim(), activeModel(msg.chat.id, modelForCommand('ask')))
})

bot.onText(/\/code(?:\s+(.+))?/s, async (msg, match) => {
  await handleAsk(msg, match[1]?.trim(), activeModel(msg.chat.id, modelForCommand('code')))
})

bot.onText(/\/reason(?:\s+(.+))?/s, async (msg, match) => {
  await handleAsk(msg, match[1]?.trim(), activeModel(msg.chat.id, modelForCommand('reason')))
})

bot.onText(/\/fast(?:\s+(.+))?/s, async (msg, match) => {
  await handleAsk(msg, match[1]?.trim(), activeModel(msg.chat.id, modelForCommand('fast')))
})

bot.onText(/\/claude(?:fast)?(?:\s+(.+))?/s, async (msg, match) => {
  const isFast = msg.text?.startsWith('/claudefast')
  const modelKey = isFast ? 'claude-fast' : 'claude'
  await handleAsk(msg, match[1]?.trim(), modelForCommand(modelKey))
})

// Non-command messages in private chats → classify intent, route to best model
bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return
  if (msg.chat.type !== 'private') return  // groups: require explicit command

  const chatId = msg.chat.id
  await bot.sendChatAction(chatId, 'typing')
  try {
    const state = getState(chatId)

    // Classify intent and pick model — use rule-based path (fast), try LLM if Ollama available
    const classification = await classifyIntent(msg.text, {
      ollamaHost: OLLAMA_HOST_URL,
      useLlm: true,
      fallback: 'general',
    })
    const model = activeModel(chatId, modelForCommand(classification.model_key))
    console.log(`[intent] "${msg.text.slice(0,60)}" → ${classification.intent} (${classification.method}) → ${model}`)

    const response = await ask(chatId, model, msg.text, { history: state.history })
    appendAndPersist(chatId, msg.text, response)
    await send(chatId, response)
  } catch (err) {
    await send(chatId, `Error: ${err.message}`)
  }
})

// ── Stack tools ───────────────────────────────────────────────────────────────

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id
  await bot.sendChatAction(chatId, 'typing')
  const output = stripAnsi(wslAudit('risks'))
  await send(chatId, `\`\`\`\n${output}\n\`\`\``)
})

bot.onText(/\/health/, async (msg) => {
  const chatId = msg.chat.id
  await bot.sendChatAction(chatId, 'typing')
  const output = stripAnsi(wslAudit('all'))
  await send(chatId, `\`\`\`\n${output}\n\`\`\``)
})

bot.onText(/\/ward(?:\s+(\d{4}-\d{2}-\d{2}))?/, async (msg, match) => {
  const chatId = msg.chat.id
  if (!isAdmin(chatId)) {
    await send(chatId, 'Admin only.')
    return
  }
  await bot.sendChatAction(chatId, 'typing')
  const date = match[1]?.trim() ?? null  // optional YYYY-MM-DD, defaults to yesterday
  await send(chatId, wardDigest(date))
})

bot.onText(/\/models/, async (msg) => {
  const chatId = msg.chat.id
  await bot.sendChatAction(chatId, 'typing')
  try {
    // Try gateway first, fall back to Ollama direct
    let lines = []
    try {
      const models = await listModels()
      lines = models.map(m => `• \`${m}\``)
    } catch {
      const models = await ollamaModels()
      lines = models
    }
    await send(chatId, `*Available models:*\n${lines.join('\n')}`)
  } catch (err) {
    await send(chatId, `Error fetching models: ${err.message}`)
  }
})

bot.onText(/\/chronicle(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id
  const query = match[1]?.trim()
  if (!query) {
    await send(chatId, 'Usage: /chronicle <search query>')
    return
  }
  await bot.sendChatAction(chatId, 'typing')
  const results = await searchLore(query)
  if (!results) {
    await send(chatId, `No CHRONICLE sessions found matching: ${query}`)
    return
  }
  await send(chatId, `*CHRONICLE sessions matching "${query}":*\n${results}`)
})

// ── BATON ─────────────────────────────────────────────────────────────────────

bot.onText(/\/baton(?:\s+(.+))?/s, async (msg, match) => {
  const chatId = msg.chat.id
  const input = match[1]?.trim()

  if (!input || input === 'list') {
    const output = batonList(false)
    await send(chatId, `*Pending batons:*\n${output}`)
    return
  }

  if (input === 'all') {
    const output = batonList(true)
    await send(chatId, `*All batons:*\n${output}`)
    return
  }

  if (input.startsWith('show ')) {
    const id = input.slice(5).trim()
    await send(chatId, batonShow(id))
    return
  }

  if (input.startsWith('drop ')) {
    const subject = input.slice(5).trim()
    if (!subject) { await send(chatId, 'Usage: /baton drop <subject>'); return }
    const id = batonDrop(subject)
    await send(chatId, `Baton dropped: \`${id}\`\n_${subject}_`)
    return
  }

  await send(chatId, `*BATON commands:*
/baton list — pending batons
/baton all — all batons
/baton drop <subject> — drop a new task baton
/baton show <id> — full detail`)
})

// ── Relay — inject message into a named running session via BATON ─────────────

bot.onText(/\/relay(?:\s+(\S+)(?:\s+(.+))?)?/s, async (msg, match) => {
  const chatId = msg.chat.id
  if (!isAdmin(chatId)) { await send(chatId, 'Admin only.'); return }

  const sessionName = match[1]?.trim()
  const message = match[2]?.trim()

  if (!sessionName || !message) {
    await send(chatId, `Usage: /relay <session-name> <message>\n\nExample:\n/relay "AI Stack" what's the current task?`)
    return
  }

  const id = batonDropRelay(sessionName, message)
  const short = id.slice(0, 8)
  await send(chatId, `Relay dropped → \`${short}\`\nTarget: *${sessionName}*\n\nWaiting for response (up to 5min)…`)

  // Poll completed/ for the result — non-blocking, runs in background
  const TIMEOUT = 5 * 60 * 1000
  const INTERVAL = 10 * 1000
  const deadline = Date.now() + TIMEOUT
  const poll = setInterval(async () => {
    const result = batonCheckResult(short)
    if (result !== null) {
      clearInterval(poll)
      const trimmed = result.slice(-3000)  // cap at 3000 chars for Telegram
      await send(chatId, `*Relay response from ${sessionName}:*\n\n${trimmed}`)
    } else if (Date.now() > deadline) {
      clearInterval(poll)
      await send(chatId, `No response from *${sessionName}* within 5 minutes.\nCheck with: /baton show ${short}`)
    }
  }, INTERVAL)
})

// ── Agent dispatch ────────────────────────────────────────────────────────────

bot.onText(/\/dispatch(?:\s+(\w+)(?:\s+(.+))?)?/s, async (msg, match) => {
  const chatId = msg.chat.id
  const type = match[1]?.trim()
  const goal = match[2]?.trim()

  if (!type || !goal) {
    await send(chatId, `Usage: /dispatch <type> <goal>\n\nTypes: ${AGENT_TYPES.join(', ')}\n\nExample:\n/dispatch research What are the trade-offs of LanceDB vs Meilisearch?`)
    return
  }

  if (!AGENT_TYPES.includes(type)) {
    await send(chatId, `Unknown type: \`${type}\`\nValid types: ${AGENT_TYPES.join(', ')}`)
    return
  }

  const { randomUUID } = require('crypto')
  const taskId = randomUUID()
  const keepalive = setInterval(() => bot.sendChatAction(chatId, 'typing').catch(() => {}), 4000)
  await bot.sendChatAction(chatId, 'typing')

  try {
    const result = await dispatchTask({
      taskId,
      type,
      goal,
      constraints: { model: modelForCommand('claude') },
      callback: { type: 'telegram', chat_id: chatId },
    })

    clearInterval(keepalive)

    if (result.status === 'completed') {
      await send(chatId, result.result)
    } else {
      await send(chatId, `Dispatch failed: ${result.result}`)
    }
  } catch (err) {
    clearInterval(keepalive)
    await send(chatId, `Error: ${err.message}`)
  }
})

// ── Confirmation gate ─────────────────────────────────────────────────────────
// Stores one pending operation per chat. Expires after 60s.

const pendingConfirm = {}  // chatId (string) → { op, args, messageId, expiresAt }

async function confirmPrompt(chatId, op, args, label) {
  const msg = await bot.sendMessage(chatId, `Confirm: *${label}*?`, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Confirm', callback_data: `confirm:${op}` },
        { text: '❌ Cancel',  callback_data: 'cancel' }
      ]]
    }
  })
  pendingConfirm[String(chatId)] = { op, args, messageId: msg.message_id, expiresAt: Date.now() + 60_000 }
}

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id
  const id = String(chatId)
  const data = query.data

  await bot.answerCallbackQuery(query.id)

  const pending = pendingConfirm[id]

  if (!pending || Date.now() > pending.expiresAt) {
    await bot.editMessageText('⏱ Expired.', { chat_id: chatId, message_id: query.message.message_id })
      .catch(() => {})
    delete pendingConfirm[id]
    return
  }

  if (data === 'cancel') {
    await bot.editMessageText('❌ Cancelled.', { chat_id: chatId, message_id: query.message.message_id })
      .catch(() => {})
    delete pendingConfirm[id]
    return
  }

  if (data === `confirm:${pending.op}`) {
    await bot.editMessageText('⏳ Running…', { chat_id: chatId, message_id: query.message.message_id })
      .catch(() => {})
    const { op, args } = pending
    delete pendingConfirm[id]

    try {
      if (op === 'pull') {
        const result = await pullModel(args.modelName)
        await send(chatId, result)
      } else if (op === 'import') {
        const output = loreImport()
        await send(chatId, `\`\`\`\n${output}\n\`\`\``)
      }
    } catch (err) {
      await send(chatId, `Error: ${err.message}`)
    }
  }
})

// ── Admin commands ────────────────────────────────────────────────────────────

bot.onText(/\/spend/, async (msg) => {
  const chatId = msg.chat.id
  if (!isAdmin(chatId)) {
    await send(chatId, 'Admin only.')
    return
  }
  await bot.sendChatAction(chatId, 'typing')
  try {
    const data = await spendSummary()
    if (!data?.length) {
      await send(chatId, 'No spend data yet. Deploy the gateway and create client keys.')
      return
    }
    const lines = data.map(t =>
      `• *${t.team_alias ?? t.team_id}*: $${(t.spend ?? 0).toFixed(4)} / $${t.max_budget ?? '∞'}`
    )
    await send(chatId, `*Team spend:*\n${lines.join('\n')}`)
  } catch (err) {
    await send(chatId, `Error: ${err.message}`)
  }
})

bot.onText(/\/pull(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id
  if (!isAdmin(chatId)) {
    await send(chatId, 'Admin only.')
    return
  }
  const modelName = match[1]?.trim()
  if (!modelName) {
    await send(chatId, 'Usage: /pull <model-name>')
    return
  }
  await confirmPrompt(chatId, 'pull', { modelName }, `Pull model \`${modelName}\``)
})

bot.onText(/\/import/, async (msg) => {
  const chatId = msg.chat.id
  if (!isAdmin(chatId)) {
    await send(chatId, 'Admin only.')
    return
  }
  await confirmPrompt(chatId, 'import', {}, 'Run CHRONICLE session import')
})

// ─── Scheduled Jobs ───────────────────────────────────────────────────────────

const scheduledJobs = config.scheduled ?? []

for (const job of scheduledJobs) {
  if (!cron.validate(job.cron)) {
    console.warn(`Invalid cron expression for job "${job.name}": ${job.cron}`)
    continue
  }

  cron.schedule(job.cron, async () => {
    console.log(`Running scheduled job: ${job.name}`)
    const chatId = job.chat_id === 'default'
      ? process.env.ADMIN_CHAT_ID
      : job.chat_id

    if (!chatId) {
      console.warn(`Job "${job.name}" has no chat_id and ADMIN_CHAT_ID not set — skipping`)
      return
    }

    try {
      let output
      if (job.command === 'wsl-audit') {
        output = stripAnsi(wslAudit((job.args ?? [])[0] ?? 'risks'))
      } else if (job.command === 'spend') {
        const data = await spendSummary()
        output = data?.map(t =>
          `${t.team_alias ?? t.team_id}: $${(t.spend ?? 0).toFixed(4)}`
        ).join('\n') ?? 'No data'
      } else if (job.command === 'ward-digest') {
        const date = (job.args ?? [])[0] ?? null  // optional override date
        output = wardDigest(date)
        await send(chatId, output)
        return  // already sent, skip the code-block wrapper below
      } else {
        output = `Unknown scheduled command: ${job.command}`
      }

      await send(chatId, `*${job.label ?? job.name}*\n\`\`\`\n${output}\n\`\`\``)
    } catch (err) {
      console.error(`Scheduled job "${job.name}" failed:`, err.message)
    }
  })

  console.log(`Scheduled: ${job.name} (${job.cron})`)
}

// ─── Error handling ───────────────────────────────────────────────────────────

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message)
})

bot.on('error', (err) => {
  console.error('Bot error:', err.message)
})

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  bot.stopPolling()
  process.exit(0)
})

console.log('Bot ready. Send /help in Telegram to get started.')
