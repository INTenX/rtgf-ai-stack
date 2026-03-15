#!/usr/bin/env node

/**
 * rcm-flow - Flow State Management CLI
 *
 * Promotes sessions through Knowledge Flow states using git-native operations.
 * States: hypothesis → codified → validated → promoted
 *
 * Usage:
 *   rcm-flow promote --session SESSION_ID --to codified --tags tag1,tag2
 *   rcm-flow list --state hypothesis
 *   rcm-flow status --session SESSION_ID
 */

import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { flowTransition, isGitRepo, initGitIfNeeded } from '../lib/git-operations.js';

/**
 * Load RCM config
 */
function loadConfig(rcmRoot) {
  const configPath = path.join(rcmRoot, 'rcm', 'config.yaml');
  if (!fs.existsSync(configPath)) {
    throw new Error(`RCM config not found at ${configPath}`);
  }
  const content = fs.readFileSync(configPath, 'utf-8');
  return yaml.load(content);
}

/**
 * Find session file by ID (supports partial ID matching)
 */
function findSessionFile(rcmRoot, sessionId, currentState = null) {
  const states = currentState ? [currentState] : ['hypothesis', 'codified', 'validated', 'promoted'];

  for (const state of states) {
    const flowDir = path.join(rcmRoot, 'rcm', 'flows', state);
    if (!fs.existsSync(flowDir)) continue;

    const files = fs.readdirSync(flowDir);

    // Try exact match first
    const exactMatch = files.find(f => f.includes(sessionId));
    if (exactMatch) {
      return {
        path: path.join(flowDir, exactMatch),
        state: state,
        filename: exactMatch,
      };
    }
  }

  return null;
}

/**
 * Get current state of a session
 */
function getSessionState(rcmRoot, sessionId) {
  const session = findSessionFile(rcmRoot, sessionId);
  return session ? session.state : null;
}

/**
 * List sessions in a flow state
 */
function listSessions(rcmRoot, state) {
  const flowDir = path.join(rcmRoot, 'rcm', 'flows', state);

  if (!fs.existsSync(flowDir)) {
    return [];
  }

  const files = fs.readdirSync(flowDir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const fullPath = path.join(flowDir, f);
      const stats = fs.statSync(fullPath);
      const { data } = matter(fs.readFileSync(fullPath, 'utf-8'));

      return {
        filename: f,
        path: fullPath,
        size: stats.size,
        modified: stats.mtime,
        title: data.title || 'Untitled',
        sessionId: data.id,
        tags: data.tags || [],
        created: data.created,
      };
    })
    .sort((a, b) => b.modified - a.modified);

  return files;
}

/**
 * Promote command
 */
