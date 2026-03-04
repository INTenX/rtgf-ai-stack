#!/usr/bin/env node

/**
 * ctx-search — Full-text search over CHRONICLE session archives
 *
 * Two search modes:
 *   local  (default) — MiniSearch over local CHRONICLE .md files
 *   meili             — MeiliSearch full-text index (chronicle-sessions)
 *
 * MeiliSearch config via env vars:
 *   CHRONICLE_MEILI_URL   default: http://localhost:7700
 *   CHRONICLE_MEILI_KEY   master key or search-only API key
 *
 * Usage:
 *   node ctx-search.js "librechat docker restart"
 *   node ctx-search.js --tags "security,docker" --state codified
 *   node ctx-search.js --recent 10 --repo intenx-knowledge
 *   node ctx-search.js --query "ollama embeddings" --show-content
 *   node ctx-search.js --rebuild              # force rebuild local index
 *   node ctx-search.js --push-meili           # index sessions into MeiliSearch
 *   node ctx-search.js "query" --source meili # search via MeiliSearch
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import { program } from 'commander';
import MiniSearch from 'minisearch';
import { MeiliSearch } from 'meilisearch';
import fg from 'fast-glob';

// ─── Config ────────────────────────────────────────────────────────────────

const DEFAULT_REPOS = [
  '/home/cbasta/intenx-knowledge',
  '/home/cbasta/sensit-knowledge',
  '/home/cbasta/makanui-knowledge',
  '/home/cbasta/ratio11-knowledge',
  '/home/cbasta/beaglebone-knowledge',
  '/home/cbasta/test-knowledge',
];

const CACHE_PATH = path.join(os.homedir(), '.chronicle-fts.json');
const MEILI_INDEX_NAME = 'chronicle-sessions';
const MEILI_URL = process.env.CHRONICLE_MEILI_URL || 'http://localhost:7700';
const MEILI_KEY = process.env.CHRONICLE_MEILI_KEY || '';

const MINISEARCH_OPTIONS = {
  idField: 'path',
  fields: ['title', 'tags_str', 'summary', 'content'],
  storeFields: ['short_id', 'title', 'tags', 'flow_state', 'date', 'platform', 'path', 'repo', 'client', 'message_count'],
  searchOptions: {
    boost: { title: 3, tags_str: 2, summary: 1.5, content: 1 },
    fuzzy: 0.15,
    prefix: true,
  },
};

// ─── CLI ───────────────────────────────────────────────────────────────────

program
  .name('ctx-search')
  .description('Search CHRONICLE session archives (full-text + tag + filter)')
  .argument('[query]', 'Full-text search query')
  .option('-q, --query <text>', 'Full-text search query (alternative to positional arg)')
  .option('-t, --tags <tags>', 'Filter by tags, comma-separated (e.g. "docker,security")')
  .option('-s, --state <state>', 'Filter by flow state: hypothesis, codified, validated, promoted')
  .option('--since <date>', 'Only sessions on or after this date (YYYY-MM-DD)')
  .option('--until <date>', 'Only sessions on or before this date (YYYY-MM-DD)')
  .option('-r, --repo <name>', 'Filter by repository name (e.g. intenx-knowledge)')
  .option('-p, --platform <platform>', 'Filter by platform (claude-code, chatgpt, gemini)')
  .option('-n, --recent <n>', 'Show N most recent (applied after other filters)', parseInt)
  .option('--show-content', 'Show a text snippet from matching content')
  .option('--format <fmt>', 'Output format: table (default), list, json', 'table')
  .option('--source <src>', 'Search source: local (default) or meili', 'local')
  .option('--rebuild', 'Force rebuild of the local MiniSearch index')
  .option('--push-meili', 'Index all CHRONICLE sessions into MeiliSearch and exit')
  .option('--repos <paths...>', 'Override knowledge repo paths')
  .parse();

const opts = program.opts();
const queryArg = program.args[0] || opts.query || '';
const repoPaths = opts.repos || DEFAULT_REPOS;

// ─── Session scanning ──────────────────────────────────────────────────────

function extractContent(markdownBody) {
  return markdownBody
    .replace(/^##\s+(User|Assistant|System)\s*·.*$/gm, '')
    .replace(/^\*\*Tools:\*\*.*$/gm, '')
    .replace(/^---+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 8000);
}

async function scanRepos(repos) {
  const sessions = [];
  for (const repoPath of repos) {
    const repoName = path.basename(repoPath);
    let files;
    try {
      files = await fg('rcm/flows/**/*.md', { cwd: repoPath, absolute: true });
    } catch {
      continue;
    }

    for (const filePath of files) {
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const { data: fm, content: body } = matter(raw);
        const flowState = fm.flow_state || filePath.match(/\/flows\/([^/]+)\//)?.[1] || 'hypothesis';

        sessions.push({
          // 'path' is the MiniSearch idField — must be unique
          path: filePath,
          session_id: fm.id || '',
          short_id: (fm.id || '').slice(0, 8),
          title: fm.title || path.basename(filePath, '.md'),
          tags: fm.tags || [],
          tags_str: (fm.tags || []).join(' '),
          summary: fm.summary || '',
          content: extractContent(body),
          flow_state: flowState,
          date: fm.created || fm.updated || '',
          platform: fm.platform || '',
          message_count: fm.message_count || 0,
          client: fm.client || '',
          repo: repoName,
        });
      } catch {
        // skip unreadable files
      }
    }
  }
  return sessions;
}

