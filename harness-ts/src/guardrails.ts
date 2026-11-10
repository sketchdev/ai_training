/**
 * Guardrails written as code.
 *
 * `checkToolCall` is a plain function, so you can unit test it without the SDK.
 * `makePreToolUseHook` wraps it in the callback shape that the SDK expects.
 */
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";

export function checkToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  protectedPaths: readonly string[],
): string | null {
  if (["Edit", "Write", "MultiEdit"].includes(toolName)) {
    const path = String(toolInput.file_path ?? "");
    for (const protectedPath of protectedPaths) {
      if (protectedPath && path.includes(protectedPath)) {
        return `${path} is a protected path`;
      }
    }
  }
  if (toolName === "Bash") {
    const command = String(toolInput.command ?? "");
    for (const fragment of ["git push", "rm -rf", "curl ", "wget "]) {
      if (command.includes(fragment)) {
        return `command contains blocked text: ${fragment.trim()}`;
      }
    }
  }
  return null;
}

/** Build a PreToolUse hook callback. Check the signature against your SDK version. */
export function makePreToolUseHook(protectedPaths: readonly string[]): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") {
      return {};
    }
    const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
    const reason = checkToolCall(input.tool_name, toolInput, protectedPaths);
    if (reason === null) {
      return {};
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "deny" as const,
        permissionDecisionReason: reason,
      },
    };
  };
}
