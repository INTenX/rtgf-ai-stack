#!/usr/bin/env node

/**
 * Git Operations Library
 *
 * Safe wrappers for git operations used in RCM flow management.
 * Always uses git mv for state transitions (never manual file operations).
 * Implements RCM commit conventions.
 */

import { execSync, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Check if directory is a git repository
 */
export function isGitRepo(dirPath) {
  try {
    execSync('git rev-parse --git-dir', { cwd: dirPath, stdio: 'ignore' });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Check if working tree is clean
 */
export function isClean(dirPath) {
  try {
    const status = execSync('git status --porcelain', {
      cwd: dirPath,
      encoding: 'utf-8'
    });
    return status.trim() === '';
  } catch (err) {
    return false;
  }
}

/**
 * Git move (for flow state transitions)
 */
export function gitMove(rcmRoot, fromPath, toPath, options = {}) {
  const { dryRun = false, force = false } = options;

  // Validate paths are within rcm/
  const rcmDir = path.join(rcmRoot, 'rcm');
  if (!fromPath.startsWith(rcmDir) || !toPath.startsWith(rcmDir)) {
    throw new Error('Paths must be within rcm/ directory');
  }

  // Check if source exists
  if (!fs.existsSync(fromPath)) {
    throw new Error(`Source file does not exist: ${fromPath}`);
  }

  // Ensure destination directory exists
  const toDir = path.dirname(toPath);
  if (!fs.existsSync(toDir)) {
    fs.mkdirSync(toDir, { recursive: true });
  }

  // Build git mv command
  const forceFlag = force ? '-f' : '';
  const cmd = `git mv ${forceFlag} "${fromPath}" "${toPath}"`;

  if (dryRun) {
    console.log(`[DRY RUN] Would execute: ${cmd}`);
    return { success: true, dryRun: true };
  }

  try {
    execSync(cmd, { cwd: rcmRoot, stdio: 'inherit' });
    return { success: true, from: fromPath, to: toPath };
  } catch (err) {
    throw new Error(`Git move failed: ${err.message}`);
  }
}

/**
 * Git add files
 */
export function gitAdd(rcmRoot, files) {
  try {
    const fileList = Array.isArray(files) ? files : [files];
    execFileSync('git', ['add', ...fileList], { cwd: rcmRoot, stdio: 'inherit' });
    return { success: true };
  } catch (err) {
    throw new Error(`Git add failed: ${err.message}`);
  }
}

/**
 * Git commit with RCM convention
 */
export function gitCommit(rcmRoot, type, message, options = {}) {
  const { dryRun = false } = options;

  // RCM commit conventions
  const validTypes = ['import', 'convert', 'flow', 'promote', 'export'];
  if (!validTypes.includes(type)) {
    throw new Error(`Invalid commit type: ${type}. Must be one of: ${validTypes.join(', ')}`);
  }

  const commitMsg = `rcm(${type}): ${message}`;

  if (dryRun) {
    console.log(`[DRY RUN] Would commit: ${commitMsg}`);
    return { success: true, dryRun: true, message: commitMsg };
  }

  try {
    execFileSync('git', ['commit', '-m', commitMsg], { cwd: rcmRoot, stdio: 'inherit' });
    return { success: true, message: commitMsg };
  } catch (err) {
    // If nothing to commit, that's okay
    if (err.message.includes('nothing to commit')) {
      return { success: true, message: 'Nothing to commit', empty: true };
    }
    throw new Error(`Git commit failed: ${err.message}`);
  }
}

/**
 * Combined flow transition operation
 * Performs: git mv + update YAML + git add + git commit
 */
export function flowTransition(rcmRoot, sessionFile, fromState, toState, options = {}) {
  const { dryRun = false, tags = [], qualityScore = null } = options;

  // Validate states
  const validStates = ['hypothesis', 'codified', 'validated', 'promoted'];
  if (!validStates.includes(fromState) || !validStates.includes(toState)) {
    throw new Error(`Invalid states. Must be one of: ${validStates.join(', ')}`);
  }

  // Build paths
  const fromPath = path.join(rcmRoot, 'rcm', 'flows', fromState, path.basename(sessionFile));
  const toPath = path.join(rcmRoot, 'rcm', 'flows', toState, path.basename(sessionFile));

  console.log(`🔄 Flow Transition: ${fromState} → ${toState}`);
  console.log(`   File: ${path.basename(sessionFile)}`);

  if (dryRun) {
    console.log(`   [DRY RUN] Would move to: ${toPath}`);
    return { success: true, dryRun: true };
  }

  // Step 1: Git move
  console.log(`   1. Git move...`);
  gitMove(rcmRoot, fromPath, toPath);

  // Step 2: Update YAML (flow_state)
  // The flow dirs use symlinks → rcm/archive/canonical/. updateFlowStateInYaml
  // correctly follows the symlink and writes to the canonical file, but we must
  // also stage that canonical file — not just the (unchanged) symlink.
  console.log(`   2. Update flow_state in YAML...`);
  updateFlowStateInYaml(toPath, toState, { tags, qualityScore });

  // Step 3: Git add — stage both the symlink and its resolved canonical target
  console.log(`   3. Git add...`);
  const filesToStage = [toPath];
  try {
    const resolved = fs.realpathSync(toPath);
    if (resolved !== toPath) {
      filesToStage.push(resolved);
    }
  } catch (_) { /* not a symlink or can't resolve — add toPath only */ }
  gitAdd(rcmRoot, filesToStage);

  // Step 4: Git commit
  const sessionId = path.basename(sessionFile, '.yaml').split('_').pop();
  const commitMsg = `${fromState} → ${toState} [${sessionId}]`;
  console.log(`   4. Git commit...`);
  const result = gitCommit(rcmRoot, 'flow', commitMsg);

  console.log(`✅ Flow transition complete!`);

  return {
    success: true,
    from: fromPath,
    to: toPath,
    commit: result.message,
  };
}

/**
 * Update flow_state in YAML file
 */
function updateFlowStateInYaml(yamlPath, newState, options = {}) {
  const { tags = [], qualityScore = null } = options;

  try {
    // Read YAML content
    let content = fs.readFileSync(yamlPath, 'utf-8');

    // Update flow_state (top-level key: "flow_state: hypothesis")
    content = content.replace(
      /^(flow_state:\s*).+$/m,
      `$1${newState}`
    );
    // Also handle nested format if present (flow_state.current)
    content = content.replace(
      /^(\s*current:\s*).+$/m,
      `$1${newState}`
    );

    // Update quality_score if provided
    if (qualityScore !== null) {
      content = content.replace(
        /^(\s*quality_score:\s*).+$/m,
        `$1${qualityScore}`
      );
    }

    // Update tags if provided
    if (tags.length > 0) {
      const inlineList = JSON.stringify(tags); // e.g. ["tag1","tag2"]
      // Replace inline format: tags: [] or tags: [existing,tags]
      if (/^tags:\s*\[.*\]/m.test(content)) {
        content = content.replace(
          /^(tags:\s*)\[.*\]/m,
          `$1${inlineList}`
        );
      } else {
        // Replace multi-line YAML list format
        const tagsList = tags.map(tag => `- ${tag}`).join('\n');
        content = content.replace(
          /^(tags:\s*\n)(?:\s*-\s*.+\n)*/m,
          `$1${tagsList}\n`
        );
      }
    }

    // Write back
    fs.writeFileSync(yamlPath, content, 'utf-8');

    return { success: true };
  } catch (err) {
    throw new Error(`Failed to update YAML: ${err.message}`);
  }
}

/**
 * Create symlink for flow state
 */
export function createFlowLink(rcmRoot, canonicalPath, flowState) {
  const flowDir = path.join(rcmRoot, 'rcm', 'flows', flowState);
  const filename = path.basename(canonicalPath);
  const linkPath = path.join(flowDir, filename);

  // Ensure flow directory exists
  if (!fs.existsSync(flowDir)) {
    fs.mkdirSync(flowDir, { recursive: true });
  }

  // Remove existing link if present
  if (fs.existsSync(linkPath)) {
    fs.unlinkSync(linkPath);
  }

  // Create symlink
  fs.symlinkSync(path.resolve(canonicalPath), linkPath);

  return { success: true, link: linkPath };
}

/**
 * Initialize git repository if needed
 */
export function initGitIfNeeded(dirPath) {
  if (!isGitRepo(dirPath)) {
    console.log(`Initializing git repository in ${dirPath}...`);
    execSync('git init', { cwd: dirPath, stdio: 'inherit' });
    return { success: true, initialized: true };
  }
  return { success: true, initialized: false };
}
