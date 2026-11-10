# Day 1: demo setup (facilitator only)

The demo "One task, three modes" (slide 22) needs a deny rule on `git push`. Claude asks to push, and the rule blocks it.

Put the rule on the facilitator's machine only. Attendees must push their branches in Lab 1, so the rule must not go into the shared `.claude/settings.json`.

## Before the demo

From the `battleship` folder, run:

```bash
mkdir -p .claude
cp ../exercises/day1-demos/settings.local.json .claude/settings.local.json
```

Claude Code reads `.claude/settings.local.json` for you only. The `battleship/.gitignore` file keeps it out of git.

Start Claude Code and run `/permissions`. Make sure that the list shows `Bash(git push *)` under deny.

## After the demo

```bash
rm .claude/settings.local.json
```

Remove the file before you push your own branches.
