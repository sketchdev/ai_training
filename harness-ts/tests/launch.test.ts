import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { Hub } from "../src/hub.ts";
import {
  checkSpecs,
  fillPlaceholders,
  type InputSpecs,
  listFiles,
  parseInputFlags,
  promptBlock,
  runTitle,
  validateInputs,
} from "../src/inputs.ts";
import { launchCommand, Launcher, listWorkflows } from "../src/launcher.ts";

const SPECS: InputSpecs = {
  story: { kind: "file", from: "stories/*.md" },
  repo: { kind: "path", default: "repo" },
  tone: { kind: "choice", options: ["short", "long"], default: "short" },
  note: { kind: "text", required: false },
};

let dir: string;

/** A harness folder with two stories, a repo folder, and one workflow. */
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "launch-test-"));
  mkdirSync(join(dir, "stories"));
  mkdirSync(join(dir, "repo"));
  mkdirSync(join(dir, "workflows"));
  writeFileSync(join(dir, "stories", "story-1-list-games.md"), "# Story 1: List games\n");
  writeFileSync(join(dir, "stories", "story-2-delete.md"), "# Story 2: Delete\n");
  writeFileSync(join(dir, "secret.md"), "not a story\n");
  writeFileSync(
    join(dir, "workflows", "story-to-pr.yaml"),
    "name: story-to-pr\ninputs:\n  story:\n    kind: file\n    from: stories/*.md\n  repo:\n    kind: path\n    default: repo\n" +
      "stages:\n  - name: plan\n    prompt: Plan {story}.\n",
  );
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("an inputs section needs a repo path, known kinds, and options for a choice", () => {
  assert.deepEqual(checkSpecs(SPECS), []);
  assert.equal(checkSpecs({ story: { kind: "file" } }).length, 1);
  assert.equal(checkSpecs({ repo: { kind: "path" }, x: { kind: "choice" } }).length, 1);
  assert.equal(checkSpecs({ repo: { kind: "path" }, y: { kind: "nope" as "text" } }).length, 1);
});

test("a file pattern lists matching files only", () => {
  assert.deepEqual(listFiles(dir, "stories/*.md"), ["stories/story-1-list-games.md", "stories/story-2-delete.md"]);
  assert.deepEqual(listFiles(dir, "missing/*.md"), []);
});

test("validation applies defaults and reports each problem", () => {
  const ok = validateInputs(SPECS, { story: "stories/story-1-list-games.md" }, dir);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.values, { story: "stories/story-1-list-games.md", repo: "repo", tone: "short" });

  const bad = validateInputs(SPECS, { story: "stories/none.md", tone: "loud", extra: "x" }, dir);
  assert.equal(bad.errors.length, 3);
  assert.equal(validateInputs(SPECS, {}, dir).errors.length, 1); // story is required
});

test("the repo input is required even if the workflow marks it optional", () => {
  assert.deepEqual(validateInputs({ repo: { kind: "path", required: false } }, {}, dir).errors, ['"repo" is required']);
});

test("a workflow that uses a reserved stage name is listed with an error and does not launch", () => {
  writeFileSync(
    join(dir, "workflows", "reserved.yaml"),
    "name: reserved\ninputs:\n  repo:\n    kind: path\n    default: repo\nstages:\n  - name: merge\n    prompt: Merge.\n",
  );
  assert.match(listWorkflows({ ts: dir }).find((w) => w.name === "reserved")?.error ?? "", /reserves: merge/);
  const hub = new Hub();
  const { calls, spawn } = fakeSpawn();
  const launcher = new Launcher(hub, { ts: dir }, "http://127.0.0.1:1", dir, spawn);
  assert.ok("errors" in launcher.launch({ harness: "ts", workflow: "workflows/reserved.yaml", inputs: {} }));
  assert.equal(calls.length, 0);
});

test("strict validation allows only the files that the pattern offers", () => {
  assert.deepEqual(validateInputs(SPECS, { story: "secret.md" }, dir).errors, []);
  assert.equal(validateInputs(SPECS, { story: "secret.md" }, dir, true).errors.length, 1);
  assert.equal(validateInputs(SPECS, { story: "stories/../secret.md" }, dir, true).errors.length, 1);
});

test("inputs become prompt sections, placeholders, and a run title", () => {
  const values = { story: "stories/story-1-list-games.md", repo: "repo", tone: "short" };
  assert.equal(promptBlock(SPECS, values, dir), "STORY:\n# Story 1: List games\n\n\nTONE:\nshort");
  assert.equal(fillPlaceholders("Plan {story} in {tone} form, not {other} or {\"json\": 1}.", values),
    "Plan stories/story-1-list-games.md in short form, not {other} or {\"json\": 1}.");
  assert.deepEqual(runTitle(SPECS, values, dir, "wf"), { title: "story-1-list-games", text: "# Story 1: List games\n" });
  assert.equal(runTitle({ repo: { kind: "path" } }, { repo: "repo" }, dir, "My Workflow").title, "my-workflow");
  const asked = { request: { kind: "text" as const }, repo: { kind: "path" as const } };
  assert.equal(runTitle(asked, { request: "Add a  game history page, with paging and filters", repo: "repo" }, dir, "wf").title,
    "add-a-game-history-page-with");
});

test("--input flags split at the first =", () => {
  assert.deepEqual(parseInputFlags(["a=1", "b=x=y"]), { a: "1", b: "x=y" });
  assert.throws(() => parseInputFlags(["novalue"]));
});

test("the workflow list shows each input with its options", () => {
  const [listing] = listWorkflows({ ts: dir });
  assert.equal(listing.name, "story-to-pr");
  assert.equal(listing.error, undefined);
  const story = listing.inputs.find((i) => i.name === "story");
  assert.deepEqual(story?.options, ["stories/story-1-list-games.md", "stories/story-2-delete.md"]);
  assert.equal(story?.required, true);
  assert.equal(listing.inputs.find((i) => i.name === "repo")?.required, true); // always, even with a default
});

