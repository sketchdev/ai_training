# LAB-06: Shot history endpoint

Size: S

As a player, I want to review every shot in order.

Acceptance criteria:
- `GET /api/games/{id}/history` returns a list of turns in the order they happened.
- Each entry shows who fired, the cell, and the result (MISS, HIT, or SUNK).
- Shots are recorded in the `model` package, not in the controller.
- Tests cover a game with at least three turns.
