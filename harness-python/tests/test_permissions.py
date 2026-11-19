import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from harness.permissions import check_modes, mode_for, mode_options  # noqa: E402


class PermissionTests(unittest.TestCase):
    """The same cases as harness-ts/tests/permissions.test.ts."""

    def test_precedence(self):
        self.assertEqual(mode_for({}, {}, None, False), "dontAsk")
        self.assertEqual(mode_for({}, {}, None, True), "default")
        self.assertEqual(mode_for({}, {"permission_mode": "auto"}, None, True), "auto")
        self.assertEqual(mode_for({"permission_mode": "acceptEdits"}, {"permission_mode": "auto"}, None, True), "acceptEdits")
        self.assertEqual(mode_for({"permission_mode": "acceptEdits"}, {}, "bypassPermissions", True), "bypassPermissions")

    def test_bypass_carries_the_opt_in(self):
        self.assertEqual(mode_options("bypassPermissions")["extra_args"], {"allow-dangerously-skip-permissions": None})
        self.assertEqual(mode_options("acceptEdits"), {"permission_mode": "acceptEdits"})

    def test_interview_needs_dashboard_and_refuses_dont_ask(self):
        interview = {"requires_dashboard": True, "stages": [{"name": "interview"}, {"name": "implement"}]}
        self.assertEqual(check_modes(interview, None, True), [])
        self.assertEqual(len(check_modes(interview, None, False)), 1)
        self.assertEqual(len(check_modes(interview, "dontAsk", True)), 1)
        self.assertEqual(check_modes({**interview, "permission_mode": "dontAsk"}, "acceptEdits", True), [])

    def test_unknown_modes_are_reported(self):
        self.assertEqual(len(check_modes({"permission_mode": "plan", "stages": []}, None, True)), 1)
        self.assertEqual(len(check_modes({"stages": [{"name": "x", "permission_mode": "yolo"}]}, None, True)), 1)


if __name__ == "__main__":
    unittest.main()
