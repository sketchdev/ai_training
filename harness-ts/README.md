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
