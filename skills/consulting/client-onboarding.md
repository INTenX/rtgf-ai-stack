---
skill_id: consulting/client-onboarding
domain: consulting
trigger: client onboarding, new client, new project, engagement start, project setup, knowledge repo
version: "1.0"
---

# Skill: Client Onboarding

## Purpose

Set up the AI stack infrastructure for a new client engagement. Done once per client. Creates the knowledge isolation, cost attribution, and session context needed to operate the engagement correctly.

## Onboarding Checklist

### 1. Knowledge repo

Create a private GitHub repo in the INTenX org:

```
<client>-knowledge
```

e.g. `sensit-knowledge`, `ratio11-knowledge`, `makanui-knowledge`

Initialize with the standard CHRONICLE directory structure:
```
hypothesis/
codified/
validated/
promoted/
```

Clone to Ubuntu-AI-Hub at `~/` alongside existing knowledge repos.

### 2. LiteLLM virtual key

Create a virtual key for the engagement (see `platform/litellm-key-setup` skill):

```json
{
  "key_alias": "client-<client>-<project>",
  "max_budget": 50.00,
  "budget_duration": "monthly",
  "metadata": {"client": "<client>", "project": "<project>"}
}
```

Store the key in the client's project CLAUDE.md (not committed to a public repo).

### 3. WSL instance and session context

Decide which WSL instance the client's work runs in. Typical mapping:
- Sensit → SensitDev
- Ratio11 → RatioElevenDev
- INTenX internal → INTenXDev

Create a project CLAUDE.md at the engagement root with:
- Client name and project context
- WSL instance
- Knowledge repo location
- LiteLLM key reference
- Relevant Skills to load
- Escalation points

### 4. Messaging registration

Add the session to the messaging registry at `/mnt/c/temp/messages/MESSAGING.md`:
```markdown
| <WSL instance> | <session-name> | Role description | `/mnt/c/temp/messages/<wsl>/<session>/` |
```

Create the mailbox directory:
```bash
mkdir -p /mnt/c/temp/messages/<wsl-instance>/<session-name>
```

### 5. CHRONICLE tagging convention

Agree on standard tags before the first session:
- Client tag: `client:<client-name>` (e.g. `client:sensit`)
- Project tag: `project:<project-name>` (e.g. `project:g3-mb-tester`)
- Discipline tags: `firmware`, `hardware`, `software`, `mechanical`, `consulting`

Document in the project CLAUDE.md.

### 6. First session import

After the first Claude Code session on the engagement:
1. Import to the client knowledge repo
2. Tag with client + project + discipline
3. Promote to `codified`
4. Verify knowledge repo is pushed to GitHub

## Verification

- [ ] Knowledge repo created and accessible on GitHub
- [ ] LiteLLM key active (test with a `/ask` from Telegram)
- [ ] CLAUDE.md at project root with correct context
- [ ] Session registered in messaging registry
- [ ] First session successfully imported to knowledge repo

## Offboarding Reference

When the engagement closes, see `consulting/engagement-closure` skill.
