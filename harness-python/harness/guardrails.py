"""Guardrails written as code.

`check_tool_call` is plain Python so you can unit test it without the SDK.
`pre_tool_use_hook` wraps it in the callback shape that the SDK expects.
"""
from typing import Iterable, Optional


def check_tool_call(tool_name: str, tool_input: dict, protected_paths: Iterable[str]) -> Optional[str]:
    """Return a reason to deny the call, or None to allow it."""
    if tool_name in ("Edit", "Write", "MultiEdit"):
        path = tool_input.get("file_path", "")
        for protected in protected_paths:
            if protected and protected in path:
                return f"{path} is a protected path"
    if tool_name == "Bash":
        command = tool_input.get("command", "")
        for fragment in ("git push", "rm -rf", "curl ", "wget "):
            if fragment in command:
                return f"command contains blocked text: {fragment.strip()}"
    return None


def make_pre_tool_use_hook(protected_paths: Iterable[str]):
    """Build a PreToolUse hook callback. Check the signature against your SDK version."""
    protected = list(protected_paths)

    async def hook(input_data, tool_use_id, context):
        reason = check_tool_call(
            input_data.get("tool_name", ""), input_data.get("tool_input", {}), protected
        )
        if reason is None:
            return {}
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        }

    return hook
