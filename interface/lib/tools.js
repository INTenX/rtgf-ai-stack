'use strict'

const { execSync, execFileSync, spawn } = require('child_process')
const path = require('path')

const STACK_ROOT = path.join(__dirname, '../..')

// Run wsl-audit with the given subcommand, return output string
function wslAudit(subcommand = 'risks') {
  try {
    return execSync(`wsl-audit ${subcommand}`, {
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        TERM: 'dumb',  // suppress ANSI colors
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`
      }
    })
  } catch (err) {
    // wsl-audit exits non-zero when warnings found — capture output anyway
    return err.stdout || err.message
  }
}

// Trigger an Ollama model pull via the API
async function pullModel(modelName) {
  const { default: fetch } = await import('node-fetch').catch(() => ({ default: globalThis.fetch }))
  const ollamaBase = process.env.OLLAMA_API_BASE ?? 'http://172.27.96.1:11434'
  const res = await fetch(`${ollamaBase}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName, stream: false }),
    signal: AbortSignal.timeout(5000)  // don't wait for full download
  })
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`)
  return `Pull started for ${modelName} — check Ollama for progress.`
}

// List models currently loaded in Ollama
async function ollamaModels() {
  const { default: fetch } = await import('node-fetch').catch(() => ({ default: globalThis.fetch }))
  const ollamaBase = process.env.OLLAMA_API_BASE ?? 'http://172.27.96.1:11434'
  const res = await fetch(`${ollamaBase}/api/tags`, {
    signal: AbortSignal.timeout(5000)
  })
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`)
  const data = await res.json()
  return data.models?.map(m => `• ${m.name}  (${(m.size / 1e9).toFixed(1)}GB)`) ?? []
}

// Run CHRONICLE import for a given session file or all pending
function loreImport(target = '') {
  try {
    const args = target
      ? ['--source', target, '--platform', 'claude-code']
      : ['--auto']
    return execFileSync('ctx-import', args, {
      encoding: 'utf8',
      timeout: 60000,
      cwd: path.join(STACK_ROOT, 'chronicle')
    })
  } catch (err) {
    return err.stdout || err.message
  }
}

// Summarise yesterday's WARD audit log
// Returns a formatted string for Telegram
function wardDigest(date = null) {
  const fs = require('fs')
  const os = require('os')

  const target = date ?? (() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  })()

  const logPath = `${os.homedir()}/.claude/audit/${target}.jsonl`

  let total = 0, blocked = 0, warned = 0
  const blockCounts = {}
  const warnCounts = {}

  try {
    const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const obj = JSON.parse(line)
        if (obj.event !== 'pre_tool_use') continue
        total++
        if (obj.blocked) {
          blocked++
          const id = obj.block_id ?? 'unknown'
          blockCounts[id] = (blockCounts[id] ?? 0) + 1
        } else if (obj.severity === 'warn') {
          warned++
          const id = obj.block_id ?? 'warn'
          warnCounts[id] = (warnCounts[id] ?? 0) + 1
        }
      } catch { /* skip malformed lines */ }
    }
  } catch {
    return `No WARD audit log found for ${target}.`
  }

  const lines = [`*WARD Audit — ${target}*`, `Tool calls: ${total}`]

  if (blocked === 0 && warned === 0) {
    lines.push('✅ Clean — no blocks or warnings')
  } else {
    if (blocked > 0) {
      lines.push(`🚫 Blocked: ${blocked}`)
      for (const [id, n] of Object.entries(blockCounts)) {
        lines.push(`  • ${id}: ${n}`)
      }
    }
    if (warned > 0) {
      lines.push(`⚠️ Warned: ${warned}`)
      for (const [id, n] of Object.entries(warnCounts)) {
        lines.push(`  • ${id}: ${n}`)
      }
    }
  }

  return lines.join('\n')
}

// ─── BATON ────────────────────────────────────────────────────────────────────

const BATON_STORE = '/mnt/c/Temp/wsl-shared/baton'

