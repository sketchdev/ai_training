# Day 4: Agent SDK

The Agent SDK is Claude Code as a library (Python or TypeScript). `query()` streams messages until Claude finishes, then returns a result with a subtype, turn count, cost, and session ID.

| Option | Use |
|---|---|
| `setting_sources=["project"]` | Load `CLAUDE.md` and project `.claude/` files |
| `plugins=[{"type":"local","path":...}]` | Load the team plugin |
| `allowed_tools`, `disallowed_tools` | Limit tools |
| `permission_mode="dontAsk"` | Deny anything not allowed (for unattended runs) |
| `max_turns`, `max_budget_usd` | Hard limits |
| `output_format` | Return validated structured output |

Your code decides what happens next. Claude decides how to do each stage.

Run unattended agents in a container or VM. Mount only the repository.
