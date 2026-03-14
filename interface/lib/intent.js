'use strict'

/**
 * Intent Classifier
 *
 * Classifies incoming Telegram messages to route them to the
 * appropriate model tier before any expensive work begins.
 *
 * Intent tiers:
 *   status   → local Ollama fast model (phi4-mini / llama3.2:3b)
 *   general  → local Ollama general model (llama3.1:8b)
 *   coding   → local Ollama coding model (qwen2.5-coder:14b)
 *   reason   → local Ollama reasoning model (deepseek-r1:14b)
 *   complex  → Claude API (sonnet)
 *
 * Classification strategy:
 *   1. Rule-based fast path (keyword + pattern matching) — zero latency
 *   2. phi4-mini LLM classifier via Ollama — for ambiguous inputs
 *      Falls back to 'general' if Ollama unavailable
 *
 * Config: interface/config.yaml intent_classifier section
 */

const http = require('http')
const https = require('https')

// ── Intent definitions ────────────────────────────────────────────────────────

const INTENTS = {
  status:  { model_key: 'fast',   description: 'Status checks, simple yes/no, greetings, platform health' },
  general: { model_key: 'ask',    description: 'General questions, explanations, discussions' },
  coding:  { model_key: 'code',   description: 'Code generation, debugging, technical implementation' },
  reason:  { model_key: 'reason', description: 'Multi-step reasoning, architecture decisions, trade-off analysis' },
  complex: { model_key: 'claude', description: 'Ambiguous complex tasks needing best-available model' },
}

// ── Rule-based fast path ──────────────────────────────────────────────────────

const RULES = [
  // Status / simple queries — fast model
  { intent: 'status', patterns: [
    /^(hi|hello|hey|sup|yo|ping)\b/i,
    /\b(status|health|running|up|down|alive|online)\b/i,
    /\b(what time|what date|how long|how many|how much)\b/i,
    /^(yes|no|ok|sure|thanks|thank you|thx|ack)\b/i,
    /\/status|\/health|\/models|\/wsl|\/audit/i,
  ]},
  // Coding — coding model
  { intent: 'coding', patterns: [
    /\b(write|implement|code|script|function|class|module|debug|fix|refactor|test)\b.*\b(in|using|with|for)\b.*(python|js|javascript|typescript|rust|go|bash|node|react|c\+\+|c#)/i,
    /\b(bug|error|exception|crash|stacktrace|traceback|undefined|null pointer)\b/i,
    /\b(git|docker|dockerfile|compose|npm|pip|cargo|brew|apt)\b.*(install|build|run|push|pull|deploy)/i,
    /```[\s\S]*?```/,  // message contains code block
    /\b(function|def |class |import |export |const |let |var )\b/,
  ]},
  // Reasoning — reasoning model
  { intent: 'reason', patterns: [
    /\b(architecture|design|trade-?off|compare|versus|vs|pros and cons|should (i|we)|decision)\b/i,
    /\b(analyze|analysis|evaluate|assessment|strategy|plan|roadmap)\b/i,
    /\b(why|how does|explain (in detail|the architecture|how))\b/i,
  ]},
  // Complex — Claude
  { intent: 'complex', patterns: [
    /\b(write a (prd|spec|proposal|report|document)|create a comprehensive|full analysis)\b/i,
  ]},
]

function ruleBasedClassify(text) {
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        return { intent: rule.intent, method: 'rule', confidence: 0.9 }
      }
    }
  }
  return null
}

// ── LLM classifier (phi4-mini via Ollama) ────────────────────────────────────

const CLASSIFIER_PROMPT = `Classify this message into exactly one intent category. Reply with only the category name.

Categories:
- status: greetings, simple yes/no, platform health checks, very short queries
- general: general questions, explanations, discussions that don't need deep reasoning
- coding: writing code, debugging, technical implementation, git/docker/CLI tasks
- reason: architectural decisions, trade-off analysis, multi-step planning, complex explanations
- complex: comprehensive documents, PRDs, full reports, tasks needing best available model

Message: "{message}"

Intent:`

async function llmClassify(text, ollamaHost, model = 'phi4-mini') {
  return new Promise((resolve) => {
    const prompt = CLASSIFIER_PROMPT.replace('{message}', text.slice(0, 500))
    const body = JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0, num_predict: 10 },
    })

    const url = new URL(`${ollamaHost}/api/generate`)
    const lib = url.protocol === 'https:' ? https : http

    const req = lib.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 3000 },
      (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            const raw = (parsed.response || '').toLowerCase().trim()
            const intent = Object.keys(INTENTS).find(k => raw.startsWith(k))
            resolve(intent
              ? { intent, method: 'llm', model, confidence: 0.8 }
              : null)
          } catch {
            resolve(null)
          }
        })
      }
    )
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.write(body)
    req.end()
  })
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Classify a message and return the recommended model key.
 *
 * @param {string} text - The user's message
 * @param {object} options
 * @param {string} options.ollamaHost - Ollama base URL (e.g. http://10.0.0.1:11434)
 * @param {boolean} options.useLlm - Whether to try LLM classification (default: true)
 * @param {string} options.fallback - Default intent if classification fails (default: 'general')
 * @returns {{ intent, model_key, method, confidence }}
 */
async function classify(text, { ollamaHost = null, useLlm = true, fallback = 'general' } = {}) {
  // 1. Rule-based fast path
  const ruleResult = ruleBasedClassify(text)
  if (ruleResult) {
    return { ...ruleResult, model_key: INTENTS[ruleResult.intent].model_key }
  }

  // 2. LLM classifier
  if (useLlm && ollamaHost) {
    const llmResult = await llmClassify(text, ollamaHost)
    if (llmResult) {
      return { ...llmResult, model_key: INTENTS[llmResult.intent].model_key }
    }
  }

  // 3. Fallback
  return {
    intent: fallback,
    model_key: INTENTS[fallback].model_key,
    method: 'fallback',
    confidence: 0.5,
  }
}

module.exports = { classify, INTENTS }
