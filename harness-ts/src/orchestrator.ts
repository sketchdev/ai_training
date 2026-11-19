/**
 * Starter orchestrator: load a workflow file, run each stage, log the result.
 *
 * Run:  npm run run-story -- workflows/story-to-pr.yaml --input story=stories/story-1-list-games.md
 *       (the older form, workflows/story-to-pr.yaml stories/story-1-list-games.md --repo ../battleship, still works)
 *
 * The workflow file's `inputs` section says what the run needs (src/inputs.ts). Pass each one
 * as --input name=value. Inputs with a default can be left out.
 *
 * Each stage loads the core plugin, returns a typed result (src/schemas.ts), and must pass
 * its `check` before the next stage starts. The result of each stage goes to the next one.
 *
 * Add --dashboard to report to the dashboard hub (npm run hub) and take input from a person.
 * The run then works in its own git worktree under runs/<run id>/, so several runs can
 * share one repository. Without --dashboard, the run is headless and asks no one.
 *
 * Check option names against the Agent SDK version that you install.
 */
import { execFile } from "node:child_process";
import { query, type CanUseTool, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { parse } from "yaml";
import { z } from "zod";

import { makePreToolUseHook } from "./guardrails.ts";
import {
  checkSpecs,
  fillPlaceholders,
  type InputSpecs,
  LEGACY_INPUTS,
  parseInputFlags,
  promptBlock,
  checkStageNames,
  runTitle,
  validateInputs,
} from "./inputs.ts";
import { newRunId } from "./hub.ts";
import { HubClient, InputQueue, summarize, TurnTracker } from "./hubClient.ts";
import type { PermissionResponse, QuestionResponse, ReplyResponse, ReviewPayload, ReviewResponse } from "./hubTypes.ts";
import {
  abortResolveMerge,
  cleanup,
  commitRun,
  defaultBranchName,
  defaultCommitMessage,
  diffForReview,
  filesWithMarkers,
  finishResolveMerge,
  git,
  hasChanges,
  type RunTree,
  squashMerge,
  startResolveMerge,
  validBranchName,
} from "./merge.ts";
import { ImplementResult, Interview, outputSchema, Plan, ResolveResult, ReviewResult } from "./schemas.ts";
import { checkModes, isRunMode, MODE_HELP, modeFor, modeOptions, RUN_MODES, type RunMode } from "./permissions.ts";

const execFileAsync = promisify(execFile);
const RUNS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "runs");
const DEFAULT_HUB = "http://127.0.0.1:4321";
const METRICS_HEADER = "run_id,story,stage,subtype,passed,turns,cost,session_id";

// The core plugin. Override with --plugin or the CORE_PLUGIN_PATH environment variable.
const DEFAULT_PLUGIN =
  process.env.CORE_PLUGIN_PATH ?? join(homedir(), ".claude", "plugins", "marketplaces", "joetopp", "plugins", "core");

// The typed result that each stage must return, keyed by stage name.
const SCHEMAS: Record<string, z.ZodType> = {
  plan: Plan,
  implement: ImplementResult,
  review: ReviewResult,
  resolve: ResolveResult,
  interview: Interview,
};

/** The permission mode that the person chose for the whole run, if any. Set in main(). */
let runMode: RunMode | undefined;

// Added to each prompt when a person is on the dashboard.
const ASK_LINE = "If you need a decision from a person, use the AskUserQuestion tool. A person reads it on the dashboard.";

interface Stage {
  name: string;
  allowed_tools: string[];
  prompt: string;
  /** This stage's permission mode, unless the run sets one (src/permissions.ts). */
  permission_mode?: string;
  /** Only for the built-in resolve stage: the worktree root and its conflicted files. */
  conflict?: { top: string; files: string[] };
}

/** A built-in stage that fixes the conflicts of merging `target` into the story branch. */
function resolveStage(target: string, top: string, files: string[]): Stage {
  return {
    name: "resolve",
    allowed_tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash(./mvnw *)", "Bash(git diff *)", "Bash(git status *)"],
    prompt:
      `This branch holds the story's changes. Merging ${target} into it conflicted in these files ` +
      `(paths from the repository root):\n${files.map((f) => `- ${f}`).join("\n")}\n\n` +
      "Resolve every conflict. Keep the intent of both sides, remove every conflict marker, and run " +
      "./mvnw verify until it passes. Do not run git add, git commit, or git merge: the orchestrator " +
      "finishes the merge. Summarize how you resolved each file.",
    conflict: { top, files },
  };
}

