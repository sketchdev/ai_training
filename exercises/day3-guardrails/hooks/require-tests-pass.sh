#!/usr/bin/env bash
# Stop hook. Claude cannot finish its turn until the test suite passes.
# Exit code 2 blocks the stop and sends stderr back to Claude, so it keeps working.
stop_hook_active="$(jq -r '.stop_hook_active // false')"

# If Claude is already continuing because of this hook, let it stop. This prevents an endless loop.
if [ "$stop_hook_active" = "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
if ! output="$(./mvnw -q verify 2>&1)"; then
  echo "Tests fail. Fix them before you finish. Last lines of ./mvnw verify:" >&2
  printf '%s\n' "$output" | tail -20 >&2
  exit 2
fi
exit 0
