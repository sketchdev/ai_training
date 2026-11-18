/**
 * The orchestrator's side of the dashboard hub (src/hub.ts).
 *
 * `emit` buffers events and sends them in batches. If the hub is down, the buffer keeps
 * them and the client retries every 2 seconds. `ask` sends a pending request and waits
 * for the person's answer, which arrives on the inbox stream.
 */
import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";

import type { RequestKind, RunEvent, RunInfo, RunInput } from "./hubTypes.ts";

const RETRY_MS = 2_000;
const MAX_TEXT = 2_000;

type Fetch = typeof fetch;

export class HubClient {
  onMessage: (text: string) => void = () => {};
  onInterrupt: () => void = () => {};

  private buffer: RunEvent[] = [];
  private flushing = false;
  private retryTimer: NodeJS.Timeout | undefined;
  private readonly waiters = new Map<string, (response: unknown) => void>();
  private counter = 0;
  private closed = false;
  private readonly abort = new AbortController();

  constructor(
    readonly url: string,
    readonly runId: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  /** Register a run. Throws if the hub cannot be reached. */
  static async register(url: string, info: RunInfo, fetchImpl: Fetch = fetch): Promise<HubClient> {
    let res: Response;
    try {
      res = await fetchImpl(`${url}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(info),
      });
    } catch (error) {
      throw new Error(`Cannot reach the dashboard hub at ${url}. Start it with "npm run hub" in harness-ts. (${error})`);
    }
    if (!res.ok) throw new Error(`The hub refused the run: ${res.status} ${await res.text()}`);
    const { id } = (await res.json()) as { id: string };
    return new HubClient(url, id, fetchImpl);
  }

  emit(event: RunEvent): void {
    this.buffer.push(event);
    void this.flush();
  }

  /** Send a request to the page and wait for the answer. An abort resolves it with undefined. */
  ask(kind: RequestKind, payload: Record<string, unknown>, stage?: string, signal?: AbortSignal): Promise<unknown> {
    const id = `q${++this.counter}`;
    return new Promise((resolveAnswer) => {
      this.waiters.set(id, resolveAnswer);
      signal?.addEventListener("abort", () => {
        if (this.waiters.delete(id)) {
          this.emit({ type: "resolved", requestId: id });
          resolveAnswer(undefined);
        }
      });
      this.emit({ type: "pending", request: { id, kind, stage, payload } });
    });
  }

  /** Route one input from the inbox. Public so tests can call it. */
  handleInput(input: RunInput): void {
    if (input.type === "answer") {
      const waiter = this.waiters.get(input.requestId);
      if (waiter) {
        this.waiters.delete(input.requestId);
        waiter(input.response);
      }
    } else if (input.type === "message") {
      this.onMessage(input.text);
    } else if (input.type === "interrupt") {
      this.onInterrupt();
    }
  }

  /** Read the inbox stream until close() is called. Reconnects when the stream drops. */
  async runInbox(): Promise<void> {
    while (!this.closed) {
      try {
        const res = await this.fetchImpl(`${this.url}/api/runs/${this.runId}/inbox`, { signal: this.abort.signal });
        if (!res.ok || !res.body) throw new Error(`inbox returned ${res.status}`);
        let pending = "";
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          pending += Buffer.from(chunk).toString("utf8");
          let end: number;
          while ((end = pending.indexOf("\n\n")) >= 0) {
            const frame = pending.slice(0, end);
            pending = pending.slice(end + 2);
            for (const line of frame.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              // One bad line must not drop the stream or the inputs after it.
              try {
                this.handleInput(JSON.parse(line.slice(6)) as RunInput);
              } catch (error) {
                console.error(`Skipped an inbox line that is not valid JSON: ${error}`);
              }
            }
          }
        }
      } catch {
        // The hub is down or restarting. Try again below.
      }
      if (!this.closed) await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }

  /** Stop the inbox and send what is left in the buffer, waiting at most 5 seconds. */
  async close(): Promise<void> {
    this.closed = true;
    this.abort.abort();
    const deadline = Date.now() + 5_000;
    while (this.buffer.length > 0 && Date.now() < deadline) {
      await this.flush();
      if (this.buffer.length > 0) await new Promise((r) => setTimeout(r, 200));
    }
    clearTimeout(this.retryTimer);
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    const batch = this.buffer.slice();
    try {
      const res = await this.fetchImpl(`${this.url}/api/runs/${this.runId}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: batch }),
      });
      if (!res.ok) throw new Error(`events returned ${res.status}`);
      this.buffer.splice(0, batch.length);
    } catch {
      if (!this.retryTimer) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = undefined;
          void this.flush();
        }, RETRY_MS);
        this.retryTimer.unref();
      }
    } finally {
      this.flushing = false;
    }
    if (this.buffer.length > 0 && !this.retryTimer) void this.flush();
  }
}

