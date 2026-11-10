---
name: review
description: Review the current branch diff against docs/standards.md. Use before opening a pull request.
---

Review the changes on this branch.

1. Run `git diff main...HEAD` to see the changes.
2. Read `docs/standards.md`.
3. For each rule that the diff breaks, report the rule ID, the file, the line, and a one-line fix.
4. End with a one-line verdict: ready, or not ready.

Do not edit files.
