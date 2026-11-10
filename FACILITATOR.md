# Facilitator notes

This file is not for attendees. It lists what is set up, what is not tested, and what you must do before each day.

Practice code lives in the nested repositories `battleship/`, `harness-python/`, and `harness-ts/`. Course material lives in this repository.

## Status of this repository

- The model and service classes compile with `javac --release 8` and a simulated 200-game run passed.
- `mvn verify` passes on JDK 8 (Zulu 8.0.512) with Maven 3.10: 15 tests, 0 failures. The web page was not opened in a browser.
- The Python starter kit (`harness-python/`) passes its guardrail unit tests. It was not run against the live Agent SDK, so check the option names against the SDK version that you install.
- The TypeScript starter kit (`harness-ts/`) passes `npm test` and `tsc`. It was also not run against the live Agent SDK.
- The hook scripts in `exercises/day3-guardrails/` pass `test-hooks.sh`, including the Stop hook `require-tests-pass.sh` (tested with a fake `./mvnw`). The hooks need `jq` on every lab machine.
- The plugin file formats in `exercises/day2-team-plugin/` follow the course deck. Run `claude plugin validate` before Day 2.

## Gaps left on purpose

The app is correct but small. These gaps give Lab 1 realistic work:

- No endpoint to list or delete games (tickets LAB-01, LAB-02).
- The computer fires at random and never hunts near a hit (LAB-03).
- Games stay in memory forever (LAB-04).
- Controller tests do not cover ship placement errors (LAB-05).
- The API has no shot history or accuracy numbers (LAB-06, LAB-07).
- The web page does not list sunk ships and cannot place ships by hand (LAB-08).

## Before Day 1

1. Push the `battleship` repository to a place where every attendee can open a branch.
2. Make sure CI runs on a pull request.
3. Load the files in `exercises/lab1-story-to-pr/tickets/` onto the ticket board (Trello or the team tracker). One card per file.
4. Dry-run each demo: ask the codebase, `/init`, spec to verified pull request.
5. Before the demo "One task, three modes", copy `exercises/day1-demos/settings.local.json` to `battleship/.claude/settings.local.json` on your machine only. It holds the deny rule on `git push` that the demo needs. See `exercises/day1-demos/README.md`.
6. Do not commit a `CLAUDE.md`. Attendees create one.

## Before Day 2

- Fill in the parking-lot answers slide.
- Pick a fallback backlog item for the skill demo. `exercises/day2-team-plugin/team-plugin/skills/review/SKILL.md` is a ready example.

## Before Day 4

- Make sure that Agent SDK credentials and an approved sandbox (see the agenda).
- Run the `harness-python/README.md` or `harness-ts/README.md` steps once on a practice story.