/** A queue of user messages that feeds a streaming-input session. close() ends the session. */
export class InputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly items: SDKUserMessage[] = [];
  private waiting: ((result: IteratorResult<SDKUserMessage>) => void) | undefined;
  private done = false;

  /** Queue a message. Returns its uuid, or undefined if the queue is closed. */
  push(text: string): string | undefined {
    if (this.done) return undefined;
    const uuid = randomUUID();
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      uuid,
    };
    if (this.waiting) {
      const waiting = this.waiting;
      this.waiting = undefined;
      waiting({ value: message, done: false });
    } else {
      this.items.push(message);
    }
    return uuid;
  }

  close(): void {
    this.done = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.done) return Promise.resolve({ value: undefined, done: true });
        return new Promise((r) => (this.waiting = r));
      },
    };
  }
}

/**
 * Tracks which user messages still wait for an answer. A message sent mid-turn runs as its
 * own turn later, or folds into the current one, so a result is the end of the exchange
 * only when no sent message is left. Results name the messages they consumed in
 * user_message_uuids. Older CLIs leave that out, and then each result consumes the oldest.
 */
export class TurnTracker {
  private readonly outstanding: string[] = [];

  sent(uuid: string | undefined): void {
    if (uuid) this.outstanding.push(uuid);
  }

  /** Record one result. Returns true when no sent message is left without an answer. */
  consume(result: { user_message_uuid?: string; user_message_uuids?: string[] }): boolean {
    const consumed = result.user_message_uuids ?? (result.user_message_uuid ? [result.user_message_uuid] : undefined);
    if (consumed) {
      for (const uuid of consumed) {
        const index = this.outstanding.indexOf(uuid);
        if (index >= 0) this.outstanding.splice(index, 1);
      }
    } else {
      this.outstanding.shift();
    }
    return this.outstanding.length === 0;
  }
}

function clip(text: string, max = MAX_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}… (${text.length - max} more characters)` : text;
}

/** Turn one SDK message into short transcript events for the page. */
export function summarize(message: SDKMessage, stage: string): RunEvent[] {
  const events: RunEvent[] = [];
  const add = (role: "assistant" | "tool" | "result" | "system", text: string) =>
    events.push({ type: "message", stage, role, text: clip(text) });

  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type === "text" && block.text.trim()) add("assistant", block.text);
      if (block.type === "tool_use") add("tool", `${block.name} ${JSON.stringify(block.input)}`);
    }
  } else if (message.type === "user" && Array.isArray(message.message.content)) {
    for (const block of message.message.content) {
      if (block.type !== "tool_result") continue;
      const content =
        typeof block.content === "string"
          ? block.content
          : (block.content ?? []).map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n");
      add("tool", `${block.is_error ? "error" : "result"}: ${clip(content, 500)}`);
    }
  } else if (message.type === "result") {
    add("result", `${message.subtype}, ${message.num_turns} turns, $${message.total_cost_usd.toFixed(4)}`);
  } else if (message.type === "system" && message.subtype === "init") {
    const plugins = message.plugins?.map((p) => p.name).join(", ") || "none";
    add("system", `Session started. Model ${message.model}. Plugins: ${plugins}.`);
  }
  return events;
}
