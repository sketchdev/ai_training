import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from harness.inputs import (  # noqa: E402
    check_specs,
    fill_placeholders,
    list_files,
    parse_input_flags,
    prompt_block,
    run_title,
    validate_inputs,
)

SPECS = {
    "story": {"kind": "file", "from": "stories/*.md"},
    "repo": {"kind": "path", "default": "repo"},
    "tone": {"kind": "choice", "options": ["short", "long"], "default": "short"},
    "note": {"kind": "text", "required": False},
}


class InputTests(unittest.TestCase):
    """The same cases as harness-ts/tests/launch.test.ts, for the Python rules."""

    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix="inputs-test-"))
        (self.base / "stories").mkdir()
        (self.base / "repo").mkdir()
        (self.base / "stories" / "story-1-list-games.md").write_text("# Story 1: List games\n")
        (self.base / "stories" / "story-2-delete.md").write_text("# Story 2: Delete\n")
        (self.base / "secret.md").write_text("not a story\n")

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def test_specs_need_repo_known_kinds_and_choice_options(self):
        self.assertEqual(check_specs(SPECS), [])
        self.assertEqual(len(check_specs({"story": {"kind": "file"}})), 1)
        self.assertEqual(len(check_specs({"repo": {"kind": "path"}, "x": {"kind": "choice"}})), 1)
        self.assertEqual(len(check_specs({"repo": {"kind": "path"}, "y": {"kind": "nope"}})), 1)

    def test_pattern_lists_matching_files(self):
        self.assertEqual(list_files(self.base, "stories/*.md"), ["stories/story-1-list-games.md", "stories/story-2-delete.md"])
        self.assertEqual(list_files(self.base, "missing/*.md"), [])

    def test_validation_applies_defaults_and_reports_problems(self):
        values, errors = validate_inputs(SPECS, {"story": "stories/story-1-list-games.md"}, self.base)
        self.assertEqual(errors, [])
        self.assertEqual(values, {"story": "stories/story-1-list-games.md", "repo": "repo", "tone": "short"})
        _, errors = validate_inputs(SPECS, {"story": "stories/none.md", "tone": "loud", "extra": "x"}, self.base)
        self.assertEqual(len(errors), 3)
        self.assertEqual(len(validate_inputs(SPECS, {}, self.base)[1]), 1)

    def test_repo_is_required_even_if_marked_optional(self):
        specs = {"repo": {"kind": "path", "required": False}}
        self.assertEqual(validate_inputs(specs, {}, self.base)[1], ['"repo" is required'])

    def test_strict_validation_allows_only_offered_files(self):
        self.assertEqual(validate_inputs(SPECS, {"story": "secret.md"}, self.base)[1], [])
        self.assertEqual(len(validate_inputs(SPECS, {"story": "secret.md"}, self.base, strict=True)[1]), 1)
        self.assertEqual(len(validate_inputs(SPECS, {"story": "stories/../secret.md"}, self.base, strict=True)[1]), 1)

    def test_prompt_sections_placeholders_and_title(self):
        values = {"story": "stories/story-1-list-games.md", "repo": "repo", "tone": "short"}
        self.assertEqual(prompt_block(SPECS, values, self.base), "STORY:\n# Story 1: List games\n\n\nTONE:\nshort")
        self.assertEqual(fill_placeholders('Plan {story} in {tone} form, not {other} or {"json": 1}.', values),
                         'Plan stories/story-1-list-games.md in short form, not {other} or {"json": 1}.')
        self.assertEqual(run_title(SPECS, values, self.base, "wf"), ("story-1-list-games", "# Story 1: List games\n"))
        self.assertEqual(run_title({"repo": {"kind": "path"}}, {"repo": "repo"}, self.base, "My Workflow")[0], "my-workflow")
        asked = {"request": {"kind": "text"}, "repo": {"kind": "path"}}
        self.assertEqual(run_title(asked, {"request": "Add a  game history page, with paging and filters", "repo": "repo"},
                                   self.base, "wf")[0], "add-a-game-history-page-with")

    def test_input_flags_split_at_first_equals(self):
        self.assertEqual(parse_input_flags(["a=1", "b=x=y"]), {"a": "1", "b": "x=y"})
        with self.assertRaises(ValueError):
            parse_input_flags(["novalue"])


if __name__ == "__main__":
    unittest.main()
