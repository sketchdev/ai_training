# LAB-03: Smarter computer shots

Size: M

Today the computer fires at random cells. It should hunt after a hit.

Acceptance criteria:
- After a HIT, the computer fires next at a cell next to the hit (up, down, left, or right) that it has not fired at.
- When a ship sinks, the computer goes back to random shots unless other unsunk hits remain.
- The computer never fires at the same cell twice.
- Tests use a seeded `Random` and a fixed board to prove the hunt behavior.
- `ComputerOpponent` keeps its two constructors.

Note: the state the computer needs to remember can live in the game or in the opponent. Decide, and write down why.
