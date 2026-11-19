"""Starter orchestrator: load a workflow file, run each stage, log the result.

Run:  python -m harness.orchestrator workflows/story-to-pr.yaml --input story=stories/story-1-list-games.md
      (the older form, workflows/story-to-pr.yaml stories/story-1-list-games.md --repo ../battleship, still works)

The workflow file's `inputs` section says what the run needs (harness/inputs.py). Pass each
one as --input name=value. Inputs with a default can be left out.

Each stage loads the core plugin, returns a typed result (harness/schemas.py), and must pass
its `check` before the next stage starts. The result of each stage goes to the next one.

Add --dashboard to report to the dashboard hub (npm run hub in harness-ts) and take input
from a person. The run then works in its own git worktree under runs/<run id>/, so several
runs can share one repository. Without --dashboard, the run is headless and asks no one.

Check option names against the Agent SDK version that you install.
"""
import argparse
import asyncio
import csv
import json
import os
import random
import string
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import yaml
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    HookMatcher,
    PermissionResultAllow,
    PermissionResultDeny,
    ResultMessage,
    TextBlock,
    ToolPermissionContext,
    query,
)
from pydantic import BaseModel, ValidationError

from .guardrails import make_pre_tool_use_hook
from .inputs import (
    LEGACY_INPUTS,
    check_specs,
    fill_placeholders,
    parse_input_flags,
    prompt_block,
    run_title,
    validate_inputs,
)
from .hub_client import HubClient, HubUnavailable, TurnTracker, summarize
from .merge import (
    RunTree,
    abort_resolve_merge,
    cleanup,
    commit_run,
    default_branch_name,
    default_commit_message,
    diff_for_review,
    files_with_markers,
    finish_resolve_merge,
    git,
    has_changes,
    squash_merge,
    start_resolve_merge,
    valid_branch_name,
)
from .permissions import MODE_HELP, RUN_MODES, check_modes, mode_for, mode_options
from .schemas import ImplementResult, Interview, Plan, ResolveResult, ReviewResult

RUNS = Path(__file__).resolve().parent.parent / "runs"
DEFAULT_HUB = "http://127.0.0.1:4321"
METRICS_FIELDS = ["run_id", "story", "stage", "subtype", "passed", "turns", "cost", "session_id"]

# The core plugin. Override with --plugin or the CORE_PLUGIN_PATH environment variable.
DEFAULT_PLUGIN = os.environ.get(
    "CORE_PLUGIN_PATH", str(Path.home() / ".claude" / "plugins" / "marketplaces" / "joetopp" / "plugins" / "core")
)

# The typed result that each stage must return, keyed by stage name.
SCHEMAS: dict[str, type[BaseModel]] = {
    "plan": Plan,
    "implement": ImplementResult,
    "review": ReviewResult,
    "resolve": ResolveResult,
    "interview": Interview,
}

# The permission mode that the person chose for the whole run, if any. Set in main().
RUN_MODE: Optional[str] = None

# Stage names that the orchestrator uses itself. A workflow file must not use them.
RESERVED_STAGES = ("merge", "resolve")

# Added to each prompt when a person is on the dashboard.
ASK_LINE = "If you need a decision from a person, use the AskUserQuestion tool. A person reads it on the dashboard."


def new_run_id() -> str:
    """The same format as newRunId in harness-ts/src/hub.ts."""
    digits = string.digits + string.ascii_lowercase
    n, out = int(time.time() * 1000), ""
    while n:
        n, r = divmod(n, 36)
        out = digits[r] + out
    return "r" + out + "".join(random.choice(digits) for _ in range(3))


