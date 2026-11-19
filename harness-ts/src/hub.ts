/**
 * The dashboard hub: one process that collects the state of every orchestrator run and
 * serves the dashboard page.
 *
 * Run:  npm run hub              (then open http://127.0.0.1:4321)
 *       npm run hub -- --port 5000
 *
 * Orchestrators (TypeScript or Python) register with POST /api/runs, send events with
 * POST /api/runs/:id/events, and read the person's input from GET /api/runs/:id/inbox.
 * The page reads GET /api/stream and posts answers, messages, and interrupts.
 *
 * The hub listens on 127.0.0.1 only. Anyone who can reach it can allow tool calls.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type { LaunchRequest, RunEvent, RunInfo, RunInput, RunState } from "./hubTypes.ts";
import { harnessDirs, Launcher } from "./launcher.ts";
import { MODE_HELP, RUN_MODES } from "./permissions.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = resolve(HERE, "..", "..", "dashboard", "index.html");
const LOG_DIR = resolve(HERE, "..", "runs", "hub");

/** A run that sends nothing for this long, with no open inbox, is marked lost. */
export const LOST_AFTER_MS = 60_000;
/**
 * A launched run that has not connected yet gets longer, because a first start can be slow
 * (tsx, Python imports). While the hub runs, the launcher sees a process that exits early.
 */
export const STARTING_LOST_AFTER_MS = 10 * 60_000;
/** The snapshot sends at most this many transcript entries per run. */
const SNAPSHOT_EVENTS = 300;

type StoredEvent =
  | RunEvent
  | { type: "register"; info: RunInfo; started: number }
  | { type: "launch"; info: RunInfo; started: number; log: string }
  | { type: "attach"; stages: string[] }
  | { type: "lost" };

export interface LogEntry {
  runId: string;
  at: number;
  event: StoredEvent;
}

export type PageMessage =
  | { type: "snapshot"; runs: { run: RunState; events: LogEntry[] }[] }
  | { type: "update"; run: RunState; entry?: LogEntry };

export function isLost(run: RunState, now: number, inboxConnected: boolean): boolean {
  if (run.status !== "running" && run.status !== "waiting" && run.status !== "starting") return false;
  const limit = run.status === "starting" ? STARTING_LOST_AFTER_MS : LOST_AFTER_MS;
  return !inboxConnected && now - run.lastSeen > limit;
}

export function newRunId(now = Date.now()): string {
  return `r${now.toString(36)}${Math.floor(Math.random() * 36 ** 3).toString(36).padStart(3, "0")}`;
}

/** The state of all runs. It has no network code, so tests can drive it directly. */
export class Hub {
  readonly runs = new Map<string, RunState>();
  private readonly transcripts = new Map<string, LogEntry[]>();
  private readonly inboxQueues = new Map<string, RunInput[]>();
  private readonly inboxes = new Map<string, Set<(input: RunInput) => void>>();
  private readonly pageListeners = new Set<(message: PageMessage) => void>();
  private replaying = false;

  constructor(private readonly persist: (entry: LogEntry) => void = () => {}) {}

  register(info: RunInfo, id = newRunId(), started = Date.now()): RunState {
    const run = this.newRun(info, id, started);
    this.runs.set(id, run);
    this.transcripts.set(id, []);
    this.record({ runId: id, at: started, event: { type: "register", info, started } }, run);
    return run;
  }

  /** A run that the hub launches. It shows as "starting" until its orchestrator connects. */
  launchRun(info: RunInfo, log: string, id = newRunId(), started = Date.now()): RunState {
    const run = this.newRun(info, id, started);
    run.status = "starting";
    run.launch = { log, attached: false };
    this.runs.set(id, run);
    this.transcripts.set(id, []);
    this.record({ runId: id, at: started, event: { type: "launch", info, started, log } }, run);
    return run;
  }

