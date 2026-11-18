"""Starter orchestrator: load a workflow file, run each stage, log the result.

Run:  python -m harness.orchestrator workflows/story-to-pr.yaml stories/story-1-list-games.md --repo ../battleship

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
from .hub_client import HubClient, HubUnavailable, TurnTracker, summarize
from .schemas import ImplementResult, Plan, ReviewResult

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
}

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


def build_options(stage: dict, repo: Path, spec: dict, plugin: Path) -> ClaudeAgentOptions:
    limits = spec.get("limits", {})
    schema = SCHEMAS.get(stage["name"])
    return ClaudeAgentOptions(
        cwd=str(repo),
        allowed_tools=stage["allowed_tools"],
        permission_mode="dontAsk",
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


def build_prompt(stage: dict, story: str, handoff: dict, feedback: Optional[str]) -> str:
    prompt = f"{stage['prompt']}\n\nSTORY:\n{story}"
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
    stage: dict, story: str, repo: Path, spec: dict, plugin: Path, handoff: dict, feedback: Optional[str] = None
) -> dict:
    """Headless: one prompt, no person. Tools outside allowed_tools are denied."""
    options = build_options(stage, repo, spec, plugin)
    prompt = build_prompt(stage, story, handoff, feedback)
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
    story: str,
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

    options = build_options(stage, repo, spec, plugin)
    options.permission_mode = "default"
    options.can_use_tool = can_use_tool
    prompt = f"{build_prompt(stage, story, handoff, feedback)}\n\n{ASK_LINE}"
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
    if stage["name"] == "plan":
        # The schema requires at least one file and one test.
        return {"passed": True, "reason": "plan lists at least one file and one test", "output": output}
    if stage["name"] == "implement":
        # Do not trust the agent's own report. Run the build here.
        build = subprocess.run(["./mvnw", "verify", "-q"], cwd=repo, capture_output=True, text=True)
        if build.returncode == 0:
            return {"passed": True, "reason": "./mvnw verify passes", "output": output}
        return {"passed": False, "reason": f"./mvnw verify fails:\n{build.stdout[-2000:]}", "output": output}
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


def git(cwd: Path, *args: str) -> str:
    done = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if done.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {done.stderr.strip()}")
    return done.stdout.strip()


def create_worktree(repo: Path, run_id: str, story_name: str) -> Path:
    """Check out the repository again at runs/<run id>/repo, on a new branch, so that parallel
    runs do not change each other's files. Returns the folder that matches `repo` in it."""
    top = Path(git(repo, "rev-parse", "--show-toplevel"))
    prefix = git(repo, "rev-parse", "--show-prefix")
    dirty = git(top, "status", "--porcelain", "--", prefix or ".")
    if dirty:
        print(f"These files are not committed, so the worktree does not have them:\n{dirty}", file=sys.stderr)
    path = RUNS / run_id / "repo"
    branch = f"story/{story_name}-{run_id}"
    git(top, "worktree", "add", "-b", branch, str(path), "HEAD")
    print(f"Worktree {path} on branch {branch}")
    return path / prefix


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workflow")
    parser.add_argument("story")
    parser.add_argument("--repo", required=True, help="Path to the Battleship repository")
    parser.add_argument("--plugin", default=DEFAULT_PLUGIN, help="Path to the plugin to load")
    parser.add_argument("--dashboard", action="store_true", help="Report to the dashboard hub and take input from a person")
    parser.add_argument("--hub", default=DEFAULT_HUB, help="URL of the dashboard hub")
    args = parser.parse_args()

    RUNS.mkdir(exist_ok=True)
    spec = yaml.safe_load(Path(args.workflow).read_text())
    story = Path(args.story).read_text()
    story_name = Path(args.story).stem
    plugin = Path(args.plugin).resolve()
    if not (plugin / ".claude-plugin" / "plugin.json").exists():
        sys.exit(f"No plugin found at {plugin}. Pass --plugin or set CORE_PLUGIN_PATH.")
    max_retries = spec.get("limits", {}).get("max_retries", 1)
    handoff: dict = {}

    repo = Path(args.repo).resolve()
    run_id = new_run_id()
    hub: Optional[HubClient] = None
    if args.dashboard:
        try:
            hub = await HubClient.register(
                args.hub,
                {
                    "story": story_name,
                    "workflow": spec.get("name", Path(args.workflow).stem),
                    "harness": "python",
                    "repo": str(repo),
                    "stages": [s["name"] for s in spec["stages"]],
                },
            )
        except HubUnavailable as error:
            sys.exit(str(error))
        run_id = hub.run_id

    async def end(status: str, reason: str) -> None:
        if hub:
            hub.emit({"type": "end", "status": status, "reason": reason})
            await hub.close()

    if hub:
        try:
            repo = create_worktree(repo, run_id, story_name)
        except (RuntimeError, OSError) as error:
            # The run is registered already, so end it on the dashboard too.
            reason = f"cannot create the worktree: {error}"
            await end("failed", reason)
            sys.exit(reason)
        hub.start_inbox()
        print(f"Run {run_id} on {args.hub}")

    try:
        for stage in spec["stages"]:
            check: dict = {"passed": False, "reason": "not run"}
            feedback: Optional[str] = None
            attempt, turns, cost, stopped = 0, 0, 0.0, False

            while True:
                for retry in range(max_retries + 1):
                    attempt += 1
                    if hub:
                        hub.emit({"type": "stage", "stage": stage["name"], "status": "running", "attempt": attempt})
                        row = await run_stage_live(stage, story, repo, spec, plugin, handoff, hub, feedback)
                    else:
                        row = await run_stage(stage, story, repo, spec, plugin, handoff, feedback)
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
                    break
                feedback = (
                    f"{check['reason']}\n\nA PERSON ADDS:\n{reply['text']}"
                    if reply.get("action") == "reply"
                    else check["reason"]
                )

            if not check["passed"]:
                if hub:
                    hub.emit({"type": "stage", "stage": stage["name"], "status": "failed"})
                print(f"Stage {stage['name']} failed its check. Stopping.")
                await end("failed", f"{stage['name']}: {check['reason']}")
                sys.exit(1)
            if hub:
                hub.emit({"type": "stage", "stage": stage["name"], "status": "passed"})
            handoff[stage["name"]] = check.get("output")

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
