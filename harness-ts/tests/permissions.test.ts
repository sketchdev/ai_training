import assert from "node:assert/strict";
import { test } from "node:test";

import { checkModes, modeFor, modeOptions } from "../src/permissions.ts";

test("the run's mode wins, then the stage's, then the workflow's, then the built-in one", () => {
  assert.equal(modeFor({}, {}, undefined, false), "dontAsk");
  assert.equal(modeFor({}, {}, undefined, true), "default");
  assert.equal(modeFor({}, { permission_mode: "auto" }, undefined, true), "auto");
  assert.equal(modeFor({ permission_mode: "acceptEdits" }, { permission_mode: "auto" }, undefined, true), "acceptEdits");
  assert.equal(modeFor({ permission_mode: "acceptEdits" }, {}, "bypassPermissions", true), "bypassPermissions");
});

test("bypassPermissions carries the SDK's opt-in, and no other mode does", () => {
  assert.deepEqual(modeOptions("bypassPermissions"), { permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true });
  assert.deepEqual(modeOptions("acceptEdits"), { permissionMode: "acceptEdits" });
});

test("a workflow that asks questions needs the dashboard and refuses dontAsk", () => {
  const interview = { requires_dashboard: true, stages: [{ name: "interview" }, { name: "implement" }] };
  assert.deepEqual(checkModes(interview, undefined, true), []);
  assert.equal(checkModes(interview, undefined, false).length, 1);
  assert.equal(checkModes(interview, "dontAsk", true).length, 1);
  assert.equal(checkModes({ ...interview, permission_mode: "dontAsk" }, "acceptEdits", true).length, 0);
});

test("an unknown mode in the workflow file is reported", () => {
  assert.equal(checkModes({ permission_mode: "plan", stages: [] }, undefined, true).length, 1);
  assert.equal(checkModes({ stages: [{ name: "x", permission_mode: "yolo" }] }, undefined, true).length, 1);
});
