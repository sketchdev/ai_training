import assert from "node:assert/strict";
import { test } from "node:test";

import { Hub, isLost, LOST_AFTER_MS, refuseReason, type LogEntry } from "../src/hub.ts";
import { HubClient, InputQueue, TurnTracker } from "../src/hubClient.ts";
import type { RunInfo, RunInput } from "../src/hubTypes.ts";

const INFO: RunInfo = { story: "story-1", workflow: "story-to-pr", harness: "ts", repo: "/r", stages: ["plan", "implement"] };

test("a pending request makes the run wait, and an answer resolves it once", () => {
  const hub = new Hub();
  const run = hub.register(INFO);
  hub.apply(run.id, { type: "pending", request: { id: "q1", kind: "question", payload: {} } });
  assert.equal(run.status, "waiting");

  const inputs: RunInput[] = [];
  hub.openInbox(run.id, (input) => inputs.push(input));
  assert.equal(hub.answer(run.id, "q1", { answers: { a: "b" } }), "ok");
  assert.equal(hub.answer(run.id, "q1", { answers: { a: "c" } }), "not_pending");
  assert.equal(run.status, "running");
  assert.deepEqual(inputs, [{ type: "answer", requestId: "q1", response: { answers: { a: "b" } } }]);
});

test("inputs wait in a queue until the run opens its inbox", () => {
  const hub = new Hub();
  const run = hub.register(INFO);
  hub.sendInput(run.id, { type: "message", text: "hello" });
  const inputs: RunInput[] = [];
  hub.openInbox(run.id, (input) => inputs.push(input));
  assert.deepEqual(inputs, [{ type: "message", text: "hello" }]);
});

test("stage events set the stage totals", () => {
  const hub = new Hub();
  const run = hub.register(INFO);
  hub.apply(run.id, { type: "stage", stage: "plan", status: "running", attempt: 1, turns: 3, cost: 0.1 });
  hub.apply(run.id, { type: "stage", stage: "plan", status: "passed", turns: 5, cost: 0.2 });
  assert.deepEqual(run.stages[0], { name: "plan", status: "passed", attempt: 1, turns: 5, cost: 0.2 });
});

test("replay rebuilds runs from the log without writing it again", () => {
  const log: LogEntry[] = [];
  const first = new Hub((entry) => log.push(entry));
  const run = first.register(INFO, "r1", 1000);
  first.apply(run.id, { type: "pending", request: { id: "q1", kind: "reply", payload: {} } }, 2000);
  first.apply(run.id, { type: "end", status: "passed" }, 3000);

  const written: LogEntry[] = [];
  const second = new Hub((entry) => written.push(entry));
  second.replay(log.map((entry) => JSON.stringify(entry)));
  const rebuilt = second.runs.get("r1");
  assert.equal(rebuilt?.status, "passed");
  assert.equal(rebuilt?.lastSeen, 3000);
  assert.deepEqual(rebuilt?.pending, []);
  assert.equal(written.length, 0);
});

test("a silent run with no inbox is lost, and reconnecting brings it back", () => {
  const hub = new Hub();
  const run = hub.register(INFO, "r1", 0);
  assert.equal(isLost(run, LOST_AFTER_MS - 1, false), false);
  assert.equal(isLost(run, LOST_AFTER_MS + 1, true), false);
  assert.deepEqual(hub.sweep(LOST_AFTER_MS + 1), ["r1"]);
  assert.equal(run.status, "lost");
  hub.openInbox("r1", () => {});
  assert.equal(run.status, "running");
});

test("finished runs are never lost", () => {
  const hub = new Hub();
  const run = hub.register(INFO, "r1", 0);
  hub.apply("r1", { type: "end", status: "failed" }, 0);
  assert.equal(isLost(run, LOST_AFTER_MS * 10, false), false);
});

