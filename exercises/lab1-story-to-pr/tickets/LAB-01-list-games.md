# LAB-01: List games

Size: S

As a player, I want to see my open games so that I can return to one.

Acceptance criteria:
- `GET /api/games` returns a JSON array of games.
- Each item shows `id`, `status`, `turns`, and `createdAt`.
- Items do not show ship positions.
- The list is sorted with the newest game first.
- A test covers an empty list and a list with two games.
