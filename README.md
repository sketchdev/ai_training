# Operationalizing Development with Claude Code: course repository

This repository holds the course material. The practice code lives in separate repositories that sit inside this folder. Each one has its own git history, so attendees can branch and open pull requests in it.

## Where to start Claude Code

Start every Claude Code session inside a practice repository, not in this folder. Claude then sees only the code for that exercise.

| Folder | Used on | What it is |
|---|---|---|
| `battleship/` | Days 1 to 3 | A Java 8 and Spring Boot 2.3 game. Attendees work tickets here. |
| `harness-python/` | Day 4, Lab 2 | A Python Agent SDK starter kit. It runs against `battleship/`. |
| `harness-ts/` | Day 4, Lab 2 | The same starter kit in TypeScript. Teams pick one kit. |

## Course material (read it in an editor or browser)

| Folder | Used on | What it is |
|---|---|---|
| `exercises/day1-demos/` | Day 1, facilitator | A local deny rule for the slide 22 demo |
| `exercises/lab1-story-to-pr/` | Day 1, Lab 1 | Tickets, a spec template, and the lab steps |
| `exercises/day2-team-plugin/` | Day 2, build sprint | A starter skeleton for the team plugin |
| `exercises/day3-guardrails/` | Day 3, ship sprint | Hook scripts, a permissions file, and a review checklist |
| `reference/` | All days | Agenda, cheat sheets, and a place for PDFs |

## Set up

The `.gitignore` in this folder lists the practice repositories, so they are not part of this repository's history. Clone each one into this folder, or create it here. See the `README.md` in each practice repository for its own setup.

If you run the course, read `FACILITATOR.md`.
