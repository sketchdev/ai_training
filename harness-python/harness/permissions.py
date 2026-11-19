"""The permission mode each stage runs in.

The person can choose one for the whole run, with --permission-mode or in the dashboard's
launch form. A workflow file can set `permission_mode` for the workflow, or for one stage.
The run's choice wins, then the stage's, then the workflow's. With none of them, a headless
run uses dontAsk (deny what allowed_tools does not cover) and a dashboard run uses default
(ask the person on the dashboard). The guardrail hook runs in every mode.

"plan" is left out: nothing executes in it, so an implement stage could never pass.
harness-ts/src/permissions.ts has the same rules.
"""
from typing import Optional

RUN_MODES = ("default", "acceptEdits", "auto", "dontAsk", "bypassPermissions")

MODE_HELP = {
    "default": "Tools outside a stage's allowed_tools wait for a person on the dashboard. Headless runs deny them.",
    "acceptEdits": "File edits run without asking. Other tools outside allowed_tools still wait for a person.",
    "auto": "A model classifier decides on tools outside allowed_tools.",
    "dontAsk": "Tools outside allowed_tools are denied, and the model cannot ask the person questions.",
    "bypassPermissions": "Every tool runs without a permission check. Only the guardrail hook still blocks calls.",
}


def mode_for(stage: dict, workflow: dict, override: Optional[str], live: bool) -> str:
    """The mode that one stage runs in."""
    chosen = override or stage.get("permission_mode") or workflow.get("permission_mode")
    if chosen in RUN_MODES:
        return chosen
    return "default" if live else "dontAsk"


def mode_options(mode: str) -> dict:
    """The ClaudeAgentOptions fields for a mode. bypassPermissions needs the SDK's explicit opt-in."""
    if mode == "bypassPermissions":
        return {"permission_mode": mode, "extra_args": {"allow-dangerously-skip-permissions": None}}
    return {"permission_mode": mode}


def check_modes(workflow: dict, override: Optional[str], live: bool) -> list[str]:
    """Reasons the run cannot start with these modes. A workflow with `requires_dashboard` has a
    stage that asks the person questions, so it needs the dashboard and a mode that allows asking."""
    errors = []
    if workflow.get("permission_mode") is not None and workflow["permission_mode"] not in RUN_MODES:
        errors.append(f'permission_mode "{workflow["permission_mode"]}" is not one of {", ".join(RUN_MODES)}')
    for stage in workflow.get("stages", []):
        if stage.get("permission_mode") is not None and stage["permission_mode"] not in RUN_MODES:
            errors.append(f'stage {stage.get("name")}: permission_mode "{stage["permission_mode"]}" is not one of {", ".join(RUN_MODES)}')
    if workflow.get("requires_dashboard"):
        if not live:
            errors.append("this workflow asks the person questions, so it needs --dashboard")
        silent = [s["name"] for s in workflow.get("stages", []) if mode_for(s, workflow, override, live) == "dontAsk"]
        if live and silent:
            errors.append(f"this workflow asks the person questions, and dontAsk denies that (stages: {', '.join(silent)})")
    return errors