interface Spec {
  name?: string;
  inputs?: InputSpecs;
  /** The workflow's permission mode, unless a stage or the run sets one (src/permissions.ts). */
  permission_mode?: string;
  /** True if a stage asks the person questions, so the run needs the dashboard. */
  requires_dashboard?: boolean;
  protected_paths?: string[];
  limits?: { max_turns?: number; max_budget_usd?: number; max_retries?: number };
  stages: Stage[];
}

interface Row {
  stage: string;
  subtype: string;
  turns: number;
  cost: number;
  session_id: string;
  output?: unknown;
}

function buildOptions(stage: Stage, repo: string, spec: Spec, plugin: string, live = false): Options {
  const schema = SCHEMAS[stage.name];
  const limits = spec.limits ?? {};
  return {
    cwd: repo,
    allowedTools: stage.allowed_tools,
    ...modeOptions(modeFor(stage, spec, runMode, live)),
    maxTurns: limits.max_turns,
    maxBudgetUsd: limits.max_budget_usd,
    settingSources: ["project"],
    hooks: {
      PreToolUse: [
        {
          matcher: "Edit|Write|Bash",
          hooks: [makePreToolUseHook(spec.protected_paths ?? [])],
        },
      ],
    },
    plugins: [{ type: "local", path: plugin }],
    ...(schema && { outputFormat: { type: "json_schema", schema: outputSchema(schema) } }),
  };
}

/** `context` is the workflow's inputs as prompt text, from promptBlock in src/inputs.ts. */
function buildPrompt(stage: Stage, context: string, handoff: Record<string, unknown>, feedback?: string): string {
  let prompt = context ? `${stage.prompt}\n\n${context}` : stage.prompt;
  for (const [name, output] of Object.entries(handoff)) {
    prompt += `\n\nRESULT OF THE ${name.toUpperCase()} STAGE:\n${JSON.stringify(output, null, 2)}`;
  }
  if (feedback) {
    prompt += `\n\nYOUR PREVIOUS ATTEMPT FAILED ITS CHECK:\n${feedback}`;
  }
  return prompt;
}

function openLog(stage: Stage): string {
  const log = join(RUNS, `${Math.floor(Date.now() / 1000)}-${stage.name}.jsonl`);
  writeFileSync(log, "");
  return log;
}

function toRow(stage: Stage, message: Extract<SDKMessage, { type: "result" }>): Row {
  return {
    stage: stage.name,
    subtype: message.subtype,
    turns: message.num_turns,
    cost: message.total_cost_usd,
    session_id: message.session_id,
    output: message.subtype === "success" ? message.structured_output : undefined,
  };
}

/** Headless: one prompt, no person. Tools outside allowed_tools are denied. */
async function runStage(
  stage: Stage,
  context: string,
  repo: string,
  spec: Spec,
  plugin: string,
  handoff: Record<string, unknown>,
  feedback?: string,
): Promise<Row> {
  const options = buildOptions(stage, repo, spec, plugin);
  const prompt = buildPrompt(stage, context, handoff, feedback);
  const log = openLog(stage);

  let row: Row = { stage: stage.name, subtype: "no_result", turns: 0, cost: 0, session_id: "" };
  for await (const message of query({ prompt, options })) {
    appendFileSync(log, JSON.stringify(message) + "\n");
    if (message.type === "result") row = toRow(stage, message);
  }
  return row;
}

/**
 * Live: the session stays open, and a person on the dashboard can answer questions,
 * allow tools outside allowed_tools, send messages, and interrupt. If the model ends its
 * turn without a result, the stage waits for the person's reply in the same session.
 */