  /**
   * The orchestrator of a launched run connects, and takes over the entry that the hub made.
   * Returns false if there is no launched run with that id waiting to be taken over.
   */
  attach(runId: string, stages: string[], at = Date.now()): boolean {
    const run = this.runs.get(runId);
    if (!run?.launch || run.launch.attached || run.status === "passed" || run.status === "failed") return false;
    run.launch.attached = true;
    run.stages = stages.map((name) => run.stages.find((s) => s.name === name) ?? { name, status: "pending", attempt: 0, turns: 0, cost: 0 });
    run.status = "running";
    run.lastSeen = at;
    this.refreshStatus(run);
    this.record({ runId, at, event: { type: "attach", stages } }, run);
    return true;
  }

  private newRun(info: RunInfo, id: string, started: number): RunState {
    return {
      id,
      story: info.story,
      workflow: info.workflow,
      harness: info.harness,
      repo: info.repo,
      permissionMode: info.permissionMode,
      status: "running",
      started,
      lastSeen: started,
      stages: info.stages.map((name) => ({ name, status: "pending", attempt: 0, turns: 0, cost: 0 })),
      pending: [],
    };
  }

  /** Apply one event from an orchestrator. Returns false if the run is unknown. */
  apply(runId: string, event: RunEvent, at = Date.now()): boolean {
    const run = this.runs.get(runId);
    if (!run) return false;
    run.lastSeen = Math.max(run.lastSeen, at);
    switch (event.type) {
      case "stage": {
        let stage = run.stages.find((s) => s.name === event.stage);
        if (!stage) {
          // A stage that the workflow file does not list, such as the built-in resolve stage.
          stage = { name: event.stage, status: "pending", attempt: 0, turns: 0, cost: 0 };
          const merge = run.stages.findIndex((s) => s.name === "merge");
          run.stages.splice(merge >= 0 ? merge : run.stages.length, 0, stage);
        }
        stage.status = event.status;
        if (event.attempt !== undefined) stage.attempt = event.attempt;
        // Turns and cost are the stage's totals so far, not increments.
        if (event.turns !== undefined) stage.turns = event.turns;
        if (event.cost !== undefined) stage.cost = event.cost;
        break;
      }
      case "pending":
        if (!run.pending.some((p) => p.id === event.request.id)) run.pending.push(event.request);
        break;
      case "resolved":
        run.pending = run.pending.filter((p) => p.id !== event.requestId);
        break;
      case "end":
        run.status = event.status;
        run.pending = [];
        break;
      case "message":
        break;
    }
    this.refreshStatus(run);
    this.record({ runId, at, event }, run);
    return true;
  }

  /** The page answers a pending request. The hub resolves it and forwards it to the run. */
  answer(runId: string, requestId: string, response: unknown): "ok" | "unknown_run" | "not_pending" {
    const run = this.runs.get(runId);
    if (!run) return "unknown_run";
    if (!run.pending.some((p) => p.id === requestId)) return "not_pending";
    this.apply(runId, { type: "resolved", requestId, response });
    this.sendInput(runId, { type: "answer", requestId, response });
    return "ok";
  }

  /** Deliver an input to the run's inbox, or keep it until the run connects. */
  sendInput(runId: string, input: RunInput): boolean {
    if (!this.runs.has(runId)) return false;
    const listeners = this.inboxes.get(runId);
    if (listeners && listeners.size > 0) {
      for (const listener of listeners) listener(input);
    } else {
      const queue = this.inboxQueues.get(runId) ?? [];
      queue.push(input);
      this.inboxQueues.set(runId, queue);
    }
    return true;
  }

  /** An orchestrator opens its inbox. Queued inputs go out at once. Returns the close function. */
  openInbox(runId: string, listener: (input: RunInput) => void): (() => void) | null {
    const run = this.runs.get(runId);
    if (!run) return null;
    const listeners = this.inboxes.get(runId) ?? new Set();
    listeners.add(listener);
    this.inboxes.set(runId, listeners);
    for (const input of this.inboxQueues.get(runId) ?? []) listener(input);
    this.inboxQueues.delete(runId);
    run.lastSeen = Date.now();
    if (run.status === "lost") {
      this.refreshStatus(run);
      this.notify({ type: "update", run });
    }
    return () => {
      listeners.delete(listener);
      run.lastSeen = Date.now();
    };
  }

