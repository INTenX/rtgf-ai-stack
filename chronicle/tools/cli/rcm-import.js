#!/usr/bin/env node

/**
 * rcm-import - Import LLM sessions to RCM
 *
 * Orchestrates platform-specific adapters to convert sessions to canonical format.
 * Handles file copying, conversion, flow state assignment, and git commits.
 *
 * Usage:
 *   rcm-import --source session.jsonl --platform claude-code --target ~/knowledge/
 *   rcm-import --source export.json --platform chatgpt --target ~/knowledge/
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { program } from 'commander';
import { convertAndSave as convertClaudeCode } from '../adapters/claude-code.js';
import { convertChatGPT } from '../adapters/chatgpt.js';
import { convertGemini } from '../adapters/gemini.js';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Platform adapter mapping
const ADAPTERS = {
  'claude-code': convertClaudeCode,
  'chatgpt': convertChatGPT,
  'gemini': convertGemini
};

/**
 * Load RCM config
 */
function loadConfig(rcmRoot) {
  const configPath = path.join(rcmRoot, 'rcm', 'config.yaml');
  if (!fs.existsSync(configPath)) {
    throw new Error(`RCM config not found at ${configPath}`);
  }
  // Simple config reading - could use js-yaml for full parsing
  return {
    archive: {
      raw: path.join(rcmRoot, 'rcm', 'archive', 'raw'),
      canonical: path.join(rcmRoot, 'rcm', 'archive', 'canonical'),
    },
    flows: {
      hypothesis: path.join(rcmRoot, 'rcm', 'flows', 'hypothesis'),
      codified: path.join(rcmRoot, 'rcm', 'flows', 'codified'),
      validated: path.join(rcmRoot, 'rcm', 'flows', 'validated'),
      promoted: path.join(rcmRoot, 'rcm', 'flows', 'promoted'),
    },
  };
}

/**
 * Ensure directory exists
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Scan canonical archive for an existing file with a matching platform_session_id.
 * Returns the existing file path if found, or null.
 */
function findExistingImport(canonicalRoot, platformSessionId) {
  if (!platformSessionId || !fs.existsSync(canonicalRoot)) return null;
  // grep is faster than reading every file in Node
  try {
    const result = execSync(
      `grep -rl "platform_session_id: '${platformSessionId}'" "${canonicalRoot}" 2>/dev/null || true`,
      { encoding: 'utf8' }
    ).trim();
    return result || null;
  } catch (_) {
    return null;
  }
}

/**
 * Extract the platform_session_id from the source file without full conversion.
 * For claude-code the ID is the JSONL filename (UUID); for others we skip pre-check.
 */
function extractPlatformSessionId(sourceFile, platform) {
  if (platform === 'claude-code') {
    return path.basename(sourceFile, '.jsonl');
  }
  // For chatgpt/gemini we'd need to parse JSON — skip pre-check, dedup after conversion
  return null;
}

/**
 * Copy file to raw archive
 */
function archiveRaw(sourceFile, platform, config) {
  const rawDir = path.join(config.archive.raw, platform);
  ensureDir(rawDir);

  const filename = path.basename(sourceFile);
  const destPath = path.join(rawDir, filename);

  fs.copyFileSync(sourceFile, destPath);
  console.log(`📦 Archived raw: ${destPath}`);

  return destPath;
}

/**
 * Convert to canonical format
 */
function convertToCanonical(sourceFile, platform, config, options) {
  const adapter = ADAPTERS[platform];
  if (!adapter) {
    throw new Error(`No adapter found for platform: ${platform}`);
  }

  // Determine output directory (by year/month)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const canonicalDir = path.join(config.archive.canonical, String(year), month);
  ensureDir(canonicalDir);

  // Convert
  const result = adapter(sourceFile, canonicalDir, {
    flowState: options.flowState || 'hypothesis',
    tags: options.tags || [],
    workingDirectory: options.workingDirectory || '',
  });

  console.log(`🔄 Converted to canonical: ${result.canonicalPath}`);
  console.log(`   Title: ${result.title}`);
  console.log(`   Session ID: ${result.sessionId}`);

  return result;
}

/**
 * Link to flow state
 */
