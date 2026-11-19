/**
 * The permission mode each stage runs in.
 *
 * The person can choose one for the whole run, with --permission-mode or in the dashboard's
 * launch form. A workflow file can set `permission_mode` for the workflow, or for one stage.
 * The run's choice wins, then the stage's, then the workflow's. With none of them, a headless
 * run uses dontAsk (deny what allowed_tools does not cover) and a dashboard run uses default
 * (ask the person on the dashboard). The guardrail hook runs in every mode.
 *
 * "plan" is left out: nothing executes in it, so an implement stage could never pass.
 * harness-python/harness/permissions.py has the same rules.
 */
import type { Options } from "@anthropic-ai/claude-agent-sdk";

export const RUN_MODES = ["default", "acceptEdits", "auto", "dontAsk", "bypassPermissions"] as const;
export type RunMode = (typeof RUN_MODES)[number];

/** What each mode does, for the launch form and the usage text. */
export const MODE_HELP: Record<RunMode, string> = {
  default: "Tools outside a stage's allowed_tools wait for a person on the dashboard. Headless runs deny them.",
  acceptEdits: "File edits run without asking. Other tools outside allowed_tools still wait for a person.",
  auto: "A model classifier decides on tools outside allowed_tools.",
  dontAsk: "Tools outside allowed_tools are denied, and the model cannot ask the person questions.",
  bypassPermissions: "Every tool runs without a permission check. Only the guardrail hook still blocks calls.",
};

export function isRunMode(value: unknown): value is RunMode {
  return typeof value === "string" && (RUN_MODES as readonly string[]).includes(value);
}

interface HasMode {
  name?: string;
  permission_mode?: string;
}

/** The mode that one stage runs in. */
export function modeFor(stage: HasMode, workflow: HasMode, override: RunMode | undefined, live: boolean): RunMode {
  const chosen = override ?? stage.permission_mode ?? workflow.permission_mode;
  if (isRunMode(chosen)) return chosen;
  return live ? "default" : "dontAsk";
}

/** The SDK options for a mode. bypassPermissions needs the SDK's explicit opt-in. */
export function modeOptions(mode: RunMode): Pick<Options, "permissionMode" | "allowDangerouslySkipPermissions"> {
  return mode === "bypassPermissions" ? { permissionMode: mode, allowDangerouslySkipPermissions: true } : { permissionMode: mode };
}

/**
 * Reasons the run cannot start with these modes. A workflow with `requires_dashboard` has a
 * stage that asks the person questions, so it needs the dashboard and a mode that allows asking.
 */
export function checkModes(
  workflow: HasMode & { requires_dashboard?: boolean; stages: HasMode[] },
  override: RunMode | undefined,
  live: boolean,
): string[] {
  const errors: string[] = [];
  if (workflow.permission_mode !== undefined && !isRunMode(workflow.permission_mode)) {
    errors.push(`permission_mode "${workflow.permission_mode}" is not one of ${RUN_MODES.join(", ")}`);
  }
  for (const stage of workflow.stages) {
    if (stage.permission_mode !== undefined && !isRunMode(stage.permission_mode)) {
      errors.push(`stage ${stage.name}: permission_mode "${stage.permission_mode}" is not one of ${RUN_MODES.join(", ")}`);
    }
  }
  if (workflow.requires_dashboard) {
    if (!live) errors.push("this workflow asks the person questions, so it needs --dashboard");
    const silent = workflow.stages.filter((s) => modeFor(s, workflow, override, live) === "dontAsk").map((s) => s.name);
    if (live && silent.length > 0) {
      errors.push(`this workflow asks the person questions, and dontAsk denies that (stages: ${silent.join(", ")})`);
    }
  }
  return errors;
}
