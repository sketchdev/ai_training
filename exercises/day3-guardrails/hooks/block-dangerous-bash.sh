#!/usr/bin/env bash
# PreToolUse hook for Bash. Blocks a short list of risky commands.
# EXERCISE: this list is incomplete. Find a command that gets past it, then fix the hook.
cmd="$(jq -r '.tool_input.command // empty')"

case "$cmd" in
  *"rm -rf /"*|*"git push --force"*|*"git push -f"*|*"curl "*"| sh"*|*"curl "*"| bash"*)
    echo "Blocked: this command is not allowed: $cmd" >&2
    exit 2
    ;;
esac
exit 0
