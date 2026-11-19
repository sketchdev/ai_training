"""Git operations for the review and merge step of a live run.

A run works in its own worktree on a story branch. After the person approves it in the
dashboard, its changes land on a target branch as one squash commit. These functions take
paths and return results, and change nothing outside the repository they are given.
harness-ts/src/merge.ts has the same functions.
"""
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

# The largest patch that the dashboard gets. The full diff stays in the worktree.
PATCH_LIMIT = 400_000


@dataclass
class RunTree:
    top: Path  # the root folder of the run's worktree
    prefix: str  # the folder that --repo names inside the repository, for example "battleship/"
    branch: str  # the story branch
    base: str  # the commit the run started from


def _run(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)


def git(cwd: Path, *args: str) -> str:
    done = _run(cwd, *args)
    if done.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {(done.stderr or done.stdout).strip()}")
    return done.stdout.strip()


def commit_run(tree: RunTree, message: str) -> bool:
    """Commit every change in the worktree on the story branch, inside the prefix or not, so the
    review, the merge, and the cleanup all see the same files. Returns False if there was nothing to commit."""
    git(tree.top, "add", "-A")
    if _run(tree.top, "diff", "--cached", "--quiet").returncode == 0:
        return False
    git(tree.top, "commit", "-q", "-m", message)
    return True


def has_changes(tree: RunTree, start: str) -> bool:
    """True if the story branch changes anything compared with `start`. This covers the whole
    repository, not only the prefix, because a squash merge takes the whole branch."""
    return _run(tree.top, "diff", "--quiet", start, tree.branch).returncode != 0


def diff_for_review(tree: RunTree, rev_range: str, limit: int = PATCH_LIMIT) -> dict:
    """The diff that the person reviews, one entry per file with its own patch. `rev_range` is
    "<base>..<branch>" or "<target>...<branch>". It covers the whole repository, so that nothing
    merges unseen. Renames show as a delete and an add, and paths are not quoted, so each file's
    patch pairs with its numstat line in order."""
    out = git(tree.top, "-c", "core.quotePath=false", "diff", "--no-renames", "--numstat", "-p", rev_range)
    match = re.search(r"^diff --git ", out, re.MULTILINE)
    stats = (out[: match.start()] if match else out).splitlines()
    patches = re.split(r"^(?=diff --git )", out[match.start():], flags=re.MULTILINE) if match else []
    patches = [p for p in patches if p]
    files, used, truncated = [], 0, False
    for i, line in enumerate(l for l in stats if l):
        added, removed, path = line.split("\t", 2)
        # Binary files show "-" for both counts.
        entry = {"path": path, "added": int(added) if added.isdigit() else 0,
                 "removed": int(removed) if removed.isdigit() else 0}
        if i < len(patches):
            if used + len(patches[i]) <= limit:
                entry["patch"] = patches[i].rstrip("\n")
                used += len(patches[i])
            else:
                truncated = True
        files.append(entry)
    return {"files": files, "truncated": truncated}


def default_branch_name(story_name: str) -> str:
    """"story-1-list-games" becomes "feat/list-games"."""
    slug = re.sub(r"^story-\d+-", "", story_name).lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
    return f"feat/{slug or 'story'}"


def default_commit_message(story: str, story_name: str) -> str:
    """"# Story 1: List games" becomes "feat: list games"."""
    heading = next((line for line in story.splitlines() if line.startswith("# ")), story_name)
    title = re.sub(r"^Story\s+\d+:\s*", "", re.sub(r"^#\s*", "", heading), flags=re.IGNORECASE).strip()
    return f"feat: {title[:1].lower()}{title[1:]}"


def valid_branch_name(cwd: Path, name: str) -> bool:
    return bool(name.strip()) and _run(cwd, "check-ref-format", "--branch", name).returncode == 0


def branch_exists(cwd: Path, name: str) -> bool:
    return _run(cwd, "rev-parse", "--verify", "--quiet", f"refs/heads/{name}").returncode == 0


def find_checkout(cwd: Path, branch: str) -> Optional[Path]:
    """The worktree where `branch` is checked out, if any."""
    path = None
    for line in git(cwd, "worktree", "list", "--porcelain").splitlines():
        if line.startswith("worktree "):
            path = Path(line[len("worktree "):])
        if line == f"branch refs/heads/{branch}":
            return path
    return None


def is_clean(path: Path) -> bool:
    """True if the checkout has no changes to tracked files. Untracked files do not count."""
    return git(path, "status", "--porcelain", "--untracked-files=no") == ""


