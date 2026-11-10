/**
 * Starter orchestrator: load a workflow file, run each stage, log the result.
 *
 * Run:  npm run run-story -- workflows/story-to-pr.yaml stories/story-1-list-games.md --repo ../battleship
 *
 * Check option names against the Agent SDK version that you install. Where this file
 * says TODO, the lab asks you to add code.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parse } from "yaml";

import { makePreToolUseHook } from "./guardrails.ts";

const RUNS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "runs");

interface Stage {
  name: string;
  allowed_tools: string[];
  prompt: string;
}

interface Spec {
  protected_paths?: string[];
  limits?: { max_turns?: number; max_budget_usd?: number };
  stages: Stage[];
}

interface Row {
  stage: string;
  subtype: string;
  turns: number;
  cost: number;
  session_id: string;
}

async function runStage(stage: Stage, story: string, repo: string, spec: Spec): Promise<Row> {
  const limits = spec.limits ?? {};
  const options = {
    cwd: repo,
    allowedTools: stage.allowed_tools,
    permissionMode: "dontAsk" as const,
    maxTurns: limits.max_turns,
    maxBudgetUsd: limits.max_budget_usd,
    settingSources: ["project" as const],
    hooks: {
      PreToolUse: [
        {
          matcher: "Edit|Write|Bash",
          hooks: [makePreToolUseHook(spec.protected_paths ?? [])],
        },
      ],
    },
    // TODO (lab step 2): load plugin v1:
    // plugins: [{ type: "local" as const, path: "../team-plugin" }],
    // TODO (lab step 4): add outputFormat with a JSON Schema from src/schemas.ts
  };
  const prompt = `${stage.prompt}\n\nSTORY:\n${story}`;
  const log = join(RUNS, `${Math.floor(Date.now() / 1000)}-${stage.name}.jsonl`);
  writeFileSync(log, "");

  let row: Row = { stage: stage.name, subtype: "no_result", turns: 0, cost: 0, session_id: "" };
  for await (const message of query({ prompt, options })) {
    appendFileSync(log, JSON.stringify(message) + "\n");
    if (message.type === "result") {
      row = {
        stage: stage.name,
        subtype: message.subtype,
        turns: message.num_turns,
        cost: message.total_cost_usd,
        session_id: message.session_id,
      };
    }
  }
  return row;
}

function appendMetrics(row: Row, storyName: string): void {
  const path = join(RUNS, "metrics.csv");
  if (!existsSync(path)) {
    writeFileSync(path, "story,stage,subtype,passed,turns,cost,session_id\n");
  }
  // `passed` starts as "the stage succeeded". Lab step 4 replaces it with the stage's `check`.
  const passed = row.subtype === "success";
  const cells = [storyName, row.stage, row.subtype, passed, row.turns, row.cost, row.session_id];
  appendFileSync(path, cells.join(",") + "\n");
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { repo: { type: "string" } },
  });
  const [workflow, storyPath] = positionals;
  if (!workflow || !storyPath || !values.repo) {
    console.error("Usage: orchestrator <workflow.yaml> <story.md> --repo <path to Battleship repository>");
    process.exit(2);
  }

  mkdirSync(RUNS, { recursive: true });
  const spec = parse(readFileSync(workflow, "utf8")) as Spec;
  const story = readFileSync(storyPath, "utf8");
  const storyName = basename(storyPath, ".md");

  for (const stage of spec.stages) {
    const row = await runStage(stage, story, resolve(values.repo), spec);
    appendMetrics(row, storyName);
    console.log(row);
    // TODO (lab step 4): parse structured output, check the stage's `check`, and stop or retry.
    if (row.subtype !== "success") {
      console.log("Stage did not succeed. Stopping.");
      break;
    }
  }
}

await main();