test("the client pairs an answer with its request and ignores unknown ones", async () => {
  const sent: unknown[] = [];
  const fakeFetch = (async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const client = new HubClient("http://hub", "r1", fakeFetch);
  const asked = client.ask("permission", { tool: "WebFetch" }, "plan");
  client.handleInput({ type: "answer", requestId: "q99", response: { allow: false } });
  client.handleInput({ type: "answer", requestId: "q1", response: { allow: true } });
  assert.deepEqual(await asked, { allow: true });
  await client.close();
  assert.equal((sent[0] as { events: { type: string }[] }).events[0].type, "pending");
});

test("an aborted request resolves with undefined and tells the hub", async () => {
  const events: { type: string }[] = [];
  const fakeFetch = (async (_url: string, init?: RequestInit) => {
    events.push(...(JSON.parse(String(init?.body)) as { events: { type: string }[] }).events);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const client = new HubClient("http://hub", "r1", fakeFetch);
  const abort = new AbortController();
  const asked = client.ask("question", {}, "plan", abort.signal);
  abort.abort();
  assert.equal(await asked, undefined);
  await client.close();
  assert.deepEqual(events.map((e) => e.type), ["pending", "resolved"]);
});

test("the client keeps events while the hub is down and sends them later", async () => {
  let up = false;
  const delivered: unknown[] = [];
  const fakeFetch = (async (_url: string, init?: RequestInit) => {
    if (!up) throw new Error("connection refused");
    delivered.push(...(JSON.parse(String(init?.body)) as { events: unknown[] }).events);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const client = new HubClient("http://hub", "r1", fakeFetch);
  client.emit({ type: "message", stage: "plan", role: "assistant", text: "one" });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(delivered.length, 0);
  up = true;
  await client.close();
  assert.equal(delivered.length, 1);
});

test("the input queue yields pushed messages and ends on close", async () => {
  const queue = new InputQueue();
  queue.push("first");
  const iterator = queue[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value?.message.content, "first");
  const next = iterator.next();
  queue.push("second");
  assert.equal((await next).value?.message.content, "second");
  queue.close();
  assert.equal((await iterator.next()).done, true);
});

test("the input queue gives each message a uuid", async () => {
  const queue = new InputQueue();
  const uuid = queue.push("hello");
  const { value } = await queue[Symbol.asyncIterator]().next();
  assert.equal(value?.uuid, uuid);
  queue.close();
  assert.equal(queue.push("late"), undefined);
});

test("a result ends the exchange only when every sent message is answered", () => {
  const turns = new TurnTracker();
  turns.sent("a");
  turns.sent("b"); // a person's message, sent mid-turn
  assert.equal(turns.consume({ user_message_uuids: ["a"] }), false);
  assert.equal(turns.consume({ user_message_uuids: ["b"] }), true);
});

test("messages folded into one turn are answered together", () => {
  const turns = new TurnTracker();
  turns.sent("a");
  turns.sent("b");
  assert.equal(turns.consume({ user_message_uuid: "b", user_message_uuids: ["a", "b"] }), true);
});

test("without uuids on the result, each result answers the oldest message", () => {
  const turns = new TurnTracker();
  turns.sent("a");
  turns.sent("b");
  assert.equal(turns.consume({}), false);
  assert.equal(turns.consume({}), true);
});

test("the hub refuses requests that a web page could forge", () => {
  const json = { "content-type": "application/json" };
  assert.equal(refuseReason({ host: "127.0.0.1:4321", ...json }, "POST", 4321), null);
  assert.equal(refuseReason({ host: "localhost:4321", origin: "http://localhost:4321", ...json }, "POST", 4321), null);
  // DNS rebinding: the browser sends the attacker's name as Host.
  assert.notEqual(refuseReason({ host: "evil.example:4321", ...json }, "POST", 4321), null);
  assert.notEqual(refuseReason({ host: "127.0.0.1:4321", origin: "http://evil.example", ...json }, "POST", 4321), null);
  // A form post from another site cannot set the JSON content type without a preflight.
  assert.notEqual(refuseReason({ host: "127.0.0.1:4321", "content-type": "text/plain" }, "POST", 4321), null);
  assert.equal(refuseReason({ host: "127.0.0.1:4321" }, "GET", 4321), null);
});
