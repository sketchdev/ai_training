# Lab 2: TypeScript starter kit

This kit does the same job as the Python kit in `harness-python`. It is for teams that work in TypeScript. Pick one kit. You do not need both.

An orchestrator is a program that runs Claude Code stages without a person at the keyboard. This one reads a workflow file, runs each stage with the Agent SDK, and logs every run.

## Setup

You need Node.js 20 or later and credentials for the SDK (an API key or cloud provider credentials). Ask your instructor which route your team uses.

```bash
npm install
export ANTHROPIC_API_KEY=...   # or your approved provider credentials
```

Run unattended agents only in the container or VM that the security office approved.

## Check the guardrails (no credentials needed)

```bash
npm test
npm run typecheck
```

## Run on one practice story

```bash
npm run run-story -- workflows/story-to-pr.yaml stories/story-1-list-games.md --repo ../battleship
```

The `--repo` path points to the sibling `battleship` repository. Results go to `runs/`: one transcript per stage and one `metrics.csv`.

## Watch and drive runs from the dashboard

The dashboard is a web page that shows every run that uses `--dashboard`. A person can read the live transcript, answer the model's questions, allow a tool that the stage does not allow, send a message, and interrupt.

1. Start the hub once. The hub keeps its log in `runs/hub/`.

   ```bash
   cd harness-ts && npm run hub
   ```

2. Open `http://127.0.0.1:4321`.
3. Start one or more runs with `--dashboard`:

   ```bash
   npm run run-story -- workflows/story-to-pr.yaml stories/story-1-list-games.md --repo ../battleship --dashboard
   ```

Each run with `--dashboard` works in its own git worktree at `runs/<run id>/repo`, on the branch `story/<story>-<run id>`. Files that are not committed are not in the worktree. Commit them first, or the orchestrator prints a warning. To remove a worktree, run `git worktree remove runs/<run id>/repo`.

If the hub is not running, a run with `--dashboard` stops before its first stage. Runs without `--dashboard` work as before and ask no one.

The hub listens on `127.0.0.1` only. Anyone who can open the page can allow tool calls.

## Lab steps (70 minutes)

1. Run the starter on one story. Read the result: subtype, turns, cost, session ID.
2. Load plugin v1 and `CLAUDE.md`. Make sure that both show in the init message.
3. Tune the guardrails. The starter already sets `dontAsk`, a tool allowlist for each stage, a `PreToolUse` hook, and turn and budget limits. Set `protected_paths` in the workflow file for your team, narrow each stage's allowlist, and adjust the limits.
4. Chain plan, implement, and review. Use a structured result (`src/schemas.ts`) at each hand-off. Run review in a fresh session with the plugin reviewer.
5. Run all three stories. Log outcome, turns, cost, and pass or fail.
6. Change one thing. Run the same three stories again. Compare.

Stretch goals: run the orchestrator from GitHub Actions, or resume a failed run with `resume` and a higher limit.

## Done looks like

The workflow file and orchestrator are in git. `runs/` holds transcripts and `metrics.csv` for at least six runs. Your team can explain one change and what the numbers did.

## Known limits of this kit

The orchestrator was not run against the live SDK before the course. The code passes `tsc` and the guardrail tests, but that does not prove that the options work at run time. If an option name differs in your SDK version, fix it. That is part of the lab.
