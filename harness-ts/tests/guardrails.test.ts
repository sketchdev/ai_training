import assert from "node:assert/strict";
import { test } from "node:test";

import { checkToolCall } from "../src/guardrails.ts";

const PROTECTED = ["pom.xml", ".github/"];

test("blocks protected edit", () => {
  assert.notEqual(checkToolCall("Edit", { file_path: "/r/pom.xml" }, PROTECTED), null);
});

test("allows source edit", () => {
  assert.equal(checkToolCall("Write", { file_path: "/r/src/A.java" }, PROTECTED), null);
});

test("blocks git push", () => {
  assert.notEqual(checkToolCall("Bash", { command: "git push origin main" }, PROTECTED), null);
});

test("allows mvn", () => {
  assert.equal(checkToolCall("Bash", { command: "mvn verify" }, PROTECTED), null);
});
