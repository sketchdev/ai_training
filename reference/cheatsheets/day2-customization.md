# Day 2: Customization

| Add this | When this happens |
|---|---|
| `CLAUDE.md` | Claude gets a convention wrong twice |
| Skill | You type the same prompt again |
| Subagent | A side task floods your session |
| Hook | It must happen every time |
| MCP server | You copy data from a tool Claude cannot see |
| Plugin | A second repository needs the same setup |

## Plugin layout

```
team-plugin/
  .claude-plugin/plugin.json
  skills/<name>/SKILL.md
  agents/<name>.md
  hooks/hooks.json
  .mcp.json
```

A marketplace is a git repository with `.claude-plugin/marketplace.json` that lists plugins.

## Test a plugin locally

```bash
claude --plugin-dir ./exercises/day2-team-plugin/team-plugin
```