  inboxConnected(runId: string): boolean {
    return (this.inboxes.get(runId)?.size ?? 0) > 0;
  }

  /** Mark runs that stopped talking to the hub. */
  sweep(now = Date.now()): string[] {
    const lost: string[] = [];
    for (const run of this.runs.values()) {
      if (isLost(run, now, this.inboxConnected(run.id))) {
        run.status = "lost";
        this.record({ runId: run.id, at: now, event: { type: "lost" } }, run);
        lost.push(run.id);
      }
    }
    return lost;
  }

  snapshot(): PageMessage {
    const runs = [...this.runs.values()].map((run) => ({
      run,
      events: (this.transcripts.get(run.id) ?? []).slice(-SNAPSHOT_EVENTS),
    }));
    return { type: "snapshot", runs };
  }

  subscribe(listener: (message: PageMessage) => void): () => void {
    this.pageListeners.add(listener);
    return () => this.pageListeners.delete(listener);
  }

  /** Rebuild the state from log lines, without writing them again. */
  replay(lines: Iterable<string>): void {
    this.replaying = true;
    try {
      for (const line of lines) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line) as LogEntry;
        if (entry.event.type === "register") {
          this.register(entry.event.info, entry.runId, entry.event.started);
        } else if (entry.event.type === "launch") {
          this.launchRun(entry.event.info, entry.event.log, entry.runId, entry.event.started);
        } else if (entry.event.type === "attach") {
          this.attach(entry.runId, entry.event.stages, entry.at);
        } else if (entry.event.type === "lost") {
          const run = this.runs.get(entry.runId);
          if (run) run.status = "lost";
        } else {
          this.apply(entry.runId, entry.event, entry.at);
        }
      }
    } finally {
      this.replaying = false;
    }
  }

  private refreshStatus(run: RunState): void {
    if (run.status === "passed" || run.status === "failed") return;
    // A launched run stays "starting" until its orchestrator connects.
    if (run.launch && !run.launch.attached) return;
    run.status = run.pending.length > 0 ? "waiting" : "running";
  }

  private record(entry: LogEntry, run: RunState): void {
    this.transcripts.get(entry.runId)?.push(entry);
    if (this.replaying) return;
    this.persist(entry);
    this.notify({ type: "update", run, entry });
  }

  private notify(message: PageMessage): void {
    for (const listener of this.pageListeners) listener(message);
  }
}

// ---------------------------------------------------------------- HTTP server