function linkToFlowState(canonicalPath, flowState, config) {
  const flowDir = config.flows[flowState];
  if (!flowDir) {
    throw new Error(`Unknown flow state: ${flowState}`);
  }

  ensureDir(flowDir);

  const filename = path.basename(canonicalPath);
  const linkPath = path.join(flowDir, filename);

  // Use symlink for flow states (preserves single source of truth)
  if (fs.existsSync(linkPath)) {
    fs.unlinkSync(linkPath);
  }
  fs.symlinkSync(path.resolve(canonicalPath), linkPath);

  console.log(`🔗 Linked to flow state: ${flowState}`);
  console.log(`   ${linkPath}`);

  return linkPath;
}

/**
 * Git commit (optional)
 */
function gitCommit(rcmRoot, sessionId, platform, autoCommit) {
  if (!autoCommit) {
    console.log('⏭️  Skipping git commit (--no-commit flag)');
    return;
  }

  try {
    // Check if in git repo
    execSync('git rev-parse --git-dir', { cwd: rcmRoot, stdio: 'ignore' });

    // Stage files
    execSync('git add rcm/', { cwd: rcmRoot, stdio: 'inherit' });

    // Commit
    const commitMsg = `rcm(import): Import ${platform} session ${sessionId.substring(0, 8)}`;
    execSync(`git commit -m "${commitMsg}"`, { cwd: rcmRoot, stdio: 'inherit' });

    console.log(`✅ Git commit created: ${commitMsg}`);
  } catch (err) {
    console.warn('⚠️  Git commit failed (not in repo or nothing to commit)');
  }
}

/**
 * Main import function
 */
async function importSession(options) {
  const {
    source,
    platform,
    target,
    flowState = 'hypothesis',
    tags = [],
    workingDirectory = '',
    autoCommit = true,
    forceReimport = false,
  } = options;

  console.log('🚀 RCM Import');
  console.log(`   Source: ${source}`);
  console.log(`   Platform: ${platform}`);
  console.log(`   Target: ${target}`);
  console.log(`   Flow State: ${flowState}`);
  console.log('');

  // Validate source
  if (!fs.existsSync(source)) {
    throw new Error(`Source file not found: ${source}`);
  }

  // Load config
  const config = loadConfig(target);

  // Dedup check — skip if platform_session_id already exists in canonical archive
  if (!forceReimport) {
    const platformSessionId = extractPlatformSessionId(source, platform);
    if (platformSessionId) {
      const existing = findExistingImport(config.archive.canonical, platformSessionId);
      if (existing) {
        console.log(`⏭️  Already imported — skipping (use --force-reimport to override)`);
        console.log(`   Existing: ${existing}`);
        return { skipped: true, existing };
      }
    }
  }

  // Step 1: Archive raw
  const rawPath = archiveRaw(source, platform, config);

  // Step 2: Convert to canonical
  const canonicalResult = convertToCanonical(rawPath, platform, config, {
    flowState,
    tags,
    workingDirectory,
  });

  // Step 3: Link to flow state
  const flowLink = linkToFlowState(canonicalResult.canonicalPath, flowState, config);

  // Step 4: Git commit
  gitCommit(target, canonicalResult.sessionId, platform, autoCommit);

  console.log('');
  console.log('✅ Import complete!');
  console.log(`   Canonical: ${canonicalResult.canonicalPath}`);
  console.log(`   Flow: ${flowLink}`);

  return canonicalResult;
}

// CLI setup
program
  .name('rcm-import')
  .description('Import LLM sessions to RCM canonical format')
  .version('0.1.0')
  .requiredOption('-s, --source <path>', 'Source session file path')
  .requiredOption('-p, --platform <name>', 'Platform name (claude-code, chatgpt, gemini)')
  .requiredOption('-t, --target <path>', 'Target RCM root directory')
  .option('-f, --flow-state <state>', 'Initial flow state', 'hypothesis')
  .option('--tags <tags>', 'Comma-separated tags', (val) => val.split(',').map(t => t.trim()))
  .option('--working-directory <path>', 'Working directory context')
  .option('--no-commit', 'Skip git commit')
  .option('--force-reimport', 'Re-import even if platform_session_id already exists')
  .option('--verbose', 'Verbose output');

program.parse();

const options = program.opts();

// Run import
importSession(options)
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('');
    console.error('❌ Import failed:');
    console.error(`   ${err.message}`);
    if (options.verbose) {
      console.error('');
      console.error(err.stack);
    }
    process.exit(1);
  });
