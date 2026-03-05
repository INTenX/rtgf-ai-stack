'use strict'

const OpenAI = require('openai')
const { chatConfig } = require('./config')

// ─── Gateway discovery ────────────────────────────────────────────────────────
// WSL2 IPs change on Windows reboot. If the configured GATEWAY_URL is unreachable,
// scan common WSL subnets for port 4000 and cache the discovered IP in-process.

let _discoveredUrl = null

async function discoverGateway() {
  if (_discoveredUrl) return _discoveredUrl

  const { default: fetch } = await import('node-fetch').catch(() => ({ default: globalThis.fetch }))
  const { execSync } = require('child_process')

  // Collect subnet prefixes visible from this WSL instance
  let prefixes = []
  try {
    const routes = execSync('ip route show', { encoding: 'utf8' })
    prefixes = [...new Set(routes.match(/\d+\.\d+\.\d+/g) || [])]
  } catch { /* ignore */ }

  // Scan .1 and .2 on each subnet (hub is typically .2 on WSL NAT networks)
  const candidates = prefixes.flatMap(p => [`${p}.1`, `${p}.2`])

  for (const ip of candidates) {
    try {
      const res = await fetch(`http://${ip}:4000/health`, { signal: AbortSignal.timeout(800) })
      if (res.status < 500) {
        _discoveredUrl = `http://${ip}:4000`
        console.log(`[gateway] Discovered LiteLLM at ${_discoveredUrl}`)
        return _discoveredUrl
      }
    } catch { /* not here */ }
  }

  return null
}

async function gatewayUrl() {
  const configured = process.env.GATEWAY_URL ?? 'http://localhost:4000'
  const { default: fetch } = await import('node-fetch').catch(() => ({ default: globalThis.fetch }))

  // Fast path: configured URL is reachable
  try {
    await fetch(`${configured}/health`, { signal: AbortSignal.timeout(1500) })
    _discoveredUrl = null  // reset so stale cache doesn't persist after recovery
    return configured
  } catch { /* fall through to discovery */ }

  // Slow path: scan for gateway
  console.warn(`[gateway] ${configured} unreachable — scanning for gateway...`)
  const found = await discoverGateway()
  if (found) return found

  console.error('[gateway] Gateway not found on any subnet')
  return configured  // return original so error messages are useful
}

// Build an OpenAI client pointed at LiteLLM for a given chat
async function clientFor(chatId) {
  const cfg = chatConfig(chatId)
  const apiKey = cfg?.litellm_key
    || process.env.LITELLM_DEFAULT_KEY
    || process.env.LITELLM_MASTER_KEY

  return new OpenAI({
    apiKey,
    baseURL: `${await gatewayUrl()}/v1`
  })
}

// Send a prompt to the gateway, return the response text.
// `history` is an optional array of {role, content} messages (prior turns).
async function ask(chatId, model, prompt, { systemPrompt = null, history = [] } = {}) {
  const client = await clientFor(chatId)

  const messages = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  // Inject prior conversation turns, then the new user message
  messages.push(...history)
  messages.push({ role: 'user', content: prompt })

  try {
    const response = await client.chat.completions.create({
      model,
      messages,
      max_tokens: 2048
    })
    return response.choices[0]?.message?.content ?? '(no response)'
  } catch (err) {
    if (err.status === 429) {
      return `Budget limit reached for this client. Contact admin to increase.`
    }
    if (err.code === 'ECONNREFUSED') {
      return `Gateway not reachable at ${process.env.GATEWAY_URL}. Is it running?`
    }
    throw err
  }
}

// Fetch model list from gateway
async function listModels() {
  const { default: fetch } = await import('node-fetch').catch(() => ({ default: globalThis.fetch }))
  const url = `${await gatewayUrl()}/v1/models`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.LITELLM_MASTER_KEY}` }
  })
  if (!res.ok) throw new Error(`Gateway returned ${res.status}`)
  const data = await res.json()
  return data.data?.map(m => m.id) ?? []
}

// Fetch spend summary from gateway
async function spendSummary() {
  const { default: fetch } = await import('node-fetch').catch(() => ({ default: globalThis.fetch }))
  const url = `${await gatewayUrl()}/spend/teams`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.LITELLM_MASTER_KEY}` }
  })
  if (!res.ok) throw new Error(`Gateway returned ${res.status}`)
  return res.json()
}

module.exports = { ask, listModels, spendSummary }