test("the command passes each input, the hub, and the run id", () => {
  const ts = launchCommand("ts", dir, "workflows/w.yaml", { story: "s.md" }, "http://127.0.0.1:1", "r1");
  assert.equal(ts.command, process.execPath);
  assert.deepEqual(ts.args.slice(0, 3), ["--import", "tsx", "src/orchestrator.ts"]);
  assert.ok(ts.args.join(" ").includes("--run-id r1 --input story=s.md"));
  const py = launchCommand("python", dir, "workflows/w.yaml", {}, "http://127.0.0.1:1", "r1");
  assert.deepEqual(py.args.slice(0, 2), ["-m", "harness.orchestrator"]);
});

/** A spawn that records its call and returns a process that the test can end. */
function fakeSpawn() {
  const calls: { command: string; args: string[]; cwd?: string }[] = [];
  const child = Object.assign(new EventEmitter(), { pid: 4242, unref() {} });
  const spawn = ((command: string, args: string[], options: { cwd?: string }) => {
    calls.push({ command, args, cwd: options.cwd });
    return child;
  }) as never;
  return { calls, child, spawn };
}

test("a launch makes a starting run, which its orchestrator then takes over", () => {
  const hub = new Hub();
  const { calls, spawn } = fakeSpawn();
  const launcher = new Launcher(hub, { ts: dir }, "http://127.0.0.1:1", dir, spawn);
  const result = launcher.launch({ harness: "ts", workflow: "workflows/story-to-pr.yaml", inputs: { story: "stories/story-2-delete.md" } });
  assert.ok("id" in result);
  const run = hub.runs.get(result.id)!;
  assert.equal(run.status, "starting");
  assert.equal(run.story, "story-2-delete");
  assert.deepEqual(run.stages.map((s) => s.name), ["plan", "merge"]);
  assert.equal(calls[0].cwd, dir);
  assert.ok(calls[0].args.includes(`--run-id`));

  assert.equal(hub.attach(result.id, ["plan", "merge"]), true);
  assert.equal(run.status, "running");
  assert.equal(hub.attach(result.id, ["plan", "merge"]), false); // only once
});

test("a launch with a bad input starts nothing", () => {
  const hub = new Hub();
  const { calls, spawn } = fakeSpawn();
  const launcher = new Launcher(hub, { ts: dir }, "http://127.0.0.1:1", dir, spawn);
  const result = launcher.launch({ harness: "ts", workflow: "workflows/story-to-pr.yaml", inputs: { story: "secret.md" } });
  assert.ok("errors" in result);
  assert.equal(calls.length, 0);
  assert.equal(hub.runs.size, 0);
  assert.ok("errors" in launcher.launch({ harness: "python", workflow: "workflows/story-to-pr.yaml", inputs: {} }));
});

test("a process that exits without ending its run marks the run failed with its output", () => {
  const hub = new Hub();
  const { child, spawn } = fakeSpawn();
  const launcher = new Launcher(hub, { ts: dir }, "http://127.0.0.1:1", dir, spawn);
  const result = launcher.launch({ harness: "ts", workflow: "workflows/story-to-pr.yaml", inputs: { story: "stories/story-1-list-games.md" } });
  assert.ok("id" in result);
  writeFileSync(join(dir, `${result.id}.log`), "ModuleNotFoundError: No module named 'claude_agent_sdk'\n");
  child.emit("exit", 1, null);
  const run = hub.runs.get(result.id)!;
  assert.equal(run.status, "failed");
});

test("a launched run survives a hub restart through replay", () => {
  const log: string[] = [];
  const first = new Hub((entry) => log.push(JSON.stringify(entry)));
  first.launchRun({ story: "s", workflow: "w", harness: "ts", repo: "/r", stages: ["plan"] }, "/l.log", "r1", 1);
  first.attach("r1", ["plan", "merge"], 2);
  const second = new Hub();
  second.replay(log);
  const run = second.runs.get("r1")!;
  assert.equal(run.status, "running");
  assert.equal(run.launch?.attached, true);
  assert.deepEqual(run.stages.map((s) => s.name), ["plan", "merge"]);
});

test("a launch passes a chosen permission mode, and refuses an unknown one or dontAsk for an interview", () => {
  writeFileSync(
    join(dir, "workflows", "interview.yaml"),
    "name: interview\nrequires_dashboard: true\ninputs:\n  request:\n    kind: text\n  repo:\n    kind: path\n    default: repo\n" +
      "stages:\n  - name: interview\n    prompt: Ask.\n",
  );
  const hub = new Hub();
  const { calls, spawn } = fakeSpawn();
  const launcher = new Launcher(hub, { ts: dir }, "http://127.0.0.1:1", dir, spawn);
  const inputs = { request: "Add paging" };
  const ok = launcher.launch({ harness: "ts", workflow: "workflows/interview.yaml", inputs, permissionMode: "acceptEdits" });
  assert.ok("id" in ok);
  assert.equal(hub.runs.get(ok.id)?.permissionMode, "acceptEdits");
  assert.ok(calls[0].args.join(" ").includes("--permission-mode acceptEdits"));
  assert.ok("errors" in launcher.launch({ harness: "ts", workflow: "workflows/interview.yaml", inputs, permissionMode: "plan" }));
  assert.ok("errors" in launcher.launch({ harness: "ts", workflow: "workflows/interview.yaml", inputs, permissionMode: "dontAsk" }));
  assert.equal(calls.length, 1);
  assert.equal(listWorkflows({ ts: dir }).find((w) => w.name === "interview")?.requiresDashboard, true);
});
