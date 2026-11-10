# Day 2: team plugin starter

This folder is the starting point for the build sprint. It holds a working plugin skeleton and a marketplace file.

Move it into its own repository before you start. The plugin repository is separate from the lab repository.

## What is here

| Path | Purpose |
|---|---|
| `.claude-plugin/marketplace.json` | Lists the plugin so that a repository can install it |
| `team-plugin/.claude-plugin/plugin.json` | Plugin name and version |
| `team-plugin/skills/review/SKILL.md` | Example skill: `/team-plugin:review` |
| `team-plugin/agents/standards-reviewer.md` | Example read-only subagent |
| `team-plugin/hooks/hooks.json` | Example hook: runs after each edit |

## Try it

From the lab repository, run:

```bash
claude --plugin-dir ../path/to/day2-team-plugin/team-plugin
```

Then run `/team-plugin:review` on a branch with changes.

## Sprint tasks

1. Agree on names and review rules (10 minutes, whole team).
2. Pick one backlog item from the Day 1 list. Build it as a skill, subagent, or hook.
3. Test it with `--plugin-dir` on the lab repository.
4. Open a pull request. Another team reviews it.
5. Write the component README: what it does, when to use it, and one example.
