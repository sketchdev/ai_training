"""Starter orchestrator: load a workflow file, run each stage, log the result.

Run:  python -m harness.orchestrator workflows/story-to-pr.yaml stories/story-1-list-games.md --repo ../battleship

Check option names against the Agent SDK version that you install. Where this file
says TODO, the lab asks you to add code.
"""
import argparse
import asyncio
import csv
import json
import time
from pathlib import Path

import yaml
from claude_agent_sdk import ClaudeAgentOptions, HookMatcher, ResultMessage, query

from .guardrails import make_pre_tool_use_hook

RUNS = Path(__file__).resolve().parent.parent / "runs"


async def run_stage(stage: dict, story: str, repo: Path, spec: dict) -> dict:
    limits = spec.get("limits", {})
    options = ClaudeAgentOptions(
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
        # TODO (lab step 2): load plugin v1:
        # plugins=[{"type": "local", "path": "../team-plugin"}],
        # TODO (lab step 4): add output_format with a JSON Schema from harness/schemas.py
    )
    prompt = f"{stage['prompt']}\n\nSTORY:\n{story}"
    log = RUNS / f"{int(time.time())}-{stage['name']}.jsonl"
    result = None
    with log.open("w") as transcript:
        async for message in query(prompt=prompt, options=options):
            transcript.write(json.dumps(repr(message)) + "\n")
            if isinstance(message, ResultMessage):
                result = message
    if result is None:
        return {"stage": stage["name"], "subtype": "no_result", "turns": 0, "cost": 0.0, "session_id": ""}
    return {
        "stage": stage["name"],
        "subtype": result.subtype,
        "turns": result.num_turns,
        "cost": result.total_cost_usd,
        "session_id": result.session_id,
    }


def append_metrics(row: dict, story_name: str) -> None:
    path = RUNS / "metrics.csv"
    new = not path.exists()
    with path.open("a", newline="") as f:
        writer = csv.DictWriter(
            f, fieldnames=["story", "stage", "subtype", "passed", "turns", "cost", "session_id"]
        )
        if new:
            writer.writeheader()
        # `passed` starts as "the stage succeeded". Lab step 4 replaces it with the stage's `check`.
        writer.writerow({"story": story_name, "passed": row["subtype"] == "success", **row})


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workflow")
    parser.add_argument("story")
    parser.add_argument("--repo", required=True, help="Path to the Battleship repository")
    args = parser.parse_args()

    RUNS.mkdir(exist_ok=True)
    spec = yaml.safe_load(Path(args.workflow).read_text())
    story = Path(args.story).read_text()

    for stage in spec["stages"]:
        row = await run_stage(stage, story, Path(args.repo), spec)
        append_metrics(row, Path(args.story).stem)
        print(row)
        # TODO (lab step 4): parse structured output, check the stage's `check`, and stop or retry.
        if row["subtype"] != "success":
            print("Stage did not succeed. Stopping.")
            break


if __name__ == "__main__":
    asyncio.run(main())
