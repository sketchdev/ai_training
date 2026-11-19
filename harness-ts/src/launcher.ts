/**
 * Starting runs from the dashboard. The hub lists the workflow files of each harness, builds
 * a form from their inputs, and starts the orchestrator as its own process.
 *
 * A launched run is a separate process with its output in runs/hub/<run id>.log. It keeps
 * going if the hub stops, and reconnects when the hub starts again, like a run started from
 * a terminal. The orchestrator gets the run id with --run-id, and takes over the entry that
 * the hub made at launch.
 */
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";

import { type Hub, newRunId } from "./hub.ts";
import type { InputField, LaunchRequest, WorkflowListing } from "./hubTypes.ts";
import { checkSpecs, checkStageNames, type InputSpecs, isRequired, LEGACY_INPUTS, optionsFor, runTitle, validateInputs } from "./inputs.ts";
import { checkModes, isRunMode, RUN_MODES, type RunMode } from "./permissions.ts";

export type Harness = "ts" | "python";
export type HarnessDirs = Partial<Record<Harness, string>>;
type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

interface WorkflowFile {
  name?: string;
  inputs?: InputSpecs;
  permission_mode?: string;
  requires_dashboard?: boolean;
  stages?: { name: string; permission_mode?: string }[];
}

/** The workflow files in <harness>/workflows, with the form fields for their inputs. */
export function listWorkflows(dirs: HarnessDirs): WorkflowListing[] {
  return readWorkflows(dirs).map((w) => w.listing);
}

/** Each workflow file's listing, with the parsed file, so a launch reads each file once. */
function readWorkflows(dirs: HarnessDirs): { listing: WorkflowListing; spec?: WorkflowFile }[] {
  const listings: { listing: WorkflowListing; spec?: WorkflowFile }[] = [];
  for (const [harness, dir] of Object.entries(dirs) as [Harness, string][]) {
    const folder = join(dir, "workflows");
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).filter((f) => /\.ya?ml$/.test(f)).sort()) {
      const file = `workflows/${name}`;
      try {
        const spec = parse(readFileSync(join(dir, file), "utf8")) as WorkflowFile;
        const specs = spec.inputs ?? LEGACY_INPUTS;
        // A launched run always has the dashboard, so only the file's own modes can be wrong here.
        const errors = [
          ...checkSpecs(specs),
          ...checkModes({ ...spec, stages: spec.stages ?? [] }, undefined, true),
          ...[checkStageNames(spec.stages ?? [])].filter((e) => e !== undefined),
        ];
        const inputs: InputField[] = Object.entries(specs).map(([input, s]) => ({
          name: input,
          kind: s.kind,
          description: s.description,
          default: s.default,
          required: isRequired(input, s),
          options: optionsFor(s, dir),
        }));
        listings.push({
          spec,
          listing: {
            harness,
            file,
            name: spec.name ?? name.replace(/\.ya?ml$/, ""),
            inputs,
            permissionMode: spec.permission_mode,
            requiresDashboard: spec.requires_dashboard,
            error: errors.join("; ") || undefined,
          },
        });
      } catch (error) {
        listings.push({ listing: { harness, file, name, inputs: [], error: `cannot read: ${(error as Error).message}` } });
      }
    }
  }
  return listings;
}

/** The command that starts the orchestrator of a harness. */
export function launchCommand(
  harness: Harness,
  dir: string,
  workflow: string,
  inputs: Record<string, string>,
  hubUrl: string,
  runId: string,
  mode?: RunMode,
): { command: string; args: string[] } {
  const flags = [
    workflow,
    "--dashboard",
    "--hub",
    hubUrl,
    "--run-id",
    runId,
    ...(mode ? ["--permission-mode", mode] : []),
    ...Object.entries(inputs).flatMap(([name, value]) => ["--input", `${name}=${value}`]),
  ];
  if (harness === "ts") {
    // The same as npm run run-story, without npm in between.
    return { command: process.execPath, args: ["--import", "tsx", "src/orchestrator.ts", ...flags] };
  }
  const venv = join(dir, ".venv", "bin", "python");
  return { command: existsSync(venv) ? venv : "python3", args: ["-m", "harness.orchestrator", ...flags] };
}

