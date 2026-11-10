#!/usr/bin/env bash
# Starter hook. Reads the hook JSON on stdin and checks any edited .java file for tabs.
# Replace the body with a real formatter when the team picks one.
file="$(jq -r '.tool_input.file_path // empty')"
case "$file" in
  *.java)
    if grep -q $'\t' "$file" 2>/dev/null; then
      echo "Tab character found in $file. This project uses 4 spaces." >&2
      exit 2
    fi
    ;;
esac
exit 0