def build_options(stage: dict, repo: Path, spec: dict, plugin: Path, live: bool = False) -> ClaudeAgentOptions:
    limits = spec.get("limits", {})
    schema = SCHEMAS.get(stage["name"])
    return ClaudeAgentOptions(
        cwd=str(repo),
        allowed_tools=stage["allowed_tools"],
        **mode_options(mode_for(stage, spec, RUN_MODE, live)),
        max_turns=limits.get("max_turns"),
        max_budget_usd=limits.get("max_budget_usd"),
        setting_sources=["project"],
        hooks={
            "PreToolUse": [
                HookMatcher(matcher="Edit|Write|Bash", hooks=[make_pre_tool_use_hook(spec.get("protected_paths", []))])
            ]
        },
        plugins=[{"type": "local", "path": str(plugin)}],
        output_format={"type": "json_schema", "schema": schema.model_json_schema()} if schema else None,
    )


def build_prompt(stage: dict, context: str, handoff: dict, feedback: Optional[str]) -> str:
    """`context` is the workflow's inputs as prompt text, from prompt_block in harness/inputs.py."""
    prompt = f"{stage['prompt']}\n\n{context}" if context else stage["prompt"]
    for name, output in handoff.items():
        prompt += f"\n\nRESULT OF THE {name.upper()} STAGE:\n{json.dumps(output, indent=2)}"
    if feedback:
        prompt += f"\n\nYOUR PREVIOUS ATTEMPT FAILED ITS CHECK:\n{feedback}"
    return prompt


def to_row(stage: dict, result: Optional[ResultMessage]) -> dict:
    if result is None:
        return {"stage": stage["name"], "subtype": "no_result", "turns": 0, "cost": 0.0, "session_id": ""}
    return {
        "stage": stage["name"],
        "subtype": result.subtype,
        "turns": result.num_turns,
        "cost": result.total_cost_usd or 0.0,
        "session_id": result.session_id,
        "output": result.structured_output if result.subtype == "success" else None,
    }


async def run_stage(
    stage: dict, context: str, repo: Path, spec: dict, plugin: Path, handoff: dict, feedback: Optional[str] = None
) -> dict:
    """Headless: one prompt, no person. Tools outside allowed_tools are denied."""
    options = build_options(stage, repo, spec, plugin)
    prompt = build_prompt(stage, context, handoff, feedback)
    log = RUNS / f"{int(time.time())}-{stage['name']}.jsonl"
    result = None
    with log.open("w") as transcript:
        async for message in query(prompt=prompt, options=options):
            transcript.write(json.dumps(repr(message)) + "\n")
            if isinstance(message, ResultMessage):
                result = message
    return to_row(stage, result)