async function runStageLive(
  stage: Stage,
  context: string,
  repo: string,
  spec: Spec,
  plugin: string,
  handoff: Record<string, unknown>,
  hub: HubClient,
  feedback?: string,
): Promise<Row> {
  const canUseTool: CanUseTool = async (toolName, input, { signal }) => {
    if (toolName === "AskUserQuestion") {
      const response = (await hub.ask("question", { questions: input.questions }, stage.name, signal)) as
        | QuestionResponse
        | undefined;
      if (!response || "skip" in response) {
        return { behavior: "deny", message: "The person did not answer. Continue with your best judgment and say what you assumed." };
      }
      return { behavior: "allow", updatedInput: { ...input, answers: response.answers } };
    }
    // The guardrail hook already ran, and allowed_tools already allowed what it covers.
    const response = (await hub.ask("permission", { tool: toolName, input }, stage.name, signal)) as
      | PermissionResponse
      | undefined;
    if (response?.allow) return { behavior: "allow", updatedInput: input };
    const note = response?.note ? ` The person says: ${response.note}` : "";
    return { behavior: "deny", message: `A person denied this ${toolName} call.${note}` };
  };

  const options: Options = { ...buildOptions(stage, repo, spec, plugin, true), canUseTool };
  hub.emit({ type: "message", stage: stage.name, role: "system", text: `Permission mode: ${options.permissionMode}.` });
  const hasSchema = stage.name in SCHEMAS;
  const input = new InputQueue();
  const turns = new TurnTracker();
  const send = (text: string) => turns.sent(input.push(text));
  send(`${buildPrompt(stage, context, handoff, feedback)}\n\n${ASK_LINE}`);
  const session = query({ prompt: input, options });
  hub.onMessage = send;
  hub.onInterrupt = () => void session.interrupt().catch(() => {});
  const log = openLog(stage);

  let row: Row = { stage: stage.name, subtype: "no_result", turns: 0, cost: 0, session_id: "" };
  let lastText = "";
  let lastOutput: unknown;
  try {
    for await (const message of session) {
      appendFileSync(log, JSON.stringify(message) + "\n");
      for (const event of summarize(message, stage.name)) hub.emit(event);
      if (message.type === "assistant") {
        const text = message.message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
        if (text) lastText = text;
      }
      if (message.type !== "result") continue;

      row = toRow(stage, message);
      // Keep the latest typed result, even if a later turn (a person's message) ends without one.
      if (row.output !== undefined) lastOutput = row.output;
      else if (row.subtype === "success") row.output = lastOutput;
      // A message that a person sent mid-turn is still to run. Wait for its result.
      if (!turns.consume(message)) continue;

      // A stage without a schema has no typed result, so a successful turn finishes it.
      const finished = row.subtype === "success" && (!hasSchema || row.output !== undefined);
      // A turn or budget limit ends the session. The stage check then decides what is next.
      if (finished || message.subtype === "error_max_turns" || message.subtype === "error_max_budget_usd") {
        input.close();
        continue;
      }
      hub.emit({ type: "stage", stage: stage.name, status: "waiting" });
      const reply = (await hub.ask(
        "reply",
        { lastText, reason: `The session ended its turn with ${message.subtype} and no result.` },
        stage.name,
      )) as ReplyResponse;
      hub.emit({ type: "stage", stage: stage.name, status: "running" });
      if (reply.action === "reply") {
        send(reply.text);
      } else {
        if (reply.action === "stop") row.subtype = "stopped";
        input.close();
      }
    }
  } finally {
    input.close();
    hub.onMessage = () => {};
    hub.onInterrupt = () => {};
  }
  return row;
}

interface Check {
  passed: boolean;
  reason: string;
  output?: unknown;
  /** True when a person pressed Stop. */
  stopped?: boolean;
}

/** Stage names that the orchestrator uses itself. A workflow file must not use them. */