// ─── Local MiniSearch index ────────────────────────────────────────────────

async function buildLocalIndex(repos) {
  process.stderr.write('Building search index...');
  const sessions = await scanRepos(repos);
  const ms = new MiniSearch(MINISEARCH_OPTIONS);
  ms.addAll(sessions);

  const cache = {
    built_at: new Date().toISOString(),
    count: sessions.length,
    index: ms.toJSON(),
    sessions: sessions.map(s => ({
      path: s.path,
      session_id: s.session_id,
      short_id: s.short_id,
      title: s.title,
      tags: s.tags,
      flow_state: s.flow_state,
      date: s.date,
      platform: s.platform,
      message_count: s.message_count,
      client: s.client,
      repo: s.repo,
      snippet: s.content.slice(0, 500),
    })),
  };

  await fs.writeFile(CACHE_PATH, JSON.stringify(cache), 'utf-8');
  process.stderr.write(` ${sessions.length} sessions indexed.\n`);
  return cache;
}

async function loadOrBuildLocalIndex(repos, forceRebuild) {
  if (!forceRebuild) {
    try {
      const raw = await fs.readFile(CACHE_PATH, 'utf-8');
      return JSON.parse(raw);
    } catch {
      // Cache missing — build it
    }
  }
  return buildLocalIndex(repos);
}

