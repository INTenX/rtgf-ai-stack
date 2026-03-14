---
skill_id: platform/chronicle-import
domain: platform
trigger: import session, archive session, CHRONICLE, knowledge curation, session export, rcm-import
version: "1.0"
---

# Skill: CHRONICLE Session Import

## Purpose

Import Claude Code (or other platform) sessions into the CHRONICLE knowledge base. Sessions move through knowledge flow states as confidence grows: `hypothesis → codified → validated → promoted`.

## When to Use This Skill

- At session end, to archive the current session
- When finding orphaned sessions not yet imported
- When promoting a session to a higher knowledge state
- When curating knowledge across a client's session history

## Import Workflow

### 1. Find the session file

Claude Code sessions live at:
```
~/.claude/projects/<project-slug>/<session-id>.jsonl
```

Find recent sessions:
```bash
ls -lt ~/.claude/projects/*/*.jsonl | head -20
```

Find orphans not yet imported:
```bash
node ~/rtgf-ai-stack/chronicle/tools/cli/rcm-find-orphans.js \
  --target /home/cbasta/intenx-knowledge/ --import
```

### 2. Import to knowledge repo

```bash
node ~/rtgf-ai-stack/chronicle/tools/cli/rcm-import.js \
  --source ~/.claude/projects/<project-slug>/<session-id>.jsonl \
  --platform claude-code \
  --target /home/cbasta/<client>-knowledge/
```

Knowledge repos: `intenx-knowledge`, `sensit-knowledge`, `makanui-knowledge`, `ratio11-knowledge`

### 3. Review and tag

```bash
# Browse via web dashboard
node ~/rtgf-ai-stack/chronicle/tools/web/server.js /home/cbasta/intenx-knowledge/ 3000
```

After reviewing, add tags and promote:
```bash
node ~/rtgf-ai-stack/chronicle/tools/cli/rcm-flow.js promote \
  --session <SESSION_ID> --to codified --tags "topic,discipline,client"
```

### 4. Commit the import

```bash
cd /home/cbasta/intenx-knowledge
git add .
git commit -m "chore(chronicle): import session <SESSION_ID_PREFIX>"
git push
```

## Knowledge Flow States

| State | Meaning | Who promotes |
|-------|---------|-------------|
| `hypothesis` | Raw import, unreviewed | Auto on import |
| `codified` | Reviewed, tagged, structured | Agent after review |
| `validated` | Confirmed correct, no contradictions | Human or senior agent |
| `promoted` | Actively used as reference knowledge | Human decision |

**Rule:** Always use `git mv` to move sessions between state directories. Never manual `mv`.

## Quality Bar for Promotion

Before promoting to `codified`:
- Session has meaningful tags (topic + discipline + client)
- Subject line accurately describes the work done
- No sensitive data (keys, passwords, personal info) in the session content

Before promoting to `validated`:
- Decisions made in session have been confirmed correct
- No contradictions with other validated sessions on the same topic

## Common Mistakes

- Importing to the wrong knowledge repo (check client ownership before importing)
- Missing tags (reduces searchability — always tag before promoting)
- Forgetting to push after committing (knowledge changes don't propagate to other sessions until pushed)
