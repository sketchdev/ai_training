# Lab 1: Story to verified PR

Format: pairs. Time: 35 minutes. Repository: the root of the `battleship` repository. Open your Claude Code session there.

## Steps

1. Start Claude Code in Manual mode. Ask three questions about the repository. Example: "How does a shot get from the controller to the board?"
2. Run `/init`. Remove every line from `CLAUDE.md` that Claude gets right without it. Commit the file on a new branch.
3. Take one ticket from the board. Ask Claude to interview you and write the answers into `SPEC.md`. Use `SPEC-TEMPLATE.md` as a guide.
4. Open a fresh session in plan mode. Challenge the plan. Then let Claude implement the ticket with tests.
5. Run `/context` and `/usage`. Then start a fresh session and ask for a review of the diff.
6. Open a draft pull request. Fill in the template. Add the evidence: test output, the review result, and the cost.

## Pick a ticket

Tickets are in `tickets/`. Each pair takes a different ticket. If your pair is new to Claude Code, start with a small one (size S).

| Ticket | Title | Size |
|---|---|---|
| LAB-01 | List games | S |
| LAB-02 | Delete a game | S |
| LAB-03 | Smarter computer shots | M |
| LAB-04 | Remove old games | M |
| LAB-05 | Test ship placement errors | S |
| LAB-06 | Shot history endpoint | S |
| LAB-07 | Accuracy statistics | M |
| LAB-08 | Show sunk ships on the web page | S |

## Done looks like

- `mvn verify` passes.
- The new behavior has a test.
- A fresh-context review ran and you answered each finding.
- The draft pull request shows the evidence.
- You can say one thing that your expertise changed.
