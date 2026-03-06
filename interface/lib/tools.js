'use strict'

const { execSync, spawn } = require('child_process')
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
    const cmd = target
      ? `ctx-import --source ${target} --platform claude-code`
      : 'ctx-import --auto'
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: 60000,
      cwd: path.join(STACK_ROOT, 'chronicle')
    })
  } catch (err) {
    return err.stdout || err.message
  }
}

module.exports = { wslAudit, pullModel, ollamaModels, loreImport }
