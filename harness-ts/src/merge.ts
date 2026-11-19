/**
 * Git operations for the review and merge step of a live run.
 *
 * A run works in its own worktree on a story branch. After the person approves it in the
 * dashboard, its changes land on a target branch as one squash commit. These functions take
 * paths and return results, and change nothing outside the repository they are given.
 * harness-python/harness/merge.py has the same functions.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** The run's worktree and story branch. */
export interface RunTree {
  /** The root folder of the run's worktree. */
  top: string;
  /** The folder that --repo names inside the repository, for example "battleship/". Empty for the root. */
  prefix: string;
  /** The story branch, for example "story/story-1-list-games-r123". */
  branch: string;
  /** The commit the run started from. */
  base: string;
}

export interface DiffFile {
  path: string;
  added: number;
  removed: number;
  /** This file's part of the patch. Absent when the patch is past the size limit. */
  patch?: string;
}

export interface ReviewDiff {
  files: DiffFile[];
  truncated: boolean;
}

export type MergeResult =
  | { kind: "merged"; sha: string; where: string }
  | { kind: "conflict"; files: string[] }
  | { kind: "refused"; reason: string };

/** The largest patch that the dashboard gets. The full diff stays in the worktree. */
export const PATCH_LIMIT = 400_000;

interface GitRun {
  ok: boolean;
  out: string;
  err: string;
}

function run(cwd: string, args: string[]): GitRun {
  const done = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: done.status === 0, out: (done.stdout ?? "").trim(), err: (done.stderr ?? "").trim() };
}

export function git(cwd: string, args: string[]): string {
  const done = run(cwd, args);
  if (!done.ok) throw new Error(`git ${args.join(" ")} failed: ${done.err || done.out}`);
  return done.out;
}

/**
 * Commit every change in the worktree on the story branch, inside the prefix or not, so the
 * review, the merge, and the cleanup all see the same files. Returns false if there was nothing to commit.
 */
export function commitRun(tree: RunTree, message: string): boolean {
  git(tree.top, ["add", "-A"]);
  if (run(tree.top, ["diff", "--cached", "--quiet"]).ok) return false;
  git(tree.top, ["commit", "-q", "-m", message]);
  return true;
}

/**
 * True if the story branch changes anything compared with `from`. This covers the whole
 * repository, not only the prefix, because a squash merge takes the whole branch.
 */
export function hasChanges(tree: RunTree, from: string): boolean {
  return !run(tree.top, ["diff", "--quiet", from, tree.branch]).ok;
}

/**
 * The diff that the person reviews, one entry per file with its own patch. `range` is
 * "<base>..<branch>" or "<target>...<branch>". It covers the whole repository, so that
 * nothing merges unseen. Renames show as a delete and an add, and paths are not quoted, so
 * each file's patch pairs with its numstat line in order.
 */
export function diffForReview(tree: RunTree, range: string, limit = PATCH_LIMIT): ReviewDiff {
  const out = git(tree.top, ["-c", "core.quotePath=false", "diff", "--no-renames", "--numstat", "-p", range]);
  const start = out.search(/^diff --git /m);
  const stats = (start >= 0 ? out.slice(0, start) : out).split("\n").filter(Boolean);
  const patches = start >= 0 ? out.slice(start).split(/^(?=diff --git )/m) : [];
  let used = 0;
  let truncated = false;
  const files = stats.map((line, i) => {
    const [added, removed, ...path] = line.split("\t");
    // Binary files show "-" for both counts.
    const file: DiffFile = { path: path.join("\t"), added: Number(added) || 0, removed: Number(removed) || 0 };
    const patch = patches[i];
    if (patch !== undefined && used + patch.length <= limit) {
      file.patch = patch.replace(/\n$/, "");
      used += patch.length;
    } else if (patch !== undefined) {
      truncated = true;
    }
    return file;
  });
  return { files, truncated };
}