/** The end of a log file, to show why a launch failed. */
function tail(path: string, size = 1500): string {
  try {
    const text = readFileSync(path, "utf8");
    return text.length > size ? `…${text.slice(-size)}` : text;
  } catch {
    return "";
  }
}

export class Launcher {
  constructor(
    private readonly hub: Hub,
    private readonly dirs: HarnessDirs,
    private readonly hubUrl: string,
    private readonly logDir: string,
    private readonly spawn: Spawn = nodeSpawn,
  ) {}

  workflows(): WorkflowListing[] {
    return listWorkflows(this.dirs);
  }

  /** Start a run. Returns its id, or the reasons it cannot start. */
  launch(request: LaunchRequest): { id: string } | { errors: string[] } {
    const dir = this.dirs[request.harness];
    if (!dir) return { errors: [`the ${request.harness} harness is not available`] };
    // Only the chosen harness's files: the other harness has nothing to do with this launch.
    const found = readWorkflows({ [request.harness]: dir }).find((w) => w.listing.file === request.workflow);
    if (!found) return { errors: [`no workflow ${request.workflow} in the ${request.harness} harness`] };
    const { listing, spec } = found;
    if (listing.error || !spec) return { errors: [listing.error ?? "cannot read the workflow"] };

    const specs = spec.inputs ?? LEGACY_INPUTS;
    // Strict: a file input must be one of the files the form offered.
    const { values, errors } = validateInputs(specs, request.inputs ?? {}, dir, true);
    const mode = request.permissionMode || undefined;
    if (mode !== undefined && !isRunMode(mode)) errors.push(`permission mode "${mode}" is not one of ${RUN_MODES.join(", ")}`);
    else errors.push(...checkModes({ ...spec, stages: spec.stages ?? [] }, mode, true));
    if (errors.length > 0) return { errors };

    const id = newRunId();
    const log = join(this.logDir, `${id}.log`);
    const { title } = runTitle(specs, values, dir, listing.name, false);
    const run = this.hub.launchRun(
      {
        story: title,
        workflow: listing.name,
        harness: request.harness,
        repo: resolve(dir, values.repo),
        stages: [...(spec.stages ?? []).map((s) => s.name), "merge"],
        permissionMode: mode,
      },
      log,
      id,
    );

    const { command, args } = launchCommand(request.harness, dir, listing.file, values, this.hubUrl, id, mode as RunMode | undefined);
    const out = openSync(log, "a");
    let child: ChildProcess;
    try {
      // detached: the run keeps going if the hub stops. The hub's environment, with the SDK
      // credentials, goes to the run.
      child = this.spawn(command, args, { cwd: dir, detached: true, stdio: ["ignore", out, out], env: process.env });
    } catch (error) {
      closeSync(out);
      this.hub.apply(id, { type: "end", status: "failed", reason: `cannot start the orchestrator: ${(error as Error).message}` });
      return { id };
    }
    closeSync(out);
    if (run.launch) run.launch.pid = child.pid;
    child.on("error", (error) => this.ended(id, `cannot start the orchestrator: ${error.message}`));
    child.on("exit", (code, signal) => this.ended(id, `the orchestrator exited with ${signal ?? `code ${code}`}`));
    child.unref();
    return { id };
  }

  /** The process ended. If the run did not say how it ended, show the end of its output. */
  private ended(id: string, how: string): void {
    const run = this.hub.runs.get(id);
    if (!run || run.status === "passed" || run.status === "failed") return;
    const output = run.launch ? tail(run.launch.log) : "";
    this.hub.apply(id, { type: "end", status: "failed", reason: `${how} before it finished.${output ? `\n${output}` : ""}` });
  }
}

/** The harness folders next to this one. A missing harness is left out. */
export function harnessDirs(tsDir: string): HarnessDirs {
  const python = resolve(tsDir, "..", "harness-python");
  return { ts: tsDir, ...(existsSync(python) && statSync(python).isDirectory() ? { python } : {}) };
}
