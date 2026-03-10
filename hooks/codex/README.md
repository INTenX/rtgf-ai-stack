# Codex Notify Hook Framework

This sidecar framework turns Codex CLI's single `notify` callback into an event-based local hook system.

## Structure

- `notify-router.sh`: entrypoint configured in `~/.codex/config.toml`.
- `hooks.d/all/`: runs on every notify payload.
- `hooks.d/<event>/`: runs for a normalized event name.
- `logs/`: JSONL log output.

## Event normalization

The router tries payload keys in this order:

1. `event`
2. `type`
3. fallback: `agent-turn-complete`

Normalization rules:

- lowercase
- spaces/underscores become `-`
- remove non `[a-z0-9-]` characters

## Hook script contract

- Executable files only.
- Invoked as: `<hook-script> '<raw-json-payload>'`
- Hook failures are non-fatal; router continues.

## Included hooks

- `hooks.d/all/00-log-summary.sh`: writes compact records to `logs/notify-summary.jsonl`.
- `hooks.d/agent-turn-complete/10-terminal-bell.sh`: terminal bell.

## Example Codex config

```toml
notify = ["/bin/bash", "/home/cbasta/security/codex-hooks/notify-router.sh"]
```
