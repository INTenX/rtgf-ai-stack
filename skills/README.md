# Skills Library

Markdown files encoding reusable workflow intelligence. Each Skill tells an agent *how to think about a class of problem* — not just instructions, but the mental model, decision criteria, and quality bars that make work good.

## Why Skills

| Mechanism | Token cost | Best for |
|-----------|-----------|---------|
| Skills (this) | ~250 tokens | Timeless knowledge, workflow patterns, decision frameworks |
| MCP tools | ~1000+ tokens | Live data access, execution |
| CHRONICLE context | Variable | Session-specific past decisions |

Skills are ~250x cheaper than equivalent MCP calls for knowledge retrieval. Load them at session start or before a task — no manual context injection needed.

## Format

Every Skill has YAML frontmatter + Markdown body:

```yaml
---
skill_id: domain/skill-name
domain: platform | eda | mcad | consulting
trigger: comma-separated keywords that should trigger loading this skill
version: "1.0"
---
```

## Loading a Skill

**In CLAUDE.md (session startup):**
```
Read ~/rtgf-ai-stack/skills/platform/chronicle-import.md before any session archival work.
```

**In Dispatcher (before task execution):**
```js
const skill = fs.readFileSync(`skills/${domain}/${skill}.md`, 'utf8');
// prepend to system prompt or user message
```

## Directory

```
skills/
  platform/
    chronicle-import.md       — Session archival to CHRONICLE
    ward-audit-review.md      — WARD audit log review and response
    litellm-key-setup.md      — LiteLLM virtual key provisioning
  eda/
    circuit-review.md         — Schematic and circuit review workflow
    bom-spec.md               — BOM specification and review
    dfm-checklist.md          — Design for manufacture checklist
  mcad/
    fixture-design-workflow.md — Fixture design from requirements to release
    tolerance-spec.md          — Tolerance specification and stack-up analysis
  consulting/
    client-onboarding.md      — New client and project onboarding
    engagement-closure.md     — Engagement closure and knowledge handoff
```
