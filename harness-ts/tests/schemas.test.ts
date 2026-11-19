import assert from "node:assert/strict";
import { test } from "node:test";

import { ImplementResult, outputSchema, Plan, ResolveResult, ReviewResult } from "../src/schemas.ts";

test("stage schemas carry no $schema key, which the CLI rejects for draft 2020-12", () => {
  for (const schema of [Plan, ImplementResult, ReviewResult, ResolveResult]) {
    const json = outputSchema(schema);
    assert.equal("$schema" in json, false);
    assert.equal(json.type, "object");
  }
  assert.deepEqual((outputSchema(Plan).required as string[]).sort(), ["files_to_change", "risks", "tests_to_add"]);
});
