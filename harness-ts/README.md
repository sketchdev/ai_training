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

### Start a run from the dashboard

Press New run in the dashboard. Pick the harness (TypeScript or Python) and the workflow, then fill in the form. The hub builds the form from the workflow's `inputs` section, and the run starts as its own process.

- Credentials: the run uses the hub's environment, so set the SDK credentials in the terminal where you start the hub.
- Python launches: the hub uses `harness-python/.venv/bin/python`, so the virtual environment must exist with the requirements installed.
- Output: the run's output goes to `harness-ts/runs/hub/<run id>.log`. If the process ends before the run reports an end, the run shows as failed with the last lines of that log.
- Hub restarts: a launched run keeps going if you stop the hub, and it reconnects when the hub starts again.

### Workflow inputs

A workflow file declares what it needs in an `inputs` section. Each input has a `kind`:

- `file`: a file from the folder that `from` names, for example `stories/*.md`.
- `path`: a folder.
- `text`: free text.
- `choice`: one of the values in `options`.

An input with a `default` can be left out. Every workflow needs a `repo` input of kind `path`, which is the repository that the run changes. Relative paths resolve against the harness folder.

The orchestrator adds each input to the stage prompts as a section, for example `STORY:` followed by the story file's text. A stage prompt can also use `{name}`, which becomes the input's value. From a terminal, pass each input as `--input name=value`.

### Permission modes

A permission mode decides what happens to a tool call that a stage's `allowed_tools` does not cover. Choose one for the whole run with `--permission-mode`, or with the Permission mode field in the launch form:

- `default`: the call waits for a person on the dashboard. A headless run denies it.
- `acceptEdits`: file edits run without asking. Other calls still wait for a person.
- `auto`: a model classifier decides.
- `dontAsk`: the call is denied, and the model cannot ask you questions.
- `bypassPermissions`: every call runs without a permission check. The dashboard asks you to confirm this mode.

A workflow file can set `permission_mode` for the whole workflow, or for one stage. The run's choice wins, then the stage's, then the workflow's. With none of them set, a headless run uses `dontAsk` and a dashboard run uses `default`. The guardrail hook blocks protected paths and blocked commands in every mode, including `bypassPermissions`. The `plan` mode is not offered, because nothing runs in it, so an implement stage could never pass.

### The interview-to-pr workflow

`workflows/interview-to-pr.yaml` starts from a short request instead of a story file. Its stages:

1. `interview`: the model reads the code and asks you questions on the dashboard, in up to 4 rounds. Then it writes a plan with a title, your decisions, the files to change, and the tests to add.
2. `implement`: the model makes the change and its tests, following your decisions.
3. `review`: a fresh session reviews the diff against `docs/standards.md` and your decisions.

Then the run opens the review and merge panel. The branch and commit message come from the plan's title.

The workflow needs the dashboard (`requires_dashboard: true`), so start it from the dashboard or with `--dashboard`. It refuses `dontAsk`, because that mode denies questions.

### Review and merge

When every stage passes, a run with `--dashboard` does not end. It commits its changes on its story branch and shows a "Review and merge" panel with the diff, the review stage's verdict, and its findings. Pick one of three actions:

1. Squash and merge. Name the target branch, which starts as a name made from the story, for example `feat/list-games`. Edit the commit message if you want. The run's changes land on that branch as one commit.
2. Request changes. Write what should change. The implement and review stages run again in the same worktree, and the panel shows the new diff.
3. Discard. The orchestrator deletes the worktree and the story branch.

If the target branch does not exist, the orchestrator creates it at the commit the run started from. If the branch is checked out somewhere, for example in your main checkout, the merge happens there and the files update. The orchestrator refuses if that checkout has uncommitted changes to tracked files. Commit or stash them, then press Squash and merge again.

If the merge conflicts, the orchestrator merges the target branch into the story branch, and a `resolve` stage lets the model fix the conflicts. The panel then shows the diff against the target branch for a second review.

After a merge, the orchestrator removes the worktree and deletes the story branch. It does not push.

The orchestrator uses the stage names `merge` and `resolve` itself. A workflow file that uses either name is refused at start.

The orchestrator must still run while you review, because Request changes and `resolve` need the model. If a run is lost before you decide, its worktree stays at `runs/<run id>/repo`, and you merge it by hand. A diff over 400 KB is cut short in the page. The full diff is in the worktree.

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