async function promoteCommand(options) {
  const {
    session: sessionId,
    to: toState,
    from: fromState = null,
    tags = [],
    qualityScore = null,
    dryRun = false,
    target: rcmRoot = process.cwd(),
  } = options;

  console.log('🚀 RCM Flow Management');
  console.log(`   Target: ${rcmRoot}`);
  console.log('');

  // Validate git repo
  if (!isGitRepo(rcmRoot)) {
    console.log('⚠️  Not a git repository. Initializing...');
    initGitIfNeeded(rcmRoot);
  }

  // Find session
  const session = findSessionFile(rcmRoot, sessionId, fromState);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}${fromState ? ` in state: ${fromState}` : ''}`);
  }

  const currentState = session.state;
  console.log(`📋 Session found:`);
  console.log(`   File: ${session.filename}`);
  console.log(`   Current state: ${currentState}`);
  console.log(`   Target state: ${toState}`);
  console.log('');

  // Validate transition
  const validTransitions = {
    hypothesis: ['codified'],
    codified: ['validated', 'hypothesis'],
    validated: ['promoted', 'codified'],
    promoted: ['validated'],
  };

  if (!validTransitions[currentState]?.includes(toState)) {
    throw new Error(
      `Invalid transition: ${currentState} → ${toState}. ` +
      `Valid transitions from ${currentState}: ${validTransitions[currentState]?.join(', ') || 'none'}`
    );
  }

  // Perform flow transition
  const result = flowTransition(rcmRoot, session.path, currentState, toState, {
    dryRun,
    tags,
    qualityScore,
  });

  if (!dryRun) {
    console.log('');
    console.log(`✅ Session promoted: ${currentState} → ${toState}`);
    console.log(`   New location: rcm/flows/${toState}/${session.filename}`);
    if (result.commit) {
      console.log(`   Git commit: ${result.commit}`);
    }
  }

  return result;
}

/**
 * List command
 */
async function listCommand(options) {
  const {
    state = 'hypothesis',
    target: rcmRoot = process.cwd(),
    verbose = false,
  } = options;

  console.log(`📋 Sessions in state: ${state}`);
  console.log(`   Location: ${rcmRoot}/rcm/flows/${state}/`);
  console.log('');

  const sessions = listSessions(rcmRoot, state);

  if (sessions.length === 0) {
    console.log('   No sessions found.');
    return;
  }

  console.log(`   Found ${sessions.length} session(s):`);
  console.log('');

  sessions.forEach((s, i) => {
    const sizeKB = (s.size / 1024).toFixed(1);
    const shortId = s.filename.split('_').pop().replace('.md', '').substring(0, 8);

    console.log(`   ${i + 1}. ${s.title}`);
    console.log(`      ID: ${shortId}`);
    console.log(`      Size: ${sizeKB} KB`);
    if (s.tags.length > 0) {
      console.log(`      Tags: ${s.tags.join(', ')}`);
    }
    if (verbose) {
      console.log(`      File: ${s.filename}`);
      console.log(`      Created: ${s.created}`);
    }
    console.log('');
  });
}

/**
 * Status command
 */
async function statusCommand(options) {
  const {
    session: sessionId,
    target: rcmRoot = process.cwd(),
  } = options;

  console.log(`🔍 Session Status: ${sessionId}`);
  console.log('');

  const session = findSessionFile(rcmRoot, sessionId);
  if (!session) {
    console.log(`   ❌ Session not found: ${sessionId}`);
    return;
  }

  // Read session details
  const { data } = matter(fs.readFileSync(session.path, 'utf-8'));

  const sizeKB = (fs.statSync(session.path).size / 1024).toFixed(1);

  console.log(`   Title: ${data.title || 'Untitled'}`);
  console.log(`   Session ID: ${data.id}`);
  console.log(`   Current State: ${session.state}`);
  console.log(`   Size: ${sizeKB} KB`);
  console.log(`   Created: ${data.created}`);
  console.log(`   Platform: ${data.platform}`);
  console.log(`   Messages: ${data.message_count || 0}`);

  if (data.tags?.length > 0) {
    console.log(`   Tags: ${data.tags.join(', ')}`);
  }

  if (data.quality_score !== null && data.quality_score !== undefined) {
    console.log(`   Quality Score: ${data.quality_score}`);
  }

  console.log('');
  console.log(`   File: ${session.filename}`);
  console.log(`   Path: ${session.path}`);
}

// CLI setup
program
  .name('rcm-flow')
  .description('RCM flow state management - promote sessions through Knowledge Flow states')
  .version('0.1.0');

// Promote command
program
  .command('promote')
  .description('Promote session to next flow state')
  .requiredOption('-s, --session <id>', 'Session ID (full or partial)')
  .requiredOption('-t, --to <state>', 'Target state (codified, validated, promoted)')
  .option('-f, --from <state>', 'Current state (auto-detected if omitted)')
  .option('--tags <tags>', 'Comma-separated tags to add', (val) => val.split(',').map(t => t.trim()))
  .option('--quality-score <score>', 'Quality score (0-100)', parseInt)
  .option('--target <path>', 'RCM root directory', process.cwd())
  .option('--dry-run', 'Show what would happen without making changes')
  .action(promoteCommand);

// List command
program
  .command('list')
  .description('List sessions in a flow state')
  .option('-s, --state <state>', 'Flow state to list', 'hypothesis')
  .option('--target <path>', 'RCM root directory', process.cwd())
  .option('-v, --verbose', 'Show detailed information')
  .action(listCommand);

// Status command
program
  .command('status')
  .description('Show detailed status of a session')
  .requiredOption('-s, --session <id>', 'Session ID (full or partial)')
  .option('--target <path>', 'RCM root directory', process.cwd())
  .action(statusCommand);

program.parse();