/** "story-1-list-games" becomes "feat/list-games". */
export function defaultBranchName(storyName: string): string {
  const slug = storyName
    .replace(/^story-\d+-/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `feat/${slug || "story"}`;
}

/** "# Story 1: List games" becomes "feat: list games". */
export function defaultCommitMessage(story: string, storyName: string): string {
  const heading = story.split("\n").find((line) => line.startsWith("# "));
  const title = (heading ?? storyName).replace(/^#\s*/, "").replace(/^Story\s+\d+:\s*/i, "").trim();
  return `feat: ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
}

export function validBranchName(cwd: string, name: string): boolean {
  return name.trim() !== "" && run(cwd, ["check-ref-format", "--branch", name]).ok;
}

export function branchExists(cwd: string, name: string): boolean {
  return run(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]).ok;
}

/** The worktree where `branch` is checked out, if any. */
export function findCheckout(cwd: string, branch: string): string | undefined {
  let path: string | undefined;
  for (const line of git(cwd, ["worktree", "list", "--porcelain"]).split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    if (line === `branch refs/heads/${branch}`) return path;
  }
  return undefined;
}

/** True if the checkout has no changes to tracked files. Untracked files do not count. */
export function isClean(path: string): boolean {
  return git(path, ["status", "--porcelain", "--untracked-files=no"]) === "";
}

/**
 * Squash the story branch into `target`. A missing target starts at the run's start commit.
 * The merge happens where the target is checked out, if that checkout is clean, or else in a
 * temporary worktree at `tempPath`. On a conflict or a refusal, nothing changes.
 */
export function squashMerge(tree: RunTree, target: string, message: string, tempPath: string): MergeResult {
  const created = !branchExists(tree.top, target);
  if (created) git(tree.top, ["branch", target, tree.base]);
  const undo = (result: MergeResult): MergeResult => {
    if (created) run(tree.top, ["branch", "-D", target]);
    return result;
  };

  let where = findCheckout(tree.top, target);
  let temporary = false;
  if (where) {
    if (!isClean(where)) {
      return undo({ kind: "refused", reason: `${target} is checked out in ${where}, which has uncommitted changes. Commit or stash them, or pick another branch.` });
    }
  } else {
    // A failed attempt can leave the temporary worktree behind. Remove it first.
    removeWorktree(tree.top, tempPath);
    const added = run(tree.top, ["worktree", "add", "-q", tempPath, target]);
    if (!added.ok) return undo({ kind: "refused", reason: `cannot check out ${target}: ${added.err || added.out}` });
    where = tempPath;
    temporary = true;
  }
  const checkout = where;
  // Put the checkout back as it was. Safe: it was clean, or a new temporary worktree.
  // Untracked files are kept.
  const restore = () => {
    run(checkout, ["reset", "-q", "--hard", "HEAD"]);
    if (temporary) removeWorktree(tree.top, tempPath);
  };

  const merge = run(checkout, ["merge", "--squash", tree.branch]);
  if (!merge.ok) {
    const files = run(checkout, ["diff", "--name-only", "--diff-filter=U"]).out.split("\n").filter(Boolean);
    restore();
    return undo(files.length > 0 ? { kind: "conflict", files } : { kind: "refused", reason: merge.err || merge.out });
  }
  if (run(checkout, ["diff", "--cached", "--quiet"]).ok) {
    restore();
    return undo({ kind: "refused", reason: `${target} already has every change in this run.` });
  }
  const commit = run(checkout, ["commit", "-q", "-m", message]);
  if (!commit.ok) {
    // For example a pre-commit hook rejected it. Leave nothing staged in the checkout.
    restore();
    return undo({ kind: "refused", reason: `the commit on ${target} failed: ${commit.err || commit.out}` });
  }
  const sha = git(checkout, ["rev-parse", "--short", "HEAD"]);
  if (temporary) removeWorktree(tree.top, tempPath);
  return { kind: "merged", sha, where: temporary ? `branch ${target}` : checkout };
}

/** Remove a worktree and forget it, if it exists. */
function removeWorktree(cwd: string, path: string): void {
  run(cwd, ["worktree", "remove", "--force", path]);
  run(cwd, ["worktree", "prune"]);
}

/** Merge the target into the story branch. Returns the conflicted files, relative to the worktree root. */
export function startResolveMerge(tree: RunTree, target: string): string[] {
  const merge = run(tree.top, ["merge", "--no-edit", "-q", target]);
  if (merge.ok) return [];
  const files = run(tree.top, ["diff", "--name-only", "--diff-filter=U"]).out.split("\n").filter(Boolean);
  if (files.length === 0) throw new Error(`git merge ${target} failed: ${merge.err || merge.out}`);
  return files;
}

/** Files that still have conflict markers. Paths are relative to the worktree root. */
export function filesWithMarkers(top: string, files: string[]): string[] {
  return files.filter((file) => {
    const path = join(top, file);
    // A file that the model deleted has no markers.
    return existsSync(path) && /^(<{7}|>{7})( |$)/m.test(readFileSync(path, "utf8"));
  });
}

/**
 * Finish the merge that startResolveMerge began, after the conflicts are fixed. This adds
 * every change in the worktree, as commitRun does.
 */
export function finishResolveMerge(tree: RunTree): void {
  git(tree.top, ["add", "-A"]);
  git(tree.top, ["commit", "-q", "--no-edit"]);
}

/** Give up on the merge that startResolveMerge began. */
export function abortResolveMerge(tree: RunTree): void {
  run(tree.top, ["merge", "--abort"]);
}

/** Remove the run's worktree and delete its story branch. `repoTop` is any other checkout of the repository. */
export function cleanup(repoTop: string, tree: RunTree): void {
  run(repoTop, ["worktree", "remove", "--force", tree.top]);
  run(repoTop, ["branch", "-D", tree.branch]);
  // Remove runs/<run id>/ if the worktree was the only thing in it.
  const runDir = dirname(tree.top);
  if (existsSync(runDir) && readdirSync(runDir).length === 0) rmdirSync(runDir);
}
