import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import {
  cleanup,
  commitRun,
  defaultBranchName,
  defaultCommitMessage,
  diffForReview,
  filesWithMarkers,
  finishResolveMerge,
  git,
  hasChanges,
  type RunTree,
  squashMerge,
  startResolveMerge,
} from "../src/merge.ts";

let root: string;
let main: string;
let tree: RunTree;

function write(dir: string, file: string, text: string): void {
  writeFileSync(join(dir, "app", file), text);
}

/** A repository with app/a.txt on main, and a run worktree on a story branch. */
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "merge-test-"));
  main = join(root, "main");
  git(root, ["init", "-q", "-b", "main", main]);
  git(main, ["config", "user.email", "test@example.com"]);
  git(main, ["config", "user.name", "Test"]);
  git(main, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(main, "README"), "readme\n");
  mkdirSync(join(main, "app"));
  write(main, "a.txt", "one\ntwo\nthree\n");
  git(main, ["add", "-A"]);
  git(main, ["commit", "-q", "-m", "app"]);

  const base = git(main, ["rev-parse", "HEAD"]);
  const top = join(root, "runs", "r1", "repo");
  git(main, ["worktree", "add", "-q", "-b", "story/s-r1", top, "HEAD"]);
  tree = { top, prefix: "app/", branch: "story/s-r1", base };
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const stats = (files: { path: string; added: number; removed: number }[]) =>
  files.map(({ path, added, removed }) => ({ path, added, removed }));

test("defaults come from the story", () => {
  assert.equal(defaultBranchName("story-1-list-games"), "feat/list-games");
  assert.equal(defaultCommitMessage("# Story 1: List games\n\nBody", "story-1-list-games"), "feat: list games");
});

test("commitRun commits every change, inside the prefix or not, and reports no change", () => {
  assert.equal(commitRun(tree, "wip"), false);
  write(tree.top, "a.txt", "one\nTWO\nthree\n");
  writeFileSync(join(tree.top, "README"), "changed outside the prefix\n");
  assert.equal(commitRun(tree, "wip"), true);
  assert.equal(hasChanges(tree, tree.base), true);
  const diff = diffForReview(tree, `${tree.base}..${tree.branch}`);
  assert.deepEqual(stats(diff.files), [
    { path: "README", added: 1, removed: 1 },
    { path: "app/a.txt", added: 1, removed: 1 },
  ]);
  assert.match(diff.files[1].patch ?? "", /^diff --git a\/app\/a.txt/);
  assert.equal(diff.truncated, false);
  const small = diffForReview(tree, `${tree.base}..${tree.branch}`, 10);
  assert.equal(small.truncated, true);
  assert.equal(small.files[1].patch, undefined);
});

test("a squash into a new branch starts at the run's start commit", () => {
  git(main, ["commit", "-q", "--allow-empty", "-m", "later work on main"]);
  write(tree.top, "a.txt", "one\nTWO\nthree\n");
  commitRun(tree, "wip");
  const result = squashMerge(tree, "feat/s", "feat: s", join(root, "runs", "r1", "merge"));
  assert.equal(result.kind, "merged");
  assert.equal(git(main, ["log", "--format=%s", "feat/s"]).split("\n")[0], "feat: s");
  assert.equal(git(main, ["rev-parse", "feat/s~1"]), tree.base);
  assert.equal(existsSync(join(root, "runs", "r1", "merge")), false);
  // main itself did not move.
  assert.equal(git(main, ["log", "-1", "--format=%s"]), "later work on main");
});

test("a squash into a clean checked-out branch updates that checkout's files", () => {
  write(tree.top, "a.txt", "one\nTWO\nthree\n");
  commitRun(tree, "wip");
  const result = squashMerge(tree, "main", "feat: s", join(root, "merge"));
  assert.equal(result.kind, "merged");
  assert.equal(readFileSync(join(main, "app", "a.txt"), "utf8"), "one\nTWO\nthree\n");
});

test("a dirty checked-out branch is refused and left as it was", () => {
  write(tree.top, "a.txt", "one\nTWO\nthree\n");
  commitRun(tree, "wip");
  write(main, "a.txt", "local edit\n");
  const head = git(main, ["rev-parse", "HEAD"]);
  const result = squashMerge(tree, "main", "feat: s", join(root, "merge"));
  assert.equal(result.kind, "refused");
  assert.equal(readFileSync(join(main, "app", "a.txt"), "utf8"), "local edit\n");
  assert.equal(git(main, ["rev-parse", "HEAD"]), head);
});