def squash_merge(tree: RunTree, target: str, message: str, temp_path: Path) -> dict:
    """Squash the story branch into `target`. A missing target starts at the run's start commit.
    The merge happens where the target is checked out, if that checkout is clean, or else in a
    temporary worktree at `temp_path`. On a conflict or a refusal, nothing changes.

    Returns {"kind": "merged", "sha", "where"}, {"kind": "conflict", "files"}, or {"kind": "refused", "reason"}."""
    created = not branch_exists(tree.top, target)
    if created:
        git(tree.top, "branch", target, tree.base)

    def undo(result: dict) -> dict:
        if created:
            _run(tree.top, "branch", "-D", target)
        return result

    where = find_checkout(tree.top, target)
    temporary = False
    if where is not None:
        if not is_clean(where):
            return undo({"kind": "refused", "reason": f"{target} is checked out in {where}, which has uncommitted "
                                                      "changes. Commit or stash them, or pick another branch."})
    else:
        # A failed attempt can leave the temporary worktree behind. Remove it first.
        _remove_worktree(tree.top, temp_path)
        added = _run(tree.top, "worktree", "add", "-q", str(temp_path), target)
        if added.returncode != 0:
            return undo({"kind": "refused", "reason": f"cannot check out {target}: {(added.stderr or added.stdout).strip()}"})
        where, temporary = temp_path, True

    def restore() -> None:
        # Put the checkout back as it was. Safe: it was clean, or a new temporary worktree.
        # Untracked files are kept.
        _run(where, "reset", "-q", "--hard", "HEAD")
        if temporary:
            _remove_worktree(tree.top, temp_path)

    merge = _run(where, "merge", "--squash", tree.branch)
    if merge.returncode != 0:
        files = [f for f in _run(where, "diff", "--name-only", "--diff-filter=U").stdout.splitlines() if f]
        restore()
        if files:
            return undo({"kind": "conflict", "files": files})
        return undo({"kind": "refused", "reason": (merge.stderr or merge.stdout).strip()})
    if _run(where, "diff", "--cached", "--quiet").returncode == 0:
        restore()
        return undo({"kind": "refused", "reason": f"{target} already has every change in this run."})
    commit = _run(where, "commit", "-q", "-m", message)
    if commit.returncode != 0:
        # For example a pre-commit hook rejected it. Leave nothing staged in the checkout.
        restore()
        return undo({"kind": "refused", "reason": f"the commit on {target} failed: {(commit.stderr or commit.stdout).strip()}"})
    sha = git(where, "rev-parse", "--short", "HEAD")
    if temporary:
        _remove_worktree(tree.top, temp_path)
    return {"kind": "merged", "sha": sha, "where": f"branch {target}" if temporary else str(where)}


def _remove_worktree(cwd: Path, path: Path) -> None:
    """Remove a worktree and forget it, if it exists."""
    _run(cwd, "worktree", "remove", "--force", str(path))
    _run(cwd, "worktree", "prune")


def start_resolve_merge(tree: RunTree, target: str) -> list[str]:
    """Merge the target into the story branch. Returns the conflicted files, relative to the worktree root."""
    merge = _run(tree.top, "merge", "--no-edit", "-q", target)
    if merge.returncode == 0:
        return []
    files = [f for f in _run(tree.top, "diff", "--name-only", "--diff-filter=U").stdout.splitlines() if f]
    if not files:
        raise RuntimeError(f"git merge {target} failed: {(merge.stderr or merge.stdout).strip()}")
    return files


_MARKER = re.compile(r"^(<{7}|>{7})( |$)", re.MULTILINE)


def files_with_markers(top: Path, files: list[str]) -> list[str]:
    """Files that still have conflict markers. A file that the model deleted has none."""
    return [f for f in files if (top / f).exists() and _MARKER.search((top / f).read_text(errors="replace"))]


def finish_resolve_merge(tree: RunTree) -> None:
    """Finish the merge that start_resolve_merge began, after the conflicts are fixed. This adds
    every change in the worktree, as commit_run does."""
    git(tree.top, "add", "-A")
    git(tree.top, "commit", "-q", "--no-edit")


def abort_resolve_merge(tree: RunTree) -> None:
    _run(tree.top, "merge", "--abort")


def cleanup(repo_top: Path, tree: RunTree) -> None:
    """Remove the run's worktree and delete its story branch. `repo_top` is any other checkout of the repository."""
    _run(repo_top, "worktree", "remove", "--force", str(tree.top))
    _run(repo_top, "branch", "-D", tree.branch)
    run_dir = tree.top.parent
    if run_dir.exists() and not any(run_dir.iterdir()):
        run_dir.rmdir()
