#!/usr/bin/env node
/**
 * CHRONICLE MCP Server
 *
 * Exposes the CHRONICLE session archive as MCP tools so any agent
 * (Claude Code, Dispatcher, etc.) can search and retrieve past sessions
 * without manual grep or file reads.
 *
 * Tools:
 *   search_sessions(query, client?, state?, limit?)
 *   get_session(id)
 *   get_patterns(topic, client?)
 *   add_session_note(id, note)
 *
 * Usage (Claude Code settings.json):
 *   {
 *     "mcpServers": {
 *       "chronicle": {
 *         "command": "node",
 *         "args": ["/home/cbasta/rtgf-ai-stack/chronicle/mcp-server.js"]
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import MiniSearch from 'minisearch';
import fg from 'fast-glob';

// ── Config ─────────────────────────────────────────────────────────────────

const KNOWLEDGE_REPOS = [
  { name: 'intenx',      path: `${os.homedir()}/intenx-knowledge` },
  { name: 'sensit',      path: `${os.homedir()}/sensit-knowledge` },
  { name: 'makanui',     path: `${os.homedir()}/makanui-knowledge` },
  { name: 'ratio11',     path: `${os.homedir()}/ratio11-knowledge` },
  { name: 'beaglebone',  path: `${os.homedir()}/beaglebone-knowledge` },
  { name: 'test',        path: `${os.homedir()}/test-knowledge` },
];

const FLOW_STATES = ['hypothesis', 'codified', 'validated', 'promoted'];

const MINISEARCH_OPTIONS = {
  idField: 'id',
  fields: ['title', 'tags_str', 'summary', 'content'],
  storeFields: ['id', 'file_path', 'title', 'tags', 'flow_state', 'date', 'platform', 'repo', 'summary', 'message_count'],
  searchOptions: {
    boost: { title: 3, tags_str: 2, summary: 1.5, content: 1 },
    fuzzy: 0.15,
    prefix: true,
  },
};

// ── Session loader ──────────────────────────────────────────────────────────

async function loadSessions(repoFilter = null, stateFilter = null) {
  const sessions = [];

  for (const repo of KNOWLEDGE_REPOS) {
    if (repoFilter && repo.name !== repoFilter) continue;

    // Support both flat layout and rcm/flows layout
    const bases = [
      path.join(repo.path, 'rcm', 'flows'),
      repo.path,
    ];

    for (const base of bases) {
      const states = stateFilter ? [stateFilter] : FLOW_STATES;
      for (const state of states) {
        const dir = path.join(base, state);
        let files;
        try {
          files = await fg('*.md', { cwd: dir, absolute: true });
        } catch {
          continue;
        }

        for (const file of files) {
          try {
            const raw = await fs.readFile(file, 'utf8');
            const { data: fm, content } = matter(raw);

            sessions.push({
              id: fm.id || path.basename(file, '.md'),
              file_path: file,
              title: fm.title || path.basename(file, '.md'),
              tags: Array.isArray(fm.tags) ? fm.tags : [],
              tags_str: Array.isArray(fm.tags) ? fm.tags.join(' ') : '',
              summary: fm.summary || '',
              flow_state: fm.flow_state || state,
              date: fm.created || fm.date || '',
              platform: fm.platform || '',
              repo: repo.name,
              message_count: fm.message_count || 0,
              content: content.slice(0, 2000), // limit for index size
              raw_content: content,
            });
          } catch {
            // skip unreadable files
          }
        }
      }
    }
  }

  return sessions;
}

// ── Build search index ──────────────────────────────────────────────────────

async function buildIndex(repoFilter = null, stateFilter = null) {
  const sessions = await loadSessions(repoFilter, stateFilter);
  const index = new MiniSearch(MINISEARCH_OPTIONS);
  if (sessions.length > 0) {
    index.addAll(sessions);
  }
  return { index, sessions };
}

// ── Tool handlers ───────────────────────────────────────────────────────────

async function searchSessions({ query, client, state, limit = 10 }) {
  const { index, sessions } = await buildIndex(client || null, state || null);

  let results;
  if (query && query.trim()) {
    results = index.search(query, { limit: limit * 2 });
  } else {
    // No query — return most recent
    results = sessions
      .sort((a, b) => (b.date > a.date ? 1 : -1))
      .slice(0, limit)
      .map(s => ({ ...s, score: 1 }));
  }

  const output = results.slice(0, limit).map(r => {
    const session = sessions.find(s => s.id === r.id) || r;
    return {
      id: session.id,
      title: session.title,
      repo: session.repo,
      state: session.flow_state,
      date: session.date,
      platform: session.platform,
      tags: session.tags,
      summary: session.summary,
      score: r.score,
    };
  });

  return {
    count: output.length,
    query: query || null,
    filters: { client: client || null, state: state || null },
    results: output,
  };
}

async function getSession({ id }) {
  const sessions = await loadSessions();
  const session = sessions.find(s =>
    s.id === id ||
    s.id.startsWith(id) ||
    path.basename(s.file_path).includes(id)
  );

  if (!session) {
    return { error: `Session not found: ${id}` };
  }

  const raw = await fs.readFile(session.file_path, 'utf8');
  return {
    id: session.id,
    title: session.title,
    repo: session.repo,
    state: session.flow_state,
    date: session.date,
    platform: session.platform,
    tags: session.tags,
    summary: session.summary,
    file_path: session.file_path,
    content: raw,
  };
}

async function getPatterns({ topic, client }) {
  // Search only promoted + validated sessions for the topic
  const results = await searchSessions({
    query: topic,
    client: client || null,
    state: null,
    limit: 20,
  });

  // Filter to promoted/validated only
  const patterns = results.results.filter(r =>
    r.state === 'promoted' || r.state === 'validated'
  ).slice(0, 10);

  if (patterns.length === 0) {
    return {
      topic,
      message: `No promoted or validated sessions found for topic: "${topic}"`,
      results: [],
    };
  }

  // For each pattern, get a snippet of content
  const enriched = await Promise.all(patterns.map(async p => {
    const session = await getSession({ id: p.id });
    const snippet = (session.content || '').slice(0, 500);
    return { ...p, snippet };
  }));

  return {
    topic,
    client: client || null,
    count: enriched.length,
    results: enriched,
  };
}

async function addSessionNote({ id, note }) {
  const sessions = await loadSessions();
  const session = sessions.find(s =>
    s.id === id ||
    s.id.startsWith(id) ||
    path.basename(s.file_path).includes(id)
  );

  if (!session) {
    return { error: `Session not found: ${id}` };
  }

  const raw = await fs.readFile(session.file_path, 'utf8');
  const timestamp = new Date().toISOString();

  const noteBlock = `\n\n---\n**Agent note** (${timestamp}):\n${note}\n`;
  await fs.writeFile(session.file_path, raw + noteBlock, 'utf8');

  return {
    success: true,
    session_id: session.id,
    file_path: session.file_path,
    note_added: note,
    timestamp,
  };
}

// ── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'chronicle', version: '1.0.0' },
  {
    capabilities: { tools: {} },
  }
);

server.setRequestHandler(
  ListToolsRequestSchema,
  async () => ({
    tools: [
      {
        name: 'search_sessions',
        description: 'Search CHRONICLE session archives by keyword. Returns matching sessions with title, tags, summary, state, and score.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Full-text search query' },
            client: { type: 'string', description: 'Filter by client repo (intenx, sensit, makanui, ratio11)' },
            state: { type: 'string', description: 'Filter by flow state: hypothesis, codified, validated, promoted' },
            limit: { type: 'number', description: 'Max results (default 10)' },
          },
        },
      },
      {
        name: 'get_session',
        description: 'Retrieve full content of a CHRONICLE session by ID or ID prefix.',
        inputSchema: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Session ID or prefix' },
          },
        },
      },
      {
        name: 'get_patterns',
        description: 'Get promoted and validated sessions on a topic — these are the most reliable reference patterns.',
        inputSchema: {
          type: 'object',
          required: ['topic'],
          properties: {
            topic: { type: 'string', description: 'Topic or keyword to find patterns for' },
            client: { type: 'string', description: 'Filter by client (optional)' },
          },
        },
      },
      {
        name: 'add_session_note',
        description: 'Append a note to a CHRONICLE session (e.g. "this decision was superseded", "verified in production").',
        inputSchema: {
          type: 'object',
          required: ['id', 'note'],
          properties: {
            id: { type: 'string', description: 'Session ID or prefix' },
            note: { type: 'string', description: 'Note text to append' },
          },
        },
      },
    ],
  })
);

server.setRequestHandler(
  CallToolRequestSchema,
  async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result;
      switch (name) {
        case 'search_sessions':  result = await searchSessions(args);   break;
        case 'get_session':      result = await getSession(args);        break;
        case 'get_patterns':     result = await getPatterns(args);       break;
        case 'add_session_note': result = await addSessionNote(args);    break;
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