test("a conflict leaves the target unchanged, and the model's fix can be merged", () => {
  write(main, "a.txt", "one\nMAIN\nthree\n");
  git(main, ["commit", "-q", "-am", "main changes line two"]);
  write(tree.top, "a.txt", "one\nSTORY\nthree\n");
  commitRun(tree, "wip");
  const head = git(main, ["rev-parse", "HEAD"]);

  const result = squashMerge(tree, "main", "feat: s", join(root, "merge"));
  assert.deepEqual(result, { kind: "conflict", files: ["app/a.txt"] });
  assert.equal(git(main, ["rev-parse", "HEAD"]), head);
  assert.equal(git(main, ["status", "--porcelain"]), "");

  const conflicted = startResolveMerge(tree, "main");
  assert.deepEqual(conflicted, ["app/a.txt"]);
  assert.deepEqual(filesWithMarkers(tree.top, conflicted), ["app/a.txt"]);
  write(tree.top, "a.txt", "one\nMAIN and STORY\nthree\n"); // what the resolve stage does
  assert.deepEqual(filesWithMarkers(tree.top, conflicted), []);
  finishResolveMerge(tree);

  const diff = diffForReview(tree, `main...${tree.branch}`);
  assert.deepEqual(stats(diff.files), [{ path: "app/a.txt", added: 1, removed: 1 }]);
  assert.equal(squashMerge(tree, "main", "feat: s", join(root, "merge")).kind, "merged");
  assert.equal(readFileSync(join(main, "app", "a.txt"), "utf8"), "one\nMAIN and STORY\nthree\n");
});

test("cleanup removes the worktree and the story branch", () => {
  cleanup(main, tree);
  assert.equal(existsSync(tree.top), false);
  assert.equal(existsSync(join(root, "runs", "r1")), false);
  assert.equal(git(main, ["branch", "--list", tree.branch]), "");
});

test("each file gets its own patch, also for a rename and an unusual path", () => {
  git(tree.top, ["mv", "app/a.txt", "app/b.txt"]);
  writeFileSync(join(tree.top, "app", "naïve file.txt"), "new\n");
  commitRun(tree, "wip");
  const diff = diffForReview(tree, `${tree.base}..${tree.branch}`);
  const paths = diff.files.map((f) => f.path).sort();
  assert.deepEqual(paths, ["app/a.txt", "app/b.txt", "app/naïve file.txt"]);
  for (const file of diff.files) {
    assert.ok(file.patch?.includes(`b/${file.path}`) || file.patch?.includes(`a/${file.path}`), file.path);
  }
});

test("the review diff covers files outside the prefix, which a squash would take too", () => {
  write(tree.top, "a.txt", "one\nTWO\nthree\n");
  commitRun(tree, "wip");
  writeFileSync(join(tree.top, "README"), "changed by a conflict fix\n");
  git(tree.top, ["commit", "-q", "-am", "root change"]);
  assert.deepEqual(diffForReview(tree, `${tree.base}..${tree.branch}`).files.map((f) => f.path).sort(), ["README", "app/a.txt"]);
});

test("a rejected commit leaves the checkout clean and removes a branch it created", () => {
  write(tree.top, "a.txt", "one\nTWO\nthree\n");
  commitRun(tree, "wip");
  // A pre-commit hook that rejects every commit. Set hooksPath here, so a global one does not apply.
  const hooks = join(root, "hooks");
  mkdirSync(hooks);
  writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\necho rejected >&2\nexit 1\n", { mode: 0o755 });
  git(main, ["config", "core.hooksPath", hooks]);

  const head = git(main, ["rev-parse", "HEAD"]);
  const intoMain = squashMerge(tree, "main", "feat: s", join(root, "merge"));
  assert.equal(intoMain.kind, "refused");
  assert.equal(git(main, ["status", "--porcelain", "--untracked-files=no"]), "");
  assert.equal(git(main, ["rev-parse", "HEAD"]), head);

  const temp = join(root, "runs", "r1", "merge");
  assert.equal(squashMerge(tree, "feat/new", "feat: s", temp).kind, "refused");
  assert.equal(git(main, ["branch", "--list", "feat/new"]), "");
  assert.equal(existsSync(temp), false);
});

test("a leftover temporary worktree does not block the next merge", () => {
  write(tree.top, "a.txt", "one\nTWO\nthree\n");
  commitRun(tree, "wip");
  const temp = join(root, "runs", "r1", "merge");
  git(main, ["branch", "feat/s"]);
  git(main, ["worktree", "add", "-q", "--detach", temp, "feat/s"]); // left behind by a crash
  assert.equal(squashMerge(tree, "feat/s", "feat: s", temp).kind, "merged");
});

test("a conflict in a file outside the prefix can be resolved and committed", () => {
  writeFileSync(join(main, "README"), "main readme\n");
  git(main, ["commit", "-q", "-am", "main changes the readme"]);
  writeFileSync(join(tree.top, "README"), "story readme\n");
  git(tree.top, ["commit", "-q", "-am", "story changes the readme"]);
  const conflicted = startResolveMerge(tree, "main");
  assert.deepEqual(conflicted, ["README"]);
  writeFileSync(join(tree.top, "README"), "merged readme\n");
  finishResolveMerge(tree);
  assert.equal(git(tree.top, ["status", "--porcelain", "--untracked-files=no"]), "");
  assert.equal(git(tree.top, ["log", "-1", "--format=%p"]).split(" ").length, 2);
});
