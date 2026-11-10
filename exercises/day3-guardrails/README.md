# Day 3: guardrail exercises

This folder holds sample guardrails to test, break, and harden during the ship sprint.

## Contents

| File | Purpose |
|---|---|
| `hooks/block-protected-paths.sh` | Blocks edits to `pom.xml`, CI files, and `.env` files |
| `hooks/block-dangerous-bash.sh` | Blocks a short list of risky shell commands |
| `hooks/require-tests-pass.sh` | A Stop hook: Claude cannot finish until `./mvnw verify` passes |
| `settings.example.json` | Permission rules and hook wiring to copy into `.claude/settings.json` in the `battleship` repository |
| `test-hooks.sh` | Checks each hook with sample tool calls |
| `review-checklist.md` | The human checklist that follows machine review |

## Exercises

The hooks read their input with `jq`. If `jq --version` fails, install jq first.


1. Copy the `hooks/` folder to `.claude/hooks/` in the `battleship` repository. Run `./test-hooks.sh` from this folder. All lines must show `ok`.
2. Find a Bash command that does harm and gets past `block-dangerous-bash.sh`. Hint: try `git push origin +main`.
3. Fix the hook. Add a line to `test-hooks.sh` that proves the fix.
4. Move the two hooks into your team plugin (`hooks/hooks.json`). Use `${CLAUDE_PLUGIN_ROOT}` in the command path.
5. Add a permission rule that denies reading `.env` files. Check that the rule works.
6. Edit `review-checklist.md` to match your team. Add it to the pull request template.

An instruction in `CLAUDE.md` is a request. A hook or a deny rule is a guarantee. Use guarantees for rules that must never break.
