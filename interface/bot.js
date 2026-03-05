'use strict'

require('dotenv').config()

const fs = require('fs')
const path = require('path')
const TelegramBot = require('node-telegram-bot-api')
const cron = require('node-cron')
const { loadConfig, chatConfig, isAdmin, modelForCommand } = require('./lib/config')
const { ask, listModels, spendSummary } = require('./lib/gateway')
const { searchLore, getContextForPrompt } = require('./lib/chronicle')
const { wslAudit, pullModel, ollamaModels, loreImport } = require('./lib/tools')

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
/import — Run CHRONICLE session import` : ''

  await send(chatId, `*rtgf-interface* — INTenX AI Stack
Client: ${cfg?.client ?? 'personal'} | Model: \`${model}\`

*Ask:*
/ask <prompt> — General question (${modelForCommand('ask')})
/code <prompt> — Coding question (${modelForCommand('code')})
/reason <prompt> — Deep reasoning (${modelForCommand('reason')})
/fast <prompt> — Quick answer (${modelForCommand('fast')})

*Stack:*
/status — Platform health (wsl-audit risks)
/health — Full platform audit (wsl-audit all)
/models — Available models
/chronicle <query> — Search CHRONICLE session archive

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

// Non-command messages in private chats → route to active model
bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return
  if (msg.chat.type !== 'private') return  // groups: require explicit command

  const chatId = msg.chat.id
  await bot.sendChatAction(chatId, 'typing')
  try {
    const state = getState(chatId)
    const response = await ask(chatId, activeModel(chatId), msg.text, { history: state.history })
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
  await bot.sendChatAction(chatId, 'typing')
  try {
    const result = await pullModel(modelName)
    await send(chatId, result)
  } catch (err) {
    await send(chatId, `Error: ${err.message}`)
  }
})

bot.onText(/\/import/, async (msg) => {
  const chatId = msg.chat.id
  if (!isAdmin(chatId)) {
    await send(chatId, 'Admin only.')
    return
  }
  await bot.sendChatAction(chatId, 'typing')
  const output = loreImport()
  await send(chatId, `\`\`\`\n${output}\n\`\`\``)
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
