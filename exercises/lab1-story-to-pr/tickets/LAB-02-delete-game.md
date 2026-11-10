# LAB-02: Delete a game

Size: S

As a player, I want to delete a game so that I can start clean.

Acceptance criteria:
- `DELETE /api/games/{id}` removes the game and returns 204.
- An unknown id returns 404 with the standard error body.
- After deletion, `GET /api/games/{id}` returns 404.
- Tests cover both cases.