async function searchLocal(query, repos, forceRebuild) {
  const cache = await loadOrBuildLocalIndex(repos, forceRebuild);
  const sessionMap = new Map(cache.sessions.map(s => [s.path, s]));

  let results;
  if (query) {
    const ms = MiniSearch.loadJSON(JSON.stringify(cache.index), MINISEARCH_OPTIONS);
    results = ms.search(query).map(h => sessionMap.get(h.id)).filter(Boolean);
  } else {
    results = [...cache.sessions].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  // Hint for stale cache
  const ageHours = (Date.now() - new Date(cache.built_at)) / 3600000;
  if (ageHours > 24) {
    process.stderr.write(`\x1b[90m(Index is ${Math.round(ageHours)}h old — run with --rebuild to refresh)\x1b[0m\n`);
  }

  return results;
}

// ─── MeiliSearch integration ───────────────────────────────────────────────

function getMeiliClient() {
  if (!MEILI_KEY) {
    console.error('CHRONICLE_MEILI_KEY not set. Export it before using --source meili or --push-meili.');
    console.error('  export CHRONICLE_MEILI_KEY=<your-master-or-search-key>');
    console.error('  export CHRONICLE_MEILI_URL=http://localhost:7700  # if non-default');
    process.exit(1);
  }
  return new MeiliSearch({ host: MEILI_URL, apiKey: MEILI_KEY });
}

async function pushToMeili(repos) {
  const client = getMeiliClient();
  process.stderr.write('Scanning sessions...');
  const sessions = await scanRepos(repos);
  process.stderr.write(` ${sessions.length} found.\n`);

  // Create or update index with filterable/sortable attributes
  const index = client.index(MEILI_INDEX_NAME);
  await client.createIndex(MEILI_INDEX_NAME, { primaryKey: 'path' }).catch(() => {});
  await index.updateSettings({
    searchableAttributes: ['title', 'summary', 'tags_str', 'content'],
    filterableAttributes: ['flow_state', 'platform', 'repo', 'client', 'date'],
    sortableAttributes: ['date', 'message_count'],
    rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
  });

  // Push in batches of 50 (MeiliSearch handles large content fine, but batching is polite)
  const batchSize = 50;
  let pushed = 0;
  for (let i = 0; i < sessions.length; i += batchSize) {
    const batch = sessions.slice(i, i + batchSize);
    await index.addDocuments(batch);
    pushed += batch.length;
    process.stderr.write(`\rIndexing into MeiliSearch... ${pushed}/${sessions.length}`);
  }
  process.stderr.write('\n');

  // Wait for indexing task to complete
  const tasks = await index.getTasks({ status: ['enqueued', 'processing'] });
  if (tasks.results.length > 0) {
    process.stderr.write('Waiting for MeiliSearch to finish indexing...');
    await index.waitForTask(tasks.results[0].uid, { timeOutMs: 30000 });
    process.stderr.write(' done.\n');
  }

  console.log(`\nMeiliSearch index '${MEILI_INDEX_NAME}' updated.`);
  console.log(`  URL: ${MEILI_URL}`);
  console.log(`  Sessions indexed: ${sessions.length}`);
  console.log('\nSearch it with:');
  console.log(`  node ctx-search.js "your query" --source meili`);
}

async function searchMeili(query, filters) {
  const client = getMeiliClient();
  const index = client.index(MEILI_INDEX_NAME);

  // Build MeiliSearch filter string
  const filterParts = [];
  if (filters.state) filterParts.push(`flow_state = "${filters.state}"`);
  if (filters.repo) filterParts.push(`repo = "${filters.repo}"`);
  if (filters.platform) filterParts.push(`platform = "${filters.platform}"`);
  if (filters.since) filterParts.push(`date >= "${filters.since}"`);
  if (filters.until) filterParts.push(`date <= "${filters.until}"`);

  const searchParams = {
    limit: filters.recent || 50,
    attributesToHighlight: ['title', 'content'],
    highlightPreTag: '\x1b[33m',
    highlightPostTag: '\x1b[0m',
    attributesToCrop: ['content'],
    cropLength: 50,
  };

  if (filterParts.length) searchParams.filter = filterParts.join(' AND ');

  // Tag filter in MeiliSearch: tags is an array field
  // Use a separate filter for tags since MeiliSearch filters arrays differently
  if (filters.tags) {
    const tagFilters = filters.tags.split(',').map(t => `tags_str CONTAINS "${t.trim()}"`);
    const tagFilter = tagFilters.join(' OR ');
    searchParams.filter = filterParts.length
      ? `(${filterParts.join(' AND ')}) AND (${tagFilter})`
      : `(${tagFilter})`;
  }

  let response;
  try {
    response = query
      ? await index.search(query, searchParams)
      : await index.search('', { ...searchParams, sort: ['date:desc'] });
  } catch (err) {
    if (err.code === 'index_not_found') {
      console.error(`MeiliSearch index '${MEILI_INDEX_NAME}' not found.`);
      console.error('Run first:  node ctx-search.js --push-meili');
      process.exit(1);
    }
    throw err;
  }

  // Normalize hits to same shape as local results
  return response.hits.map(h => ({
    path: h.path,
    session_id: h.session_id,
    short_id: h.short_id,
    title: h.title,
    tags: h.tags || [],
    flow_state: h.flow_state,
    date: h.date,
    platform: h.platform,
    message_count: h.message_count,
    client: h.client,
    repo: h.repo,
    // Use highlighted snippet if available
    snippet: h._formatted?.content || h.content?.slice(0, 500) || '',
  }));
}

// ─── Filtering (local mode only — meili filters server-side) ───────────────

function applyFilters(sessions, opts) {
  let results = sessions;
  if (opts.state) results = results.filter(s => s.flow_state === opts.state);
  if (opts.repo) results = results.filter(s => s.repo?.toLowerCase().includes(opts.repo.toLowerCase()));
  if (opts.platform) results = results.filter(s => s.platform === opts.platform);
  if (opts.tags) {
    const filterTags = opts.tags.split(',').map(t => t.trim().toLowerCase());
    results = results.filter(s =>
      filterTags.some(ft => (s.tags || []).some(st => st.toLowerCase().includes(ft)))
    );
  }
  if (opts.since) {
    const since = new Date(opts.since);
    results = results.filter(s => s.date && new Date(s.date) >= since);
  }
  if (opts.until) {
    const until = new Date(opts.until);
    results = results.filter(s => s.date && new Date(s.date) <= until);
  }
  return results;
}

// ─── Output ────────────────────────────────────────────────────────────────

const STATE_COLORS = {
  hypothesis: '\x1b[90m',
  codified:   '\x1b[33m',
  validated:  '\x1b[34m',
  promoted:   '\x1b[32m',
};
const RESET = '\x1b[0m';

function stateLabel(state) {
  const color = STATE_COLORS[state] || '';
  const short = { hypothesis: 'hyp', codified: 'cod', validated: 'val', promoted: 'pro' }[state] || (state || '?').slice(0, 3);
  return `${color}[${short}]${RESET}`;
}

function formatDate(iso) { return iso ? iso.slice(0, 10) : '          '; }
function truncate(str, n) { if (!str) return ''; return str.length > n ? str.slice(0, n - 1) + '…' : str; }

function printTable(results, showContent) {
  if (results.length === 0) { console.log('\nNo sessions found.\n'); return; }
  console.log(`\nFound ${results.length} session${results.length !== 1 ? 's' : ''}:\n`);
  for (const [i, s] of results.entries()) {
    const num = String(i + 1).padStart(3);
    const tags = s.tags?.length ? `  [${s.tags.slice(0, 4).join(', ')}]` : '';
    console.log(`${num}. ${stateLabel(s.flow_state)} ${truncate(s.title, 60)}`);
    console.log(`      ${s.short_id}  ${formatDate(s.date)}  ${s.repo}  ${s.message_count} msgs${tags}`);
    if (showContent && s.snippet) {
      console.log(`      \x1b[90m${truncate(s.snippet.replace(/\s+/g, ' '), 120)}${RESET}`);
    }
    console.log(`      ${s.path}`);
    console.log();
  }
}

function printList(results) {
  results.forEach(s => console.log(`${s.short_id} | ${(s.flow_state || '').padEnd(11)} | ${s.title}`));
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  // --push-meili: index sessions and exit
  if (opts.pushMeili) {
    await pushToMeili(repoPaths);
    return;
  }

  let results;

  if (opts.source === 'meili') {
    results = await searchMeili(queryArg, {
      state: opts.state,
      repo: opts.repo,
      platform: opts.platform,
      tags: opts.tags,
      since: opts.since,
      until: opts.until,
      recent: opts.recent,
    });
    // meili filters server-side, recent is handled via limit
  } else {
    results = await searchLocal(queryArg, repoPaths, opts.rebuild);
    results = applyFilters(results, opts);
    if (opts.recent) results = results.slice(0, opts.recent);
  }

  if (opts.format === 'json') {
    console.log(JSON.stringify(results, null, 2));
  } else if (opts.format === 'list') {
    printList(results);
  } else {
    printTable(results, opts.showContent);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
