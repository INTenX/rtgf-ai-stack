---
skill_id: consulting/engagement-closure
domain: consulting
trigger: engagement closure, project close, client offboarding, handoff, knowledge export, final report
version: "1.0"
---

# Skill: Engagement Closure

## Purpose

Close an engagement cleanly — archive all sessions, promote key knowledge, produce deliverables, and leave the system in a state where the work can be resumed or referenced later without context loss.

## Closure Checklist

### 1. Archive all open sessions

Import any sessions not yet in the knowledge repo:
```bash
node ~/rtgf-ai-stack/chronicle/tools/cli/rcm-find-orphans.js \
  --target /home/cbasta/<client>-knowledge/ --import
```

Tag all imported sessions with `engagement:closed` in addition to existing tags.

### 2. Promote key decisions to validated

Review the `codified/` sessions for the engagement. Promote to `validated` any sessions that contain:
- Key architectural decisions
- Accepted specifications
- Tested and working implementations
- Patterns you'd reuse on the next engagement

```bash
node ~/rtgf-ai-stack/chronicle/tools/cli/rcm-flow.js promote \
  --session <SESSION_ID> --to validated \
  --tags "engagement:closed,decision,architecture"
```

### 3. Write closure summary

Create a closure document in the knowledge repo at `promoted/`:

```
<client>-<project>-closure-<date>.md
```

Contents:
- Engagement summary (what was built, what was decided)
- Key decisions with rationale (link to CHRONICLE session IDs)
- Unresolved items or known limitations
- Recommended next steps
- AI cost summary (from LiteLLM)

Promote directly to `promoted` state — this is the durable reference.

### 4. Export knowledge artifact (if deliverable)

If the client receives a knowledge export as part of the engagement:
```bash
# Export promoted sessions for this client/project
node ~/rtgf-ai-stack/chronicle/tools/cli/rcm-export.js \
  --filter "client:<client>,project:<project>" \
  --state promoted \
  --output /tmp/<client>-knowledge-export-$(date +%Y-%m-%d).zip
```

### 5. Archive LiteLLM key

Set the virtual key budget to $0 to prevent further spend:
```bash
curl -X POST http://localhost:4000/key/update \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -d '{"key": "<key>", "max_budget": 0}'
```

Don't delete the key — the spend history is valuable for billing reference.

### 6. Final knowledge repo push

```bash
cd /home/cbasta/<client>-knowledge
git add .
git commit -m "chore(chronicle): engagement closure <client>/<project> $(date +%Y-%m-%d)"
git push
```

### 7. Update messaging registry

If the client's sessions are no longer active, add a note to MESSAGING.md marking them inactive. Don't remove the rows — they're audit history.

## Billing Artifact

Pull final AI spend before closing:
```bash
curl "http://localhost:4000/spend/logs?key_alias=client-<client>-<project>" \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  | python3 -c "import sys,json; data=json.load(sys.stdin); print(f'Total spend: \${sum(e[\"spend\"] for e in data):.4f}')"
```

Include in closure summary and invoice if applicable.

## Verification

- [ ] All sessions imported to knowledge repo
- [ ] Closure summary written and promoted
- [ ] Key decisions promoted to `validated`
- [ ] LiteLLM key budget zeroed
- [ ] Final commit pushed to GitHub
- [ ] Client deliverable exported (if applicable)
- [ ] Billing total documented