/** Parse the stage's structured output and apply the stage's `check` from the workflow file. */
async function checkStage(stage: Stage, row: Row, repo: string): Promise<Check> {
  if (row.subtype !== "success") {
    return { passed: false, reason: `the stage ended with ${row.subtype}` };
  }
  const schema = SCHEMAS[stage.name];
  if (!schema) {
    return { passed: true, reason: "no schema for this stage" };
  }
  const parsed = schema.safeParse(row.output);
  if (!parsed.success) {
    return { passed: false, reason: `the result does not match the schema: ${parsed.error.message}` };
  }
  const output = parsed.data;
  if (stage.conflict) {
    // The built-in resolve stage.
    const left = filesWithMarkers(stage.conflict.top, stage.conflict.files);
    if (left.length > 0) {
      return { passed: false, reason: `conflict markers remain in ${left.join(", ")}`, output };
    }
    return verify(repo, output);
  }
  switch (stage.name) {
    case "plan":
      // The schema requires at least one file and one test.
      return { passed: true, reason: "plan lists at least one file and one test", output };
    case "interview":
      // The schema requires the person's decisions, and at least one file and one test.
      return { passed: true, reason: "plan records the person's decisions and lists files and tests", output };
    case "implement":
      // Do not trust the agent's own report. Run the build here.
      return verify(repo, output);
    case "review":
      // The schema allows only "approve" or "request_changes".
      return { passed: true, reason: `verdict is ${(output as ReviewResult).verdict}`, output };
    default:
      return { passed: true, reason: "result matches the schema", output };
  }
}

