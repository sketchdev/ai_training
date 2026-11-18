/**
 * Starter orchestrator: load a workflow file, run each stage, log the result.
 *
 * Run:  npm run run-story -- workflows/story-to-pr.yaml stories/story-1-list-games.md --repo ../battleship
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
import { execFile, execFileSync } from "node:child_process";
import { query, type CanUseTool, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { parse } from "yaml";
import { z } from "zod";

import { makePreToolUseHook } from "./guardrails.ts";
import { newRunId } from "./hub.ts";
import { HubClient, InputQueue, summarize, TurnTracker } from "./hubClient.ts";
import type { PermissionResponse, QuestionResponse, ReplyResponse } from "./hubTypes.ts";
import { ImplementResult, Plan, ReviewResult } from "./schemas.ts";

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
};

// Added to each prompt when a person is on the dashboard.
const ASK_LINE = "If you need a decision from a person, use the AskUserQuestion tool. A person reads it on the dashboard.";

interface Stage {
  name: string;
  allowed_tools: string[];
  prompt: string;
}

interface Spec {
  name?: string;
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

function buildOptions(stage: Stage, repo: string, spec: Spec, plugin: string): Options {
  const schema = SCHEMAS[stage.name];
  const limits = spec.limits ?? {};
  return {
    cwd: repo,
    allowedTools: stage.allowed_tools,
    permissionMode: "dontAsk",
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
    ...(schema && { outputFormat: { type: "json_schema", schema: z.toJSONSchema(schema) } }),
  };
}

function buildPrompt(stage: Stage, story: string, handoff: Record<string, unknown>, feedback?: string): string {
  let prompt = `${stage.prompt}\n\nSTORY:\n${story}`;
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
  story: string,
  repo: string,
  spec: Spec,
  plugin: string,
  handoff: Record<string, unknown>,
  feedback?: string,
): Promise<Row> {
  const options = buildOptions(stage, repo, spec, plugin);
  const prompt = buildPrompt(stage, story, handoff, feedback);
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
  story: string,
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

  const options: Options = { ...buildOptions(stage, repo, spec, plugin), permissionMode: "default", canUseTool };
  const hasSchema = stage.name in SCHEMAS;
  const input = new InputQueue();
  const turns = new TurnTracker();
  const send = (text: string) => turns.sent(input.push(text));
  send(`${buildPrompt(stage, story, handoff, feedback)}\n\n${ASK_LINE}`);
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
}

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
  switch (stage.name) {
    case "plan":
      // The schema requires at least one file and one test.
      return { passed: true, reason: "plan lists at least one file and one test", output };
    case "implement":
      // Do not trust the agent's own report. Run the build here. It runs without blocking,
      // so the dashboard connection keeps working during a long build.
      try {
        await execFileAsync("./mvnw", ["verify", "-q"], { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
        return { passed: true, reason: "./mvnw verify passes", output };
      } catch (error) {
        const out = (error as { stdout?: Buffer }).stdout?.toString().slice(-2000) ?? "";
        return { passed: false, reason: `./mvnw verify fails:\n${out}`, output };
      }
    case "review":
      // The schema allows only "approve" or "request_changes".
      return { passed: true, reason: `verdict is ${(output as ReviewResult).verdict}`, output };
    default:
      return { passed: true, reason: "result matches the schema", output };
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

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/**
 * Check out the repository again at runs/<run id>/repo, on a new branch, so that parallel
 * runs do not change each other's files. Returns the folder that matches `repo` in it.
 */
function createWorktree(repo: string, runId: string, storyName: string): string {
  const top = git(repo, ["rev-parse", "--show-toplevel"]);
  const prefix = git(repo, ["rev-parse", "--show-prefix"]);
  const dirty = git(top, ["status", "--porcelain", "--", prefix || "."]);
  if (dirty) {
    console.warn(`These files are not committed, so the worktree does not have them:\n${dirty}`);
  }
  const path = join(RUNS, runId, "repo");
  const branch = `story/${storyName}-${runId}`;
  git(top, ["worktree", "add", "-b", branch, path, "HEAD"]);
  console.log(`Worktree ${path} on branch ${branch}`);
  return join(path, prefix);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      repo: { type: "string" },
      plugin: { type: "string" },
      dashboard: { type: "boolean", default: false },
      hub: { type: "string", default: DEFAULT_HUB },
    },
  });
  const [workflow, storyPath] = positionals;
  if (!workflow || !storyPath || !values.repo) {
    console.error(
      "Usage: orchestrator <workflow.yaml> <story.md> --repo <path to Battleship repository> " +
        "[--plugin <path to plugin>] [--dashboard [--hub <url>]]",
    );
    process.exit(2);
  }

  mkdirSync(RUNS, { recursive: true });
  const spec = parse(readFileSync(workflow, "utf8")) as Spec;
  const story = readFileSync(storyPath, "utf8");
  const storyName = basename(storyPath, ".md");
  const plugin = resolve(values.plugin ?? DEFAULT_PLUGIN);
  if (!existsSync(join(plugin, ".claude-plugin", "plugin.json"))) {
    console.error(`No plugin found at ${plugin}. Pass --plugin or set CORE_PLUGIN_PATH.`);
    process.exit(2);
  }
  const maxRetries = spec.limits?.max_retries ?? 1;
  const handoff: Record<string, unknown> = {};

  let repo = resolve(values.repo);
  let runId = newRunId();
  let hub: HubClient | undefined;
  if (values.dashboard) {
    try {
      hub = await HubClient.register(values.hub, {
        story: storyName,
        workflow: spec.name ?? basename(workflow, ".yaml"),
        harness: "ts",
        repo,
        stages: spec.stages.map((s) => s.name),
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

  if (hub) {
    try {
      repo = createWorktree(repo, runId, storyName);
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

  try {
    for (const stage of spec.stages) {
      let check: Check = { passed: false, reason: "not run" };
      let feedback: string | undefined;
      let attempt = 0;
      let turns = 0;
      let cost = 0;
      let stopped = false;

      while (true) {
        for (let retry = 0; retry <= maxRetries; retry++) {
          attempt++;
          hub?.emit({ type: "stage", stage: stage.name, status: "running", attempt });
          const row = hub
            ? await runStageLive(stage, story, repo, spec, plugin, handoff, hub, feedback)
            : await runStage(stage, story, repo, spec, plugin, handoff, feedback);
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

      if (!check.passed) {
        hub?.emit({ type: "stage", stage: stage.name, status: "failed" });
        console.log(`Stage ${stage.name} failed its check. Stopping.`);
        await end("failed", `${stage.name}: ${check.reason}`);
        return;
      }
      hub?.emit({ type: "stage", stage: stage.name, status: "passed" });
      handoff[stage.name] = check.output;
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
