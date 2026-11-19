/**
 * The JSON that the hub, the orchestrators (TypeScript and Python), and the dashboard page share.
 * harness-python/harness/hub_client.py sends the same shapes.
 */

export type RequestKind = "question" | "permission" | "reply" | "review";

export interface PendingRequest {
  id: string;
  kind: RequestKind;
  stage?: string;
  payload: Record<string, unknown>;
}

export type StageStatus = "pending" | "running" | "waiting" | "passed" | "failed";
export type RunStatus = "starting" | "running" | "waiting" | "passed" | "failed" | "lost";

export interface StageState {
  name: string;
  status: StageStatus;
  attempt: number;
  turns: number;
  cost: number;
}

export interface RunInfo {
  /** Only for a run that the hub launched: the id that the hub gave it at launch. */
  id?: string;
  story: string;
  workflow: string;
  harness: "ts" | "python";
  repo: string;
  stages: string[];
  /** The permission mode that the person chose for the run. Absent: each stage's own mode. */
  permissionMode?: string;
}

export interface RunState extends Omit<RunInfo, "stages"> {
  id: string;
  status: RunStatus;
  started: number;
  lastSeen: number;
  stages: StageState[];
  pending: PendingRequest[];
  /** For a run that the hub launched: its process output, and whether the orchestrator has connected. */
  launch?: { log: string; pid?: number; attached: boolean };
}

/** An input as the launch form shows it. `options` lists the files or choices to pick from. */
export interface InputField {
  name: string;
  kind: "file" | "path" | "text" | "choice";
  description?: string;
  default?: string;
  required: boolean;
  options?: string[];
}

/** A workflow that the hub can launch. `file` is relative to the harness folder. */
export interface WorkflowListing {
  harness: "ts" | "python";
  file: string;
  name: string;
  inputs: InputField[];
  /** The workflow's own permission mode, if it sets one. */
  permissionMode?: string;
  /** True if a stage asks the person questions. Such a workflow refuses dontAsk. */
  requiresDashboard?: boolean;
  /** Why this workflow cannot be launched, if it cannot. */
  error?: string;
}

export interface LaunchRequest {
  harness: "ts" | "python";
  workflow: string;
  inputs: Record<string, string>;
  /** The permission mode for every stage. Absent: the workflow's own modes. */
  permissionMode?: string;
}

/** Events that an orchestrator sends to the hub. */
export type RunEvent =
  | { type: "stage"; stage: string; status: StageStatus; attempt?: number; turns?: number; cost?: number; reason?: string }
  | { type: "message"; stage: string; role: "assistant" | "tool" | "result" | "user" | "system"; text: string }
  | { type: "pending"; request: PendingRequest }
  | { type: "resolved"; requestId: string; response?: unknown }
  | { type: "end"; status: "passed" | "failed"; reason?: string };

/** Inputs that the hub forwards from the page to an orchestrator. */
export type RunInput =
  | { type: "answer"; requestId: string; response: unknown }
  | { type: "message"; text: string }
  | { type: "interrupt" };

/** Responses that the page sends for each kind of request. */
export type QuestionResponse = { answers: Record<string, string> } | { skip: true };
export type PermissionResponse = { allow: boolean; note?: string };
export type ReplyResponse = { action: "reply"; text: string } | { action: "retry" } | { action: "stop" };
export type ReviewResponse =
  | { action: "merge"; branch: string; message: string }
  | { action: "changes"; text: string }
  | { action: "discard" };

/** The payload of a "review" request: the run's changes, for the person to merge or not. */
export interface ReviewPayload {
  /** Each file with its own patch. A file without a patch is past the size limit. */
  files: { path: string; added: number; removed: number; patch?: string }[];
  truncated: boolean;
  worktree: string;
  branch: string;
  /** True once the story branch has this branch merged in. Then only this branch can be the target. */
  branchLocked: boolean;
  message: string;
  verdict?: string;
  findings?: string[];
  summary?: string;
  note?: string;
  error?: string;
}