function batonList(all = false) {
  const fs = require('fs')
  const dirs = all ? ['pending', 'claimed', 'completed'] : ['pending']
  const lines = []
  for (const dir of dirs) {
    const p = `${BATON_STORE}/${dir}`
    if (!fs.existsSync(p)) continue
    const batons = fs.readdirSync(p)
      .filter(f => f.endsWith('.json'))
      .map(f => { try { return JSON.parse(fs.readFileSync(`${p}/${f}`, 'utf8')) } catch { return null } })
      .filter(Boolean)
      .sort((a, b) => ({ high: 0, normal: 1, low: 2 }[a.priority] ?? 1) - ({ high: 0, normal: 1, low: 2 }[b.priority] ?? 1))
    if (all && batons.length) lines.push(`── ${dir} ──`)
    for (const b of batons) {
      const age = Math.round((Date.now() - new Date(b.created).getTime()) / 60000)
      const ageStr = age < 60 ? `${age}m` : age < 1440 ? `${Math.round(age/60)}h` : `${Math.round(age/1440)}d`
      const mark = b.priority === 'high' ? '❗' : b.priority === 'low' ? '·' : '·'
      lines.push(`${mark} \`${b.id.slice(0,8)}\`  *${b.subject}*  (${ageStr} ago, ${b.status})`)
    }
  }
  return lines.length ? lines.join('\n') : all ? 'No batons.' : 'No pending batons.'
}

function batonDrop(subject, opts = {}) {
  const fs = require('fs')
  const { randomUUID } = require('crypto')
  const dir = `${BATON_STORE}/pending`
  fs.mkdirSync(dir, { recursive: true })
  const baton = {
    id: randomUUID(),
    created: new Date().toISOString(),
    from: 'user (telegram)',
    to: opts.to ?? 'any',
    type: opts.type ?? 'task',
    priority: opts.priority ?? 'normal',
    subject,
    body: opts.body ?? '',
    context: { chronicle_refs: [], inline: '' },
    status: 'pending',
    claimed_at: null, claimed_by: null, completed_at: null, result: null,
  }
  fs.writeFileSync(`${dir}/${baton.id}.json`, JSON.stringify(baton, null, 2))
  return baton.id.slice(0, 8)
}

function batonShow(idPrefix) {
  const fs = require('fs')
  for (const dir of ['pending', 'claimed', 'completed']) {
    const p = `${BATON_STORE}/${dir}`
    if (!fs.existsSync(p)) continue
    const file = fs.readdirSync(p).find(f => f.startsWith(idPrefix))
    if (file) {
      const b = JSON.parse(fs.readFileSync(`${p}/${file}`, 'utf8'))
      const lines = [
        `*${b.subject}*`,
        `ID: \`${b.id.slice(0,8)}\`  Status: ${b.status}  Priority: ${b.priority}`,
        `From: ${b.from}  →  To: ${b.to}  Type: ${b.type}`,
        `Created: ${b.created.slice(0, 16).replace('T', ' ')} UTC`,
      ]
      if (b.body) lines.push(`\nBody: ${b.body}`)
      if (b.claimed_by) lines.push(`Claimed by: ${b.claimed_by}`)
      if (b.result) lines.push(`Result: ${b.result}`)
      return lines.join('\n')
    }
  }
  return `No baton matching: ${idPrefix}`
}

// Drop a relay baton — targets a named session for tmux injection
function batonDropRelay(targetSession, message) {
  const fs = require('fs')
  const { randomUUID } = require('crypto')
  const dir = `${BATON_STORE}/pending`
  fs.mkdirSync(dir, { recursive: true })
  const baton = {
    id: randomUUID(),
    created: new Date().toISOString(),
    from: 'user (telegram)',
    to: targetSession,
    type: 'relay',
    priority: 'high',
    subject: `Relay → ${targetSession}`,
    body: message,
    context: { chronicle_refs: [], inline: '' },
    status: 'pending',
    claimed_at: null, claimed_by: null, completed_at: null, result: null,
  }
  fs.writeFileSync(`${dir}/${baton.id}.json`, JSON.stringify(baton, null, 2))
  return baton.id
}

// Check whether a relay baton has a completed result (null if not yet)
function batonCheckResult(id) {
  const fs = require('fs')
  const completedDir = `${BATON_STORE}/completed`
  if (!fs.existsSync(completedDir)) return null
  const file = fs.readdirSync(completedDir).find(f => f.startsWith(id))
  if (!file) return null
  try {
    const b = JSON.parse(fs.readFileSync(`${completedDir}/${file}`, 'utf8'))
    return b.result ?? ''
  } catch { return null }
}

module.exports = { wslAudit, pullModel, ollamaModels, loreImport, wardDigest, batonList, batonDrop, batonShow, batonDropRelay, batonCheckResult }
