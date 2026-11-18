/**
 * The JSON that the hub, the orchestrators (TypeScript and Python), and the dashboard page share.
 * harness-python/harness/hub_client.py sends the same shapes.
 */

export type RequestKind = "question" | "permission" | "reply";

export interface PendingRequest {
  id: string;
  kind: RequestKind;
  stage?: string;
  payload: Record<string, unknown>;
}

export type StageStatus = "pending" | "running" | "waiting" | "passed" | "failed";
export type RunStatus = "running" | "waiting" | "passed" | "failed" | "lost";

export interface StageState {
  name: string;
  status: StageStatus;
  attempt: number;
  turns: number;
  cost: number;
}

export interface RunInfo {
  story: string;
  workflow: string;
  harness: "ts" | "python";
  repo: string;
  stages: string[];
}

export interface RunState extends Omit<RunInfo, "stages"> {
  id: string;
  status: RunStatus;
  started: number;
  lastSeen: number;
  stages: StageState[];
  pending: PendingRequest[];
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