async def run_stage_live(
    stage: dict,
    context: str,
    repo: Path,
    spec: dict,
    plugin: Path,
    handoff: dict,
    hub: HubClient,
    feedback: Optional[str] = None,
) -> dict:
    """Live: the session stays open, and a person on the dashboard can answer questions,
    allow tools outside allowed_tools, send messages, and interrupt. If the model ends its
    turn without a result, the stage waits for the person's reply in the same session."""

    async def can_use_tool(tool_name: str, tool_input: dict, context: ToolPermissionContext):
        if tool_name == "AskUserQuestion":
            response = await hub.ask("question", {"questions": tool_input.get("questions", [])}, stage["name"])
            if not response or "skip" in response:
                return PermissionResultDeny(
                    message="The person did not answer. Continue with your best judgment and say what you assumed."
                )
            return PermissionResultAllow(updated_input={**tool_input, "answers": response["answers"]})
        # The guardrail hook already ran, and allowed_tools already allowed what it covers.
        response = await hub.ask("permission", {"tool": tool_name, "input": tool_input}, stage["name"])
        if response and response.get("allow"):
            return PermissionResultAllow(updated_input=tool_input)
        note = f" The person says: {response['note']}" if response and response.get("note") else ""
        return PermissionResultDeny(message=f"A person denied this {tool_name} call.{note}")

    options = build_options(stage, repo, spec, plugin, live=True)
    options.can_use_tool = can_use_tool
    hub.emit({"type": "message", "stage": stage["name"], "role": "system",
              "text": f"Permission mode: {options.permission_mode}."})
    prompt = f"{build_prompt(stage, context, handoff, feedback)}\n\n{ASK_LINE}"
    log = RUNS / f"{int(time.time())}-{stage['name']}.jsonl"
    row = to_row(stage, None)
    last_text = ""
    background: set[asyncio.Task] = set()

    def spawn(coro) -> None:
        task = asyncio.create_task(coro)
        background.add(task)
        task.add_done_callback(background.discard)

    has_schema = stage["name"] in SCHEMAS
    turns = TurnTracker()
    last_output: Any = None

    async with ClaudeSDKClient(options=options) as client:

        async def send(text: str) -> None:
            # Each message carries a uuid, so a result can name the messages that it answers.
            message_id = str(uuid.uuid4())
            turns.sent(message_id)

            async def one():
                yield {"type": "user", "message": {"role": "user", "content": text},
                       "parent_tool_use_id": None, "uuid": message_id}

            await client.query(one())

        hub.on_message = lambda text: spawn(send(text))
        hub.on_interrupt = lambda: spawn(client.interrupt())
        try:
            await send(prompt)
            with log.open("w") as transcript:
                # One stream for the whole session. A message that a person sends mid-turn can
                # add a turn, so a result is not always the end of the exchange.
                async for message in client.receive_messages():
                    transcript.write(json.dumps(repr(message)) + "\n")
                    for event in summarize(message, stage["name"]):
                        hub.emit(event)
                    if isinstance(message, AssistantMessage):
                        text = "\n".join(b.text for b in message.content if isinstance(b, TextBlock)).strip()
                        if text:
                            last_text = text
                    if not isinstance(message, ResultMessage):
                        continue

                    row = to_row(stage, message)
                    # Keep the latest typed result, even if a later turn (a person's message) ends without one.
                    if row.get("output") is not None:
                        last_output = row["output"]
                    elif row["subtype"] == "success":
                        row["output"] = last_output
                    # A message that a person sent mid-turn is still to run. Wait for its result.
                    if not turns.consume(message):
                        continue

                    # A stage without a schema has no typed result, so a successful turn finishes it.
                    finished = row["subtype"] == "success" and (not has_schema or row.get("output") is not None)
                    # A turn or budget limit ends the session. The stage check then decides what is next.
                    if finished or row["subtype"] in ("error_max_turns", "error_max_budget_usd"):
                        break
                    hub.emit({"type": "stage", "stage": stage["name"], "status": "waiting"})
                    reply = await hub.ask(
                        "reply",
                        {"lastText": last_text, "reason": f"The session ended its turn with {row['subtype']} and no result."},
                        stage["name"],
                    )
                    hub.emit({"type": "stage", "stage": stage["name"], "status": "running"})
                    if reply.get("action") == "reply":
                        await send(reply["text"])
                        continue
                    if reply.get("action") == "stop":
                        row["subtype"] = "stopped"
                    break
        finally:
            hub.on_message = lambda text: None
            hub.on_interrupt = lambda: None
    return row


def resolve_stage(target: str, top: Path, files: list[str]) -> dict:
    """A built-in stage that fixes the conflicts of merging `target` into the story branch."""
    listed = "\n".join(f"- {f}" for f in files)
    return {
        "name": "resolve",
        "allowed_tools": ["Read", "Grep", "Glob", "Edit", "Write", "Bash(./mvnw *)", "Bash(git diff *)", "Bash(git status *)"],
        "prompt": (
            f"This branch holds the story's changes. Merging {target} into it conflicted in these files "
            f"(paths from the repository root):\n{listed}\n\n"
            "Resolve every conflict. Keep the intent of both sides, remove every conflict marker, and run "
            "./mvnw verify until it passes. Do not run git add, git commit, or git merge: the orchestrator "
            "finishes the merge. Summarize how you resolved each file."
        ),
        "conflict": {"top": top, "files": files},
    }


def verify(repo: Path, output: Any) -> dict:
    build = subprocess.run(["./mvnw", "verify", "-q"], cwd=repo, capture_output=True, text=True)
    if build.returncode == 0:
        return {"passed": True, "reason": "./mvnw verify passes", "output": output}
    return {"passed": False, "reason": f"./mvnw verify fails:\n{build.stdout[-2000:]}", "output": output}