/** Run the build. It runs without blocking, so the dashboard connection keeps working. */
async function verify(repo: string, output: unknown): Promise<Check> {
  try {
    await execFileAsync("./mvnw", ["verify", "-q"], { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
    return { passed: true, reason: "./mvnw verify passes", output };
  } catch (error) {
    const out = (error as { stdout?: Buffer }).stdout?.toString().slice(-2000) ?? "";
    return { passed: false, reason: `./mvnw verify fails:\n${out}`, output };
  }
}

function appendMetrics(row: Row, passed: boolean, storyName: string, runId: string): void {
  const path = join(RUNS, "metrics.csv");
  if (existsSync(path) && readFileSync(path, "utf8").split("\n", 1)[0] !== METRICS_HEADER) {
    // An older file without the run_id column. Keep it beside the new one.
    renameSync(path, join(RUNS, `metrics-${Date.now()}.csv`));
  }
  if (!existsSync(path)) {
    writeFileSync(path, METRICS_HEADER + "\n");
  }
  const cells = [runId, storyName, row.stage, row.subtype, passed, row.turns, row.cost, row.session_id];
  appendFileSync(path, cells.join(",") + "\n");
}

/**
 * Check out the repository again at runs/<run id>/repo, on a new branch, so that parallel
 * runs do not change each other's files. Returns the folder that matches `repo` in it, the
 * run's worktree and branch, and the root of the main checkout.
 */
function createWorktree(repo: string, runId: string, storyName: string): { repo: string; tree: RunTree; mainTop: string } {
  const mainTop = git(repo, ["rev-parse", "--show-toplevel"]);
  const prefix = git(repo, ["rev-parse", "--show-prefix"]);
  const dirty = git(mainTop, ["status", "--porcelain", "--", prefix || "."]);
  if (dirty) {
    console.warn(`These files are not committed, so the worktree does not have them:\n${dirty}`);
  }
  const top = join(RUNS, runId, "repo");
  const branch = `story/${storyName}-${runId}`;
  const base = git(mainTop, ["rev-parse", "HEAD"]);
  git(mainTop, ["worktree", "add", "-q", "-b", branch, top, base]);
  console.log(`Worktree ${top} on branch ${branch}`);
  return { repo: join(top, prefix), tree: { top, prefix, branch, base }, mainTop };
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      input: { type: "string", multiple: true, default: [] },
      repo: { type: "string" },
      plugin: { type: "string" },
      dashboard: { type: "boolean", default: false },
      hub: { type: "string", default: DEFAULT_HUB },
      // Set by the hub when it launches the run, so the run fills the entry it already shows.
      "run-id": { type: "string" },
      "permission-mode": { type: "string" },
    },
  });
  const [workflow, legacyStory] = positionals;
  const usage =
    "Usage: orchestrator <workflow.yaml> [--input name=value ...] [--plugin <path>] [--dashboard [--hub <url>]]\n" +
    "       orchestrator <workflow.yaml> <story.md> --repo <path>   (the older form)\n" +
    `--permission-mode sets the mode for every stage: ${RUN_MODES.join(", ")}.\n` +
    RUN_MODES.map((m) => `  ${m}: ${MODE_HELP[m]}`).join("\n");
  if (!workflow) {
    console.error(usage);
    process.exit(2);
  }

  mkdirSync(RUNS, { recursive: true });
  const spec = parse(readFileSync(workflow, "utf8")) as Spec;
  const specs = spec.inputs ?? LEGACY_INPUTS;
  const specErrors = checkSpecs(specs);
  if (specErrors.length > 0) {
    console.error(`The inputs section of ${workflow} is not usable:\n- ${specErrors.join("\n- ")}`);
    process.exit(2);
  }
  let given: Record<string, string>;
  try {
    given = parseInputFlags(values.input);
  } catch (error) {
    console.error(`${(error as Error).message}\n${usage}`);
    process.exit(2);
  }
  // The older form: a positional story file and --repo.
  if (legacyStory && given.story === undefined) given.story = legacyStory;
  if (values.repo && given.repo === undefined) given.repo = values.repo;
  const base = process.cwd();
  const { values: inputs, errors } = validateInputs(specs, given, base);
  if (errors.length > 0) {
    console.error(`The inputs are not usable:\n- ${errors.join("\n- ")}\n${usage}`);
    process.exit(2);
  }
  const chosenMode = values["permission-mode"];
  if (chosenMode !== undefined && !isRunMode(chosenMode)) {
    console.error(`--permission-mode must be one of ${RUN_MODES.join(", ")}, not "${chosenMode}".\n${usage}`);
    process.exit(2);
  }
  runMode = chosenMode;
  const modeErrors = checkModes(spec, runMode, values.dashboard);
  if (modeErrors.length > 0) {
    console.error(`The run cannot start:\n- ${modeErrors.join("\n- ")}`);
    process.exit(2);
  }
  const workflowName = spec.name ?? basename(workflow, ".yaml");
  const context = promptBlock(specs, inputs, base);
  // storyName and story are the run's title and its first file's text, for branch names and the commit message.
  const { title: storyName, text: story } = runTitle(specs, inputs, base, workflowName);
  for (const stage of spec.stages) stage.prompt = fillPlaceholders(stage.prompt, inputs);
  const plugin = resolve(values.plugin ?? DEFAULT_PLUGIN);
  if (!existsSync(join(plugin, ".claude-plugin", "plugin.json"))) {
    console.error(`No plugin found at ${plugin}. Pass --plugin or set CORE_PLUGIN_PATH.`);
    process.exit(2);
  }
  const badNames = checkStageNames(spec.stages);
  if (badNames) {
    console.error(`The run cannot start: ${badNames}`);
    process.exit(2);
  }
  const maxRetries = spec.limits?.max_retries ?? 1;
  const handoff: Record<string, unknown> = {};

  let repo = resolve(base, inputs.repo);
  let runId = newRunId();
  let hub: HubClient | undefined;
  if (values.dashboard) {
    try {
      hub = await HubClient.register(values.hub, {
        id: values["run-id"],
        story: storyName,
        workflow: workflowName,
        harness: "ts",
        repo,
        permissionMode: runMode,
        // The review and merge step shows as a last stage on the dashboard.
        stages: [...spec.stages.map((s) => s.name), "merge"],
      });
    } catch (error) {
      console.error(String((error as Error).message ?? error));
      process.exit(2);
    }
    runId = hub.runId;
  }

  const end = async (status: "passed" | "failed", reason: string) => {
    hub?.emit({ type: "end", status, reason });
    await hub?.close();
    if (status === "failed") process.exitCode = 1;
  };

  let tree: RunTree | undefined;
  let mainTop = "";
  if (hub) {
    try {
      ({ repo, tree, mainTop } = createWorktree(repo, runId, storyName));
    } catch (error) {
      // The run is registered already, so end it on the dashboard too.
      const reason = `cannot create the worktree: ${(error as Error).message ?? error}`;
      console.error(reason);
      await end("failed", reason);
      return;
    }
    void hub.runInbox();
    console.log(`Run ${runId} on ${values.hub}`);
    process.once("SIGINT", () => {
      hub?.emit({ type: "end", status: "failed", reason: "stopped with Ctrl-C" });
      void hub?.close().finally(() => process.exit(130));
    });
  }

  /** Run one stage until its check passes, with retries, and in live mode with the person's help. */
  const runChecked = async (stage: Stage, firstFeedback?: string): Promise<Check> => {
    let check: Check = { passed: false, reason: "not run" };
    let feedback = firstFeedback;
    let attempt = 0;
    let turns = 0;
    let cost = 0;
    let stopped = false;

    while (true) {
      for (let retry = 0; retry <= maxRetries; retry++) {
        attempt++;
        hub?.emit({ type: "stage", stage: stage.name, status: "running", attempt });
        const row = hub
          ? await runStageLive(stage, context, repo, spec, plugin, handoff, hub, feedback)
          : await runStage(stage, context, repo, spec, plugin, handoff, feedback);
        turns += row.turns;
        cost += row.cost;
        stopped = row.subtype === "stopped";
        check = stopped ? { passed: false, reason: "a person stopped the run" } : await checkStage(stage, row, repo);
        appendMetrics(row, check.passed, storyName, runId);
        console.log({ ...row, passed: check.passed, reason: check.reason });
        hub?.emit({ type: "stage", stage: stage.name, status: "running", turns, cost, reason: check.reason });
        // A budget or turn limit will not go away on a retry. A person can still choose one.
        if (check.passed || stopped || row.subtype.startsWith("error_max")) break;
        feedback = check.reason;
        if (retry < maxRetries) console.log(`Check failed. Retry ${retry + 1} of ${maxRetries}.`);
      }
      if (check.passed || stopped || !hub) break;

      // Live: the retries are used up. Ask the person instead of stopping.
      hub.emit({ type: "stage", stage: stage.name, status: "waiting" });
      const reply = (await hub.ask("reply", { reason: check.reason }, stage.name)) as ReplyResponse;
      if (reply.action === "stop") {
        stopped = true;
        break;
      }
      feedback = reply.action === "reply" ? `${check.reason}\n\nA PERSON ADDS:\n${reply.text}` : check.reason;
    }

    hub?.emit({ type: "stage", stage: stage.name, status: check.passed ? "passed" : "failed" });
    // The built-in resolve stage is not part of the workflow, so later prompts do not get its result.
    if (check.passed && !stage.conflict) handoff[stage.name] = check.output;
    return { ...check, stopped };
  };

  /**
   * Live only: commit the run's changes, show them to the person, and merge, change, or
   * discard them as the person decides. Returns the reason the run ends, and whether it passed.
   */
  const reviewAndMerge = async (hub: HubClient, tree: RunTree): Promise<{ status: "passed" | "failed"; reason: string }> => {
    // Set once the story branch has a target merged in, to resolve a conflict. From then on,
    // the story branch holds that branch's history, so only that branch can be the target.
    let target: string | undefined;
    // An interview stage names the change itself. Otherwise the defaults come from the story.
    const interviewed = handoff.interview as Interview | undefined;
    let branch = defaultBranchName(interviewed?.title ?? storyName);
    let message = interviewed ? defaultCommitMessage(`# ${interviewed.title}`, storyName) : defaultCommitMessage(story, storyName);
    let note: string | undefined;
    let error: string | undefined;
    const failure = (e: unknown) => (e as Error).message ?? String(e);

    while (true) {
      const review = handoff.review as ReviewResult | undefined;
      const implement = handoff.implement as ImplementResult | undefined;
      let diff: { files: ReviewPayload["files"]; truncated: boolean };
      try {
        commitRun(tree, `wip: ${storyName} (run ${runId})`);
        if (!hasChanges(tree, target ?? tree.base)) {
          cleanup(mainTop, tree);
          hub.emit({ type: "stage", stage: "merge", status: "passed" });
          return { status: "passed", reason: "no changes to merge" };
        }
        diff = diffForReview(tree, target ? `${target}...${tree.branch}` : `${tree.base}..${tree.branch}`);
      } catch (e) {
        // Show the failure. The person can still discard, or fix the worktree by hand.
        diff = { files: [], truncated: false };
        error = [error, `Cannot read the run's changes: ${failure(e)}`].filter(Boolean).join(" ");
      }
      const payload: ReviewPayload = {
        ...diff,
        worktree: tree.top,
        branch: target ?? branch,
        branchLocked: target !== undefined,
        message,
        verdict: review?.verdict,
        findings: review?.findings,
        summary: implement?.summary,
        note,
        error,
      };
      hub.emit({ type: "stage", stage: "merge", status: "waiting" });
      const response = (await hub.ask("review", payload as unknown as Record<string, unknown>, "merge")) as ReviewResponse;
      hub.emit({ type: "stage", stage: "merge", status: "running" });
      note = error = undefined;

      try {
        if (response.action === "discard") {
          cleanup(mainTop, tree);
          hub.emit({ type: "stage", stage: "merge", status: "failed" });
          return { status: "failed", reason: "discarded by a person" };
        }

        if (response.action === "changes") {
          // The old verdict no longer applies to the new diff.
          delete handoff.review;
          const feedback = `A PERSON REVIEWED THE CHANGE AND ASKS FOR THIS:\n${response.text}`;
          for (const name of ["implement", "review"]) {
            const stage = spec.stages.find((s) => s.name === name);
            if (!stage) continue;
            const check = await runChecked(stage, name === "implement" ? feedback : undefined);
            if (check.stopped) {
              hub.emit({ type: "stage", stage: "merge", status: "failed" });
              return { status: "failed", reason: `a person stopped the run. The worktree is at ${tree.top}` };
            }
            if (!check.passed) {
              error = `The ${name} stage did not pass after your request: ${check.reason}`;
              break;
            }
          }
          continue;
        }

        const chosen = response.branch.trim();
        message = response.message.trim() || message;
        if (target !== undefined && chosen !== target) {
          error = `This run's branch now holds the history of ${target}, from resolving the conflict. Merge into ${target}, or discard the run.`;
          continue;
        }
        if (!validBranchName(tree.top, chosen)) {
          error = `"${chosen}" is not a valid branch name.`;
          continue;
        }
        branch = chosen;
        const result = squashMerge(tree, branch, message, join(RUNS, runId, "merge"));
        if (result.kind === "merged") {
          cleanup(mainTop, tree);
          hub.emit({ type: "stage", stage: "merge", status: "passed" });
          return { status: "passed", reason: `merged into ${branch} as ${result.sha}` };
        }
        if (result.kind === "refused") {
          error = result.reason;
          continue;
        }

        // Conflict: merge the target into the story branch, and let the model fix it.
        let files: string[];
        try {
          files = startResolveMerge(tree, branch);
        } catch (e) {
          abortResolveMerge(tree);
          throw e;
        }
        if (files.length > 0) {
          const check = await runChecked(resolveStage(branch, tree.top, files));
          if (check.stopped) {
            abortResolveMerge(tree);
            hub.emit({ type: "stage", stage: "merge", status: "failed" });
            return { status: "failed", reason: `a person stopped the run. The worktree is at ${tree.top}` };
          }
          if (!check.passed) {
            abortResolveMerge(tree);
            error = `Merging into ${branch} conflicted in ${files.join(", ")}, and the resolve stage did not pass: ${check.reason}`;
            continue;
          }
          try {
            finishResolveMerge(tree);
          } catch (e) {
            abortResolveMerge(tree);
            throw e;
          }
          const summary = (check.output as ResolveResult | undefined)?.summary ?? "";
          note = `Merging into ${branch} conflicted in ${files.join(", ")}. The model resolved it: ${summary} This diff is against ${branch}.`;
        } else {
          note = `${branch} changed since this run started. It is now merged into the story branch, and this diff is against ${branch}.`;
        }
        target = branch;
      } catch (e) {
        // A git failure must not end the run. Show it, and let the person decide again.
        error = `The last action failed: ${failure(e)}`;
      }
    }
  };

  try {
    for (const stage of spec.stages) {
      const check = await runChecked(stage);
      if (!check.passed) {
        console.log(`Stage ${stage.name} failed its check. Stopping.`);
        await end("failed", `${stage.name}: ${check.reason}`);
        return;
      }
    }
    if (hub && tree) {
      // The person reads the review stage's verdict in the dashboard and decides.
      const outcome = await reviewAndMerge(hub, tree);
      console.log(`Run ${outcome.status}: ${outcome.reason}`);
      await end(outcome.status, outcome.reason);
      return;
    }
    const review = handoff.review as ReviewResult | undefined;
    if (review?.verdict === "request_changes") {
      console.log("Review requested changes:", review.findings);
      await end("failed", "the review requested changes");
      return;
    }
    await end("passed", "all stages passed");
  } catch (error) {
    await end("failed", String(error));
    throw error;
  }
}

await main();
