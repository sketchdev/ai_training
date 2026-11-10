#!/usr/bin/env bash
# PreToolUse hook for Edit and Write. Blocks edits to protected paths.
# Exit code 2 blocks the tool call and shows stderr to Claude.
file="$(jq -r '.tool_input.file_path // empty')"

case "$file" in
  */pom.xml|*/.github/workflows/*|*/.env|*/.env.*)
    echo "Blocked: $file is a protected path. Ask a human to change it." >&2
    exit 2
    ;;
esac
exit 0