def check_stage(stage: dict, row: dict, repo: Path) -> dict:
    """Parse the stage's structured output and apply the stage's `check` from the workflow file."""
    if row["subtype"] != "success":
        return {"passed": False, "reason": f"the stage ended with {row['subtype']}"}
    schema = SCHEMAS.get(stage["name"])
    if schema is None:
        return {"passed": True, "reason": "no schema for this stage", "output": None}
    try:
        parsed = schema.model_validate(row["output"])
    except ValidationError as error:
        return {"passed": False, "reason": f"the result does not match the schema: {error}"}
    output = parsed.model_dump()
    if stage.get("conflict"):
        # The built-in resolve stage.
        conflict = stage["conflict"]
        left = files_with_markers(conflict["top"], conflict["files"])
        if left:
            return {"passed": False, "reason": f"conflict markers remain in {', '.join(left)}", "output": output}
        return verify(repo, output)
    if stage["name"] == "plan":
        # The schema requires at least one file and one test.
        return {"passed": True, "reason": "plan lists at least one file and one test", "output": output}
    if stage["name"] == "interview":
        # The schema requires the person's decisions, and at least one file and one test.
        return {"passed": True, "reason": "plan records the person's decisions and lists files and tests", "output": output}
    if stage["name"] == "implement":
        # Do not trust the agent's own report. Run the build here.
        return verify(repo, output)
    if stage["name"] == "review":
        # The schema allows only "approve" or "request_changes".
        return {"passed": True, "reason": f"verdict is {output['verdict']}", "output": output}
    return {"passed": True, "reason": "result matches the schema", "output": output}