const MAX_BODY = 1_000_000;

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function openStream(req: IncomingMessage, res: ServerResponse): (data: unknown) => void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  req.on("close", () => clearInterval(ping));
  return (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Refuse requests that a web page in the person's browser could forge. Binding to 127.0.0.1
 * does not stop DNS rebinding (a site points its own name at 127.0.0.1), so the Host header
 * must name this hub. A browser sends Origin on cross-site requests, so it must match too.
 * POST must be JSON: a page cannot send that to another site without a CORS preflight, and
 * the hub answers no preflight. Returns the reason to refuse, or null.
 */
export function refuseReason(headers: IncomingMessage["headers"], method: string, port: number): string | null {
  const allowed = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  if (!headers.host || !allowed.includes(headers.host)) return `Host ${headers.host ?? "(none)"} is not this hub`;
  const origin = headers.origin;
  if (origin && !allowed.some((host) => origin === `http://${host}`)) return `Origin ${origin} is not this hub`;
  if (method === "POST" && !String(headers["content-type"] ?? "").startsWith("application/json")) {
    return "POST requests must be application/json";
  }
  return null;
}

export function createHubServer(hub: Hub, launcher?: Launcher) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://hub");
    const parts = url.pathname.split("/").filter(Boolean);
    const refused = refuseReason(req.headers, req.method ?? "GET", req.socket.localPort ?? 0);
    if (refused) return send(res, 403, { error: refused });
    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(readFileSync(PAGE));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/stream") {
        const write = openStream(req, res);
        write(hub.snapshot());
        const unsubscribe = hub.subscribe(write);
        req.on("close", unsubscribe);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/runs") {
        const info = (await readJson(req)) as RunInfo;
        if (!info.story || !Array.isArray(info.stages)) return send(res, 400, { error: "story and stages are required" });
        if (info.id) {
          // A run that the hub launched takes over the entry made at launch.
          if (!hub.attach(info.id, info.stages)) return send(res, 409, { error: `no launched run ${info.id} is waiting to start` });
          return send(res, 201, { id: info.id });
        }
        return send(res, 201, { id: hub.register(info).id });
      }
      if (req.method === "GET" && url.pathname === "/api/workflows") {
        const modes = RUN_MODES.map((name) => ({ name, help: MODE_HELP[name] }));
        return send(res, 200, { workflows: launcher?.workflows() ?? [], modes });
      }
      if (req.method === "POST" && url.pathname === "/api/launch") {
        if (!launcher) return send(res, 404, { errors: ["this hub cannot launch runs"] });
        const result = launcher.launch((await readJson(req)) as LaunchRequest);
        return send(res, "id" in result ? 201 : 400, result);
      }
      if (parts[0] === "api" && parts[1] === "runs" && parts[2] && parts.length === 4) {
        const [, , runId, action] = parts;
        if (!hub.runs.has(runId)) return send(res, 404, { error: `unknown run ${runId}` });

        if (req.method === "GET" && action === "inbox") {
          const write = openStream(req, res);
          const close = hub.openInbox(runId, write);
          req.on("close", () => close?.());
          return;
        }
        if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
        const body = (await readJson(req)) as Record<string, unknown>;
        switch (action) {
          case "events": {
            const events = (body.events ?? []) as RunEvent[];
            for (const event of events) hub.apply(runId, event);
            return send(res, 200, { accepted: events.length });
          }
          case "answer": {
            const result = hub.answer(runId, String(body.requestId), body.response);
            return send(res, result === "ok" ? 200 : 409, { result });
          }
          case "message": {
            const text = String(body.text ?? "").trim();
            if (!text) return send(res, 400, { error: "text is required" });
            hub.apply(runId, { type: "message", stage: String(body.stage ?? ""), role: "user", text });
            hub.sendInput(runId, { type: "message", text });
            return send(res, 200, { result: "ok" });
          }
          case "interrupt":
            hub.sendInput(runId, { type: "interrupt" });
            return send(res, 200, { result: "ok" });
        }
      }
      send(res, 404, { error: "not found" });
    } catch (error) {
      send(res, 400, { error: String(error) });
    }
  });
}

function main(): void {
  const { values } = parseArgs({ options: { port: { type: "string", default: "4321" } } });
  mkdirSync(LOG_DIR, { recursive: true });
  const hub = new Hub((entry) => appendFileSync(join(LOG_DIR, `${entry.runId}.jsonl`), JSON.stringify(entry) + "\n"));

  for (const file of readdirSync(LOG_DIR).filter((f) => f.endsWith(".jsonl")).sort()) {
    hub.replay(readFileSync(join(LOG_DIR, file), "utf8").split("\n"));
  }
  setInterval(() => hub.sweep(), 10_000).unref();

  const port = Number(values.port);
  const launcher = new Launcher(hub, harnessDirs(resolve(HERE, "..")), `http://127.0.0.1:${port}`, LOG_DIR);
  createHubServer(hub, launcher).listen(port, "127.0.0.1", () => {
    console.log(`Dashboard hub on http://127.0.0.1:${port} (${hub.runs.size} runs loaded from ${LOG_DIR})`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(PAGE)) console.warn(`The page ${PAGE} is missing.`);
  main();
}
