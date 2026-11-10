# LAB-05: Test ship placement errors

Size: S

The controller tests cover the happy path only. Placement errors have no controller test.

Acceptance criteria:
- A test shows that a ship that runs off the board returns 400 with an `error` field.
- A test shows that overlapping ships return 400.
- A test shows that placing the same ship type twice returns 400.
- A test shows that placing a ship after the game starts returns 409.
- No production code changes unless a test finds a bug.