def append_metrics(row: dict, passed: bool, story_name: str, run_id: str) -> None:
    path = RUNS / "metrics.csv"
    if path.exists() and path.read_text().split("\n", 1)[0] != ",".join(METRICS_FIELDS):
        # An older file without the run_id column. Keep it beside the new one.
        path.rename(RUNS / f"metrics-{int(time.time() * 1000)}.csv")
    new = not path.exists()
    with path.open("a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=METRICS_FIELDS, extrasaction="ignore")
        if new:
            writer.writeheader()
        writer.writerow({**row, "run_id": run_id, "story": story_name, "passed": passed})


def create_worktree(repo: Path, run_id: str, story_name: str) -> tuple[Path, RunTree, Path]:
    """Check out the repository again at runs/<run id>/repo, on a new branch, so that parallel
    runs do not change each other's files. Returns the folder that matches `repo` in it, the
    run's worktree and branch, and the root of the main checkout."""
    main_top = Path(git(repo, "rev-parse", "--show-toplevel"))
    prefix = git(repo, "rev-parse", "--show-prefix")
    dirty = git(main_top, "status", "--porcelain", "--", prefix or ".")
    if dirty:
        print(f"These files are not committed, so the worktree does not have them:\n{dirty}", file=sys.stderr)
    top = RUNS / run_id / "repo"
    branch = f"story/{story_name}-{run_id}"
    base = git(main_top, "rev-parse", "HEAD")
    git(main_top, "worktree", "add", "-q", "-b", branch, str(top), base)
    print(f"Worktree {top} on branch {branch}")
    return top / prefix, RunTree(top=top, prefix=prefix, branch=branch, base=base), main_top


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workflow")
    parser.add_argument("story", nargs="?", help="The older form: the story file. Prefer --input story=...")
    parser.add_argument("--input", action="append", default=[], metavar="NAME=VALUE",
                        help="A workflow input, as its inputs section declares. Repeat for each.")
    parser.add_argument("--repo", help="The older form of --input repo=...")
    parser.add_argument("--plugin", default=DEFAULT_PLUGIN, help="Path to the plugin to load")
    parser.add_argument("--dashboard", action="store_true", help="Report to the dashboard hub and take input from a person")
    parser.add_argument("--hub", default=DEFAULT_HUB, help="URL of the dashboard hub")
    # Set by the hub when it launches the run, so the run fills the entry it already shows.
    parser.add_argument("--run-id", help=argparse.SUPPRESS)
    parser.add_argument("--permission-mode", choices=RUN_MODES,
                        help="The mode for every stage. " + " ".join(f"{m}: {h}" for m, h in MODE_HELP.items()))
    args = parser.parse_args()

    RUNS.mkdir(exist_ok=True)
    spec = yaml.safe_load(Path(args.workflow).read_text())
    specs = spec.get("inputs") or LEGACY_INPUTS
    spec_errors = check_specs(specs)
    if spec_errors:
        sys.exit(f"The inputs section of {args.workflow} is not usable:\n- " + "\n- ".join(spec_errors))
    try:
        given = parse_input_flags(args.input)
    except ValueError as error:
        parser.error(str(error))
    # The older form: a positional story file and --repo.
    if args.story and "story" not in given:
        given["story"] = args.story
    if args.repo and "repo" not in given:
        given["repo"] = args.repo
    base = Path.cwd()
    inputs, errors = validate_inputs(specs, given, base)
    if errors:
        parser.error("the inputs are not usable:\n- " + "\n- ".join(errors))
    global RUN_MODE
    RUN_MODE = args.permission_mode
    mode_errors = check_modes(spec, RUN_MODE, args.dashboard)
    if mode_errors:
        sys.exit("The run cannot start:\n- " + "\n- ".join(mode_errors))
    workflow_name = spec.get("name", Path(args.workflow).stem)
    context = prompt_block(specs, inputs, base)
    # story_name and story are the run's title and its first file's text, for branch names and the commit message.
    story_name, story = run_title(specs, inputs, base, workflow_name)
    for stage in spec["stages"]:
        stage["prompt"] = fill_placeholders(stage["prompt"], inputs)
    plugin = Path(args.plugin).resolve()
    if not (plugin / ".claude-plugin" / "plugin.json").exists():
        sys.exit(f"No plugin found at {plugin}. Pass --plugin or set CORE_PLUGIN_PATH.")
    reserved = [s["name"] for s in spec["stages"] if s["name"] in RESERVED_STAGES]
    if reserved:
        sys.exit(f"The workflow uses stage names that the orchestrator reserves: {', '.join(reserved)}. Rename them.")
    max_retries = spec.get("limits", {}).get("max_retries", 1)
    handoff: dict = {}

    repo = (base / inputs["repo"]).resolve()
    run_id = new_run_id()
    hub: Optional[HubClient] = None
    if args.dashboard:
        try:
            hub = await HubClient.register(
                args.hub,
                {
                    **({"id": args.run_id} if args.run_id else {}),
                    "story": story_name,
                    "workflow": workflow_name,
                    "harness": "python",
                    "repo": str(repo),
                    **({"permissionMode": RUN_MODE} if RUN_MODE else {}),
                    # The review and merge step shows as a last stage on the dashboard.
                    "stages": [s["name"] for s in spec["stages"]] + ["merge"],
                },
            )
        except HubUnavailable as error:
            sys.exit(str(error))
        run_id = hub.run_id

    async def end(status: str, reason: str) -> None:
        if hub:
            hub.emit({"type": "end", "status": status, "reason": reason})
            await hub.close()

    tree: Optional[RunTree] = None
    main_top = Path(".")
    if hub:
        try:
            repo, tree, main_top = create_worktree(repo, run_id, story_name)
        except (RuntimeError, OSError) as error:
            # The run is registered already, so end it on the dashboard too.
            reason = f"cannot create the worktree: {error}"
            await end("failed", reason)
            sys.exit(reason)
        hub.start_inbox()
        print(f"Run {run_id} on {args.hub}")

    async def run_checked(stage: dict, first_feedback: Optional[str] = None) -> dict:
        """Run one stage until its check passes, with retries, and in live mode with the person's help."""
        check: dict = {"passed": False, "reason": "not run"}
        feedback = first_feedback
        attempt, turns, cost, stopped = 0, 0, 0.0, False

        while True:
            for retry in range(max_retries + 1):
                attempt += 1
                if hub:
                    hub.emit({"type": "stage", "stage": stage["name"], "status": "running", "attempt": attempt})
                    row = await run_stage_live(stage, context, repo, spec, plugin, handoff, hub, feedback)
                else:
                    row = await run_stage(stage, context, repo, spec, plugin, handoff, feedback)
                turns += row["turns"]
                cost += row["cost"]
                stopped = row["subtype"] == "stopped"
                if stopped:
                    check = {"passed": False, "reason": "a person stopped the run"}
                else:
                    # The build can take minutes. A thread keeps the hub connection alive meanwhile.
                    check = await asyncio.to_thread(check_stage, stage, row, repo)
                append_metrics(row, check["passed"], story_name, run_id)
                print({**row, "passed": check["passed"], "reason": check["reason"]})
                if hub:
                    hub.emit({"type": "stage", "stage": stage["name"], "status": "running",
                              "turns": turns, "cost": cost, "reason": check["reason"]})
                # A budget or turn limit will not go away on a retry. A person can still choose one.
                if check["passed"] or stopped or row["subtype"].startswith("error_max"):
                    break
                feedback = check["reason"]
                if retry < max_retries:
                    print(f"Check failed. Retry {retry + 1} of {max_retries}.")
            if check["passed"] or stopped or hub is None:
                break

            # Live: the retries are used up. Ask the person instead of stopping.
            hub.emit({"type": "stage", "stage": stage["name"], "status": "waiting"})
            reply: Any = await hub.ask("reply", {"reason": check["reason"]}, stage["name"])
            if reply.get("action") == "stop":
                stopped = True
                break
            feedback = (
                f"{check['reason']}\n\nA PERSON ADDS:\n{reply['text']}"
                if reply.get("action") == "reply"
                else check["reason"]
            )

        if hub:
            hub.emit({"type": "stage", "stage": stage["name"], "status": "passed" if check["passed"] else "failed"})
        # The built-in resolve stage is not part of the workflow, so later prompts do not get its result.
        if check["passed"] and not stage.get("conflict"):
            handoff[stage["name"]] = check.get("output")
        return {**check, "stopped": stopped}

    async def review_and_merge(hub: HubClient, tree: RunTree) -> tuple[str, str]:
        """Live only: commit the run's changes, show them to the person, and merge, change, or
        discard them as the person decides. Returns the run's end status and reason."""
        # Set once the story branch has a target merged in, to resolve a conflict. From then on,
        # the story branch holds that branch's history, so only that branch can be the target.
        target: Optional[str] = None
        # An interview stage names the change itself. Otherwise the defaults come from the story.
        interviewed = handoff.get("interview") or {}
        branch = default_branch_name(interviewed.get("title") or story_name)
        message = (default_commit_message(f"# {interviewed['title']}", story_name) if interviewed.get("title")
                   else default_commit_message(story, story_name))
        note: Optional[str] = None
        error: Optional[str] = None

        def merge_stage(status: str) -> None:
            hub.emit({"type": "stage", "stage": "merge", "status": status})

        def stopped_result() -> tuple[str, str]:
            merge_stage("failed")
            return "failed", f"a person stopped the run. The worktree is at {tree.top}"

        while True:
            review = handoff.get("review") or {}
            implement = handoff.get("implement") or {}
            try:
                commit_run(tree, f"wip: {story_name} (run {run_id})")
                if not has_changes(tree, target or tree.base):
                    cleanup(main_top, tree)
                    merge_stage("passed")
                    return "passed", "no changes to merge"
                rev_range = f"{target}...{tree.branch}" if target else f"{tree.base}..{tree.branch}"
                diff = diff_for_review(tree, rev_range)
            except (RuntimeError, OSError) as e:
                # Show the failure. The person can still discard, or fix the worktree by hand.
                diff = {"files": [], "truncated": False}
                error = " ".join(x for x in (error, f"Cannot read the run's changes: {e}") if x)
            payload = {
                **diff,
                "worktree": str(tree.top),
                "branch": target or branch,
                "branchLocked": target is not None,
                "message": message,
                "verdict": review.get("verdict"),
                "findings": review.get("findings"),
                "summary": implement.get("summary"),
                "note": note,
                "error": error,
            }
            merge_stage("waiting")
            response: Any = await hub.ask("review", payload, "merge")
            merge_stage("running")
            note = error = None

            try:
                if response.get("action") == "discard":
                    cleanup(main_top, tree)
                    merge_stage("failed")
                    return "failed", "discarded by a person"

                if response.get("action") == "changes":
                    # The old verdict no longer applies to the new diff.
                    handoff.pop("review", None)
                    feedback = f"A PERSON REVIEWED THE CHANGE AND ASKS FOR THIS:\n{response['text']}"
                    for name in ("implement", "review"):
                        stage = next((s for s in spec["stages"] if s["name"] == name), None)
                        if stage is None:
                            continue
                        check = await run_checked(stage, feedback if name == "implement" else None)
                        if check["stopped"]:
                            return stopped_result()
                        if not check["passed"]:
                            error = f"The {name} stage did not pass after your request: {check['reason']}"
                            break
                    continue

                chosen = str(response.get("branch", "")).strip()
                message = str(response.get("message", "")).strip() or message
                if target is not None and chosen != target:
                    error = (f"This run's branch now holds the history of {target}, from resolving the conflict. "
                             f"Merge into {target}, or discard the run.")
                    continue
                if not valid_branch_name(tree.top, chosen):
                    error = f'"{chosen}" is not a valid branch name.'
                    continue
                branch = chosen
                result = squash_merge(tree, branch, message, RUNS / run_id / "merge")
                if result["kind"] == "merged":
                    cleanup(main_top, tree)
                    merge_stage("passed")
                    return "passed", f"merged into {branch} as {result['sha']}"
                if result["kind"] == "refused":
                    error = result["reason"]
                    continue

                # Conflict: merge the target into the story branch, and let the model fix it.
                try:
                    files = start_resolve_merge(tree, branch)
                except RuntimeError:
                    abort_resolve_merge(tree)
                    raise
                if files:
                    check = await run_checked(resolve_stage(branch, tree.top, files))
                    if check["stopped"]:
                        abort_resolve_merge(tree)
                        return stopped_result()
                    if not check["passed"]:
                        abort_resolve_merge(tree)
                        error = (f"Merging into {branch} conflicted in {', '.join(files)}, and the resolve stage "
                                 f"did not pass: {check['reason']}")
                        continue
                    try:
                        finish_resolve_merge(tree)
                    except RuntimeError:
                        abort_resolve_merge(tree)
                        raise
                    summary = (check.get("output") or {}).get("summary", "")
                    note = (f"Merging into {branch} conflicted in {', '.join(files)}. The model resolved it: "
                            f"{summary} This diff is against {branch}.")
                else:
                    note = (f"{branch} changed since this run started. It is now merged into the story branch, "
                            f"and this diff is against {branch}.")
                target = branch
            except (RuntimeError, OSError) as e:
                # A git failure must not end the run. Show it, and let the person decide again.
                error = f"The last action failed: {e}"

    try:
        for stage in spec["stages"]:
            check = await run_checked(stage)
            if not check["passed"]:
                print(f"Stage {stage['name']} failed its check. Stopping.")
                await end("failed", f"{stage['name']}: {check['reason']}")
                sys.exit(1)

        if hub and tree:
            # The person reads the review stage's verdict in the dashboard and decides.
            status, reason = await review_and_merge(hub, tree)
            print(f"Run {status}: {reason}")
            await end(status, reason)
            if status == "failed":
                sys.exit(1)
            return

        review = handoff.get("review")
        if review and review["verdict"] == "request_changes":
            print("Review requested changes:", review["findings"])
            await end("failed", "the review requested changes")
            sys.exit(1)
        await end("passed", "all stages passed")
    except (Exception, KeyboardInterrupt, asyncio.CancelledError) as error:
        await end("failed", "stopped with Ctrl-C" if isinstance(error, KeyboardInterrupt) else str(error))
        raise


if __name__ == "__main__":
    asyncio.run(main())
