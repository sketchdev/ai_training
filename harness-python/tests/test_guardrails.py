import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from harness.guardrails import check_tool_call  # noqa: E402

PROTECTED = ["pom.xml", ".github/"]


class GuardrailTests(unittest.TestCase):
    def test_blocks_protected_edit(self):
        self.assertIsNotNone(check_tool_call("Edit", {"file_path": "/r/pom.xml"}, PROTECTED))

    def test_allows_source_edit(self):
        self.assertIsNone(check_tool_call("Write", {"file_path": "/r/src/A.java"}, PROTECTED))

    def test_blocks_git_push(self):
        self.assertIsNotNone(check_tool_call("Bash", {"command": "git push origin main"}, PROTECTED))

    def test_allows_mvn(self):
        self.assertIsNone(check_tool_call("Bash", {"command": "mvn verify"}, PROTECTED))


if __name__ == "__main__":
    unittest.main()
