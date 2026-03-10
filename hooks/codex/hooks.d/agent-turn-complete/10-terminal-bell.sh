#!/usr/bin/env bash
set -euo pipefail

# Bell for local attention when Codex completes a turn.
printf '\a' > /dev/tty 2>/dev/null || true
