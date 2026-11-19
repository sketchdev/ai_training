import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from harness.merge import (  # noqa: E402
    RunTree,
    cleanup,
    commit_run,
    default_branch_name,
    default_commit_message,
    diff_for_review,
    files_with_markers,
    finish_resolve_merge,
    git,
    has_changes,
    squash_merge,
    start_resolve_merge,
)


def stats(files: list[dict]) -> list[dict]:
    return [{k: f[k] for k in ("path", "added", "removed")} for f in files]


class MergeTests(unittest.TestCase):
    """A repository with app/a.txt on main, and a run worktree on a story branch."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="merge-test-"))
        self.main = self.root / "main"
        git(self.root, "init", "-q", "-b", "main", str(self.main))
        for key, value in [("user.email", "test@example.com"), ("user.name", "Test"), ("commit.gpgsign", "false")]:
            git(self.main, "config", key, value)
        (self.main / "README").write_text("readme\n")
        (self.main / "app").mkdir()
        self.write(self.main, "one\ntwo\nthree\n")
        git(self.main, "add", "-A")
        git(self.main, "commit", "-q", "-m", "app")
        base = git(self.main, "rev-parse", "HEAD")
        top = self.root / "runs" / "r1" / "repo"
        git(self.main, "worktree", "add", "-q", "-b", "story/s-r1", str(top), "HEAD")
        self.tree = RunTree(top=top, prefix="app/", branch="story/s-r1", base=base)
        self.temp = self.root / "runs" / "r1" / "merge"

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write(self, checkout: Path, text: str) -> None:
        (checkout / "app" / "a.txt").write_text(text)

    def read(self, checkout: Path) -> str:
        return (checkout / "app" / "a.txt").read_text()

    def test_defaults_come_from_the_story(self):
        self.assertEqual(default_branch_name("story-1-list-games"), "feat/list-games")
        self.assertEqual(default_commit_message("# Story 1: List games\n\nBody", "story-1-list-games"), "feat: list games")

    def test_commit_run_commits_every_change(self):
        self.assertFalse(commit_run(self.tree, "wip"))
        self.write(self.tree.top, "one\nTWO\nthree\n")
        (self.tree.top / "README").write_text("changed outside the prefix\n")
        self.assertTrue(commit_run(self.tree, "wip"))
        self.assertTrue(has_changes(self.tree, self.tree.base))
        diff = diff_for_review(self.tree, f"{self.tree.base}..{self.tree.branch}")
        self.assertEqual(stats(diff["files"]), [
            {"path": "README", "added": 1, "removed": 1},
            {"path": "app/a.txt", "added": 1, "removed": 1},
        ])
        self.assertTrue(diff["files"][1]["patch"].startswith("diff --git a/app/a.txt"))
        small = diff_for_review(self.tree, f"{self.tree.base}..{self.tree.branch}", 10)
        self.assertTrue(small["truncated"])
        self.assertNotIn("patch", small["files"][1])

    def test_squash_into_new_branch_starts_at_the_run_start(self):
        git(self.main, "commit", "-q", "--allow-empty", "-m", "later work on main")
        self.write(self.tree.top, "one\nTWO\nthree\n")
        commit_run(self.tree, "wip")
        self.assertEqual(squash_merge(self.tree, "feat/s", "feat: s", self.temp)["kind"], "merged")
        self.assertEqual(git(self.main, "log", "-1", "--format=%s", "feat/s"), "feat: s")
        self.assertEqual(git(self.main, "rev-parse", "feat/s~1"), self.tree.base)
        self.assertFalse(self.temp.exists())
        self.assertEqual(git(self.main, "log", "-1", "--format=%s"), "later work on main")

    def test_squash_into_clean_checkout_updates_its_files(self):
        self.write(self.tree.top, "one\nTWO\nthree\n")
        commit_run(self.tree, "wip")
        self.assertEqual(squash_merge(self.tree, "main", "feat: s", self.temp)["kind"], "merged")
        self.assertEqual(self.read(self.main), "one\nTWO\nthree\n")

    def test_dirty_checkout_is_refused_and_unchanged(self):
        self.write(self.tree.top, "one\nTWO\nthree\n")
        commit_run(self.tree, "wip")
        self.write(self.main, "local edit\n")
        head = git(self.main, "rev-parse", "HEAD")
        self.assertEqual(squash_merge(self.tree, "main", "feat: s", self.temp)["kind"], "refused")
        self.assertEqual(self.read(self.main), "local edit\n")
        self.assertEqual(git(self.main, "rev-parse", "HEAD"), head)

    def test_conflict_leaves_target_unchanged_and_fix_merges(self):
        self.write(self.main, "one\nMAIN\nthree\n")
        git(self.main, "commit", "-q", "-am", "main changes line two")
        self.write(self.tree.top, "one\nSTORY\nthree\n")
        commit_run(self.tree, "wip")
        head = git(self.main, "rev-parse", "HEAD")

        self.assertEqual(squash_merge(self.tree, "main", "feat: s", self.temp), {"kind": "conflict", "files": ["app/a.txt"]})
        self.assertEqual(git(self.main, "rev-parse", "HEAD"), head)
        self.assertEqual(git(self.main, "status", "--porcelain"), "")

        conflicted = start_resolve_merge(self.tree, "main")
        self.assertEqual(conflicted, ["app/a.txt"])
        self.assertEqual(files_with_markers(self.tree.top, conflicted), ["app/a.txt"])
        self.write(self.tree.top, "one\nMAIN and STORY\nthree\n")  # what the resolve stage does
        self.assertEqual(files_with_markers(self.tree.top, conflicted), [])
        finish_resolve_merge(self.tree)

        diff = diff_for_review(self.tree, f"main...{self.tree.branch}")
        self.assertEqual(stats(diff["files"]), [{"path": "app/a.txt", "added": 1, "removed": 1}])
        self.assertEqual(squash_merge(self.tree, "main", "feat: s", self.temp)["kind"], "merged")
        self.assertEqual(self.read(self.main), "one\nMAIN and STORY\nthree\n")

    def test_each_file_gets_its_own_patch_for_rename_and_unusual_path(self):
        git(self.tree.top, "mv", "app/a.txt", "app/b.txt")
        (self.tree.top / "app" / "naïve file.txt").write_text("new\n")
        commit_run(self.tree, "wip")
        files = diff_for_review(self.tree, f"{self.tree.base}..{self.tree.branch}")["files"]
        self.assertEqual(sorted(f["path"] for f in files), ["app/a.txt", "app/b.txt", "app/naïve file.txt"])
        for f in files:
            self.assertTrue(f"a/{f['path']}" in f["patch"] or f"b/{f['path']}" in f["patch"], f["path"])

    def test_review_diff_covers_files_outside_the_prefix(self):
        self.write(self.tree.top, "one\nTWO\nthree\n")
        commit_run(self.tree, "wip")
        (self.tree.top / "README").write_text("changed by a conflict fix\n")
        git(self.tree.top, "commit", "-q", "-am", "root change")
        files = diff_for_review(self.tree, f"{self.tree.base}..{self.tree.branch}")["files"]
        self.assertEqual(sorted(f["path"] for f in files), ["README", "app/a.txt"])

    def test_rejected_commit_leaves_checkout_clean_and_removes_new_branch(self):
        self.write(self.tree.top, "one\nTWO\nthree\n")
        commit_run(self.tree, "wip")
        # A pre-commit hook that rejects every commit. Set hooksPath here, so a global one does not apply.
        hooks = self.root / "hooks"
        hooks.mkdir()
        hook = hooks / "pre-commit"
        hook.write_text("#!/bin/sh\necho rejected >&2\nexit 1\n")
        hook.chmod(0o755)
        git(self.main, "config", "core.hooksPath", str(hooks))

        head = git(self.main, "rev-parse", "HEAD")
        self.assertEqual(squash_merge(self.tree, "main", "feat: s", self.temp)["kind"], "refused")
        self.assertEqual(git(self.main, "status", "--porcelain", "--untracked-files=no"), "")
        self.assertEqual(git(self.main, "rev-parse", "HEAD"), head)
        self.assertEqual(squash_merge(self.tree, "feat/new", "feat: s", self.temp)["kind"], "refused")
        self.assertEqual(git(self.main, "branch", "--list", "feat/new"), "")
        self.assertFalse(self.temp.exists())

    def test_leftover_temporary_worktree_does_not_block_merge(self):
        self.write(self.tree.top, "one\nTWO\nthree\n")
        commit_run(self.tree, "wip")
        git(self.main, "branch", "feat/s")
        git(self.main, "worktree", "add", "-q", "--detach", str(self.temp), "feat/s")  # left behind by a crash
        self.assertEqual(squash_merge(self.tree, "feat/s", "feat: s", self.temp)["kind"], "merged")

    def test_conflict_outside_the_prefix_can_be_resolved(self):
        (self.main / "README").write_text("main readme\n")
        git(self.main, "commit", "-q", "-am", "main changes the readme")
        (self.tree.top / "README").write_text("story readme\n")
        git(self.tree.top, "commit", "-q", "-am", "story changes the readme")
        conflicted = start_resolve_merge(self.tree, "main")
        self.assertEqual(conflicted, ["README"])
        (self.tree.top / "README").write_text("merged readme\n")
        finish_resolve_merge(self.tree)
        self.assertEqual(git(self.tree.top, "status", "--porcelain", "--untracked-files=no"), "")
        self.assertEqual(len(git(self.tree.top, "log", "-1", "--format=%p").split()), 2)

    def test_cleanup_removes_worktree_and_branch(self):
        cleanup(self.main, self.tree)
        self.assertFalse(self.tree.top.exists())
        self.assertFalse((self.root / "runs" / "r1").exists())
        self.assertEqual(git(self.main, "branch", "--list", self.tree.branch), "")


if __name__ == "__main__":
    unittest.main()
