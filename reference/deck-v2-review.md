# Training Deck V2 review

Date: 2026-11-10

This report compares "Operationalizing Development with Claude Code - Training Deck V2.pptx" with two things, in order: (1) the learning objectives, and (2) the code in this repository. Slide numbers are positions in the V2 file.

Sources: all 152 slides and speaker notes (14 slides are a hidden appendix), `Fed AI Training.md`, `Fed AI Training - Agenda V2.md`, `reference/agenda-v2.md`, the cheat sheets, `exercises/`, `harness-python/`, `harness-ts/`, and `battleship/`.

## Status of findings

| Section | Status |
|---|---|
| 1.1 Two objective lists | Confirmed. The client accepts the Agenda V2 list. `Fed AI Training.md` now holds that list. |
| 1.2 Coverage | Information only |
| 1.3 Time risk on Day 1 | Deferred. Participants already use Claude Code extensively, so the light treatment of basics is intended. |
| 1.4 Alignment items | Applied 2026-11-10. Slide 5 is fixed in "Training Deck V2.1.pptx". The Day 3 cheat sheet and `reference/agenda-v2.md` now match. |
| 2.1 Day 4 starter kit | Applied 2026-11-10. Slides are fixed in "Training Deck V2.1.pptx" (V2 is unchanged). The four kit defects are fixed in both kits. |
| 2.2 Days 2 and 3 code slides | Applied 2026-11-10 in "Training Deck V2.1.pptx" and in `exercises/`. |
| 2.3 Day 1 demo prompts | Applied 2026-11-10 in "Training Deck V2.1.pptx". |

## Part 1. Deck against the learning objectives

### 1.1 Two different objective lists exist

`Fed AI Training.md` has the original four objectives: core feature fluency, customization, best practices, security. Agenda V2 has a new four: fundamentals (which absorbs best practices), customization, security, and Agent SDK automation. The deck follows Agenda V2 (slides 8, 49, 82, 108 notes and the self-assessment on slide 135).

Status: confirmed. The client accepts the V2 list, which adds a full Agent SDK day and merges best practices into Day 1. `Fed AI Training.md` now holds the V2 list, so only one list exists.

### 1.2 Coverage by objective

| Objective (Agenda V2) | Coverage | Gaps |
|---|---|---|
| 1. Fundamentals: modes, commands, memory, context, compaction, tokens, usage, best practices | Strong. Slides 10–47. | Compaction gets one visible slide (27). The detail is on hidden slides 142–143. Scoped rules and auto memory are on hidden slide 141. The original objective named "scheduled tasks" under fluency. V2 moves them to Day 4 (slides 111–112), so they now teach automation, not fluency. |
| 2. Customization: skills, commands, subagents, hooks, MCP, plugins | Strong for skills, subagents, hooks, plugins. | MCP has one slide (76) and no demo. Slide 5 lists Day 2 as "Skills, subagents, hooks, plugins" and omits MCP. |
| 3. Security: permission rules, sandboxing, guardrail hooks, layered review, testing | Complete. Slides 85–102. | None against the objective. |
| 4. Agent SDK: define, execute, iterate | Complete. Slides 110–131, with slide 123 as the frame. | The code on these slides does not match the starter kits. See Part 2. |
| Co-dev 1, 2, 3 | Workshop slides 43–46, sprints 79 and 103–105, Lab 2 slide 128. | None. |

### 1.3 Time risk on Day 1

Objective 1 is the widest, and Day 1 carries it. The 10:50–11:15 block has 11 slides plus a demo in 25 minutes (slides 31–41). Lab 1 has six steps, including a spec interview, implementation and review, in 35 minutes (slide 42). The Day 1 outcome in the agenda says "using three permission modes", but Lab 1 names only Manual and plan mode.

Status: deferred. Participants already use Claude Code extensively, so the de-emphasis on basics is intended. The items below stay on record for later.

Possible changes, on hold:
- Make the slide 41 demo optional in the agenda too, not only in the notes.
- Point Lab 1 pairs at size S tickets (LAB-01, 02, 05, 06, 08).
- Add "continue in acceptEdits" to Lab 1 step 4, or drop "three permission modes" from the outcome.
- Unhide slide 142 (compaction) if time allows, because compaction is named in objective 1.

### 1.4 Smaller alignment items

Status: applied. The Day 3 cheat sheet now lists the seven layers from slide 86, in the same order. The two agenda copies now differ only in table spacing.

- Slide 5: add MCP to the Day 2 subtitle.
- Slide 86 lists seven security layers. `reference/cheatsheets/day3-security.md` lists six, in a different order, without the working-directory boundary or audit. Make them match.
- `reference/agenda-v2.md` differs from the Documents copy in one line: the starter-kit prep item is unchecked in the repository copy. Sync them.

## Part 2. Deck code against the repository

The general problem: Days 1–3 demos and the Day 4 code slides use a generic Node.js example (`npm test`, `src/auth/`, a signup form, `/migrations/`). The lab repository is Java 8 and Maven (`battleship/`). The Day 4 slides also describe a starter kit layout that is not the one in the repository.

### 2.1 High priority: Day 4 starter kit (attendees open these files during Lab 2)

Status: applied. Slide 128 step 3 now says "Tune the guardrails", and the kit READMEs and both agenda copies match. The code panels on slides 116, 119 and 124 are 15 points taller to fit one more line. Nobody has viewed the slides in PowerPoint yet.

| Slide | Deck says | Repository has | Suggested change |
|---|---|---|---|
| 129 | `harness-starter/` with `harness.py`, `stages.py`, `guardrails.py`, `schemas/` folder | `harness-python/harness/orchestrator.py`, `guardrails.py`, `schemas.py`. No `stages.py`. A second kit, `harness-ts/`, exists. | Redraw the tree from `harness-python/`. Add one line for `harness-ts/`. Remove the "has to be built" prep note. |
| 122 | `python harness.py --story STORY-12` | `python -m harness.orchestrator workflows/story-to-pr.yaml stories/story-1-list-games.md --repo ../battleship` (`harness-python/README.md:27`) | Use the real command. Replace `pip install claude-agent-sdk` with the venv and `pip install -r requirements.txt` steps. |
| 124 | YAML keys `tools`, `gate`, `skill`, `output: schemas/plan.json`, `Bash(npm test)` | `workflows/story-to-pr.yaml` uses `allowed_tools`, `prompt`, `check`, `protected_paths`, `fresh_session`, `Bash(mvn:*)` | Show an excerpt of the real file. Cite its path. |
| 120 | `Review` model: `verdict`, `issues`, `tests_passed` | `harness/schemas.py:19` `ReviewResult`: `verdict`, `findings` | Use `ReviewResult` from `schemas.py`. Align the notes with `Plan` (`files_to_change`, `tests_to_add`, `risks`) and `ImplementResult` (`branch`, `tests_passed`, `summary`). |
| 119 | Inline `protect_paths()` with `.env` and `/migrations/`, matcher `Write\|Edit` | `harness/guardrails.py`: `check_tool_call()` plus `make_pre_tool_use_hook()`, matcher `Edit\|Write\|Bash`, paths from the YAML (`pom.xml`, `.github/`, `.env`) | Show `make_pre_tool_use_hook` and cite the file. Mention that `check_tool_call` is unit tested without credentials. |
| 116 | `src/auth/`, `Bash(npm test)`, `acceptEdits` | Battleship, `mvn verify`, `dontAsk` | Change the prompt to a Battleship task and the tool to `Bash(mvn:*)`. Keep `acceptEdits` if the point is interactive-to-unattended contrast, but say so. |
| 118 | Paths `/work/lab-repo`, `/work/team-plugin` | TODO in `orchestrator.py:37` uses `../team-plugin` | Use the same relative paths as the TODO. |
| 128 step 3 | "Add guardrails: dontAsk, an allowlist, one PreToolUse hook" | The starter already sets `dontAsk`, per-stage `allowed_tools`, a `PreToolUse` hook, `max_turns` and `max_budget_usd` (`orchestrator.py:25-36`) | Either remove these from the starter so the lab step has work, or reword step 3 as "tune the guardrails for your protected paths". The same text is in both kit READMEs and in Agenda V2. |
| 115 notes, Agenda prereqs | Node 18+ | `harness-ts/package.json` requires Node 20+ | Change to Node 20+. |

Repository defects found while checking slide 118 and Lab 2. These are not deck fixes, but the deck walks attendees into them:
- The review stage allowlist (`story-to-pr.yaml:33`) does not include `Skill`. Under `dontAsk`, `/team-plugin:review` is denied when teams add the plugin. Slide 118 includes `Skill`. Add it to the YAML, or warn in the slide 128 notes.
- The implement stage allows `Bash(mvn:*)`, but `battleship/README.md` tells attendees to use `./mvnw`. If Maven is not installed, the stage fails on a denied tool. Allow `Bash(./mvnw:*)` too.
- `fresh_session: true` in the YAML is not read by either orchestrator. Every `query()` is already a new session. Remove the key or explain it.
- Lab step 5 asks for pass or fail per story. `metrics.csv` has no pass or fail column.

### 2.2 Medium priority: Days 2 and 3 code slides with a repository counterpart

Status: applied. Decisions: the repository hooks now read their input with `jq`, the same as slide 73. All permission rules use the trailing ` *` wildcard (for example `Bash(git diff *)`) in the deck, both workflow files and `settings.example.json`. `settings.example.json` gained an `ask` rule for `git push` and the new Stop hook `require-tests-pass.sh`, and `test-hooks.sh` tests that hook. The `format-java.sh` script still only checks for tabs. The slide 75 notes now say so. The code panel on slide 73 is 15 points taller. Nobody has viewed the slides in PowerPoint yet.

| Slide | Deck says | Repository has | Suggested change |
|---|---|---|---|
| 67, 70 | `standards-reviewer` frontmatter and body | `exercises/day2-team-plugin/team-plugin/agents/standards-reviewer.md` (matches) and `battleship/docs/standards.md` | Already consistent. Add the file path as a caption. |
| 77 | `agents/reviewer.md`, `.mcp.json` | `agents/standards-reviewer.md`. No `.mcp.json`. | Rename to `standards-reviewer.md`. Mark `.mcp.json` as optional. |
| 75 | "Runs our formatter after every Edit or Write" | `hooks/format-java.sh` checks for tabs and exits 2. It does not format. | Either say "a starter check, replaced by a formatter" or make the script format. Also note that exit 2 on PostToolUse cannot undo the edit; it only sends the message back to Claude. |
| 73, 56 | Bash hook with `jq`, matches `*.env*` | `exercises/day3-guardrails/hooks/block-protected-paths.sh` uses `python3` to parse JSON and also blocks `pom.xml` and `.github/workflows/` | Show `block-protected-paths.sh` instead, or switch the repository hooks to `jq`. Use one JSON parser in both. |
| 96 | Demo: PreToolUse `.env` block and a Stop hook that waits for tests | The `.env` block exists. No Stop hook exists in the repository. | Add `hooks/require-tests-pass.sh` to `exercises/day3-guardrails/` and to `test-hooks.sh`, or change the demo. |
| 87 | `Bash(npm test)`, `Bash(npm run lint)`, ask on `Bash(git push *)`, deny `Bash(curl *)` | `exercises/day3-guardrails/settings.example.json`: `Bash(mvn verify)`, `Bash(git diff:*)`, deny `Read(./.env)`, `Bash(curl:*)` | Show the real file. Pick one wildcard style (`git push *` or `git:*`) and use it in the deck, the YAML and `settings.example.json`. |
| 93, 119 | "migrations" as a protected path | Battleship has no migrations | Replace with `pom.xml` and `.github/workflows/`, which the repository protects. |
| 104 | `<marketplace>`, `<plugin repo>` placeholders | `marketplace.json` name is `fed-team-marketplace`; `plugin.json` version is `0.0.1` | Fill in the real names, or add them to the notes. |
| 59 | `summarize-changes` skill example | `team-plugin/skills/review/SKILL.md` | Optional: keep the docs example, then show `review/SKILL.md` as "the one in your starter". |

### 2.3 Low priority: Day 1 demo prompts that do not fit the lab repository

Status: applied, with two changes to the suggestions. Battleship already rejects a repeat shot (`Board.fire`) and shots outside the board, so neither suggested example was a real gap. Slide 33 now uses ticket LAB-03 (the computer fires at random after a hit), and slide 22 plans ticket LAB-02 (`DELETE /api/games/{id}`). Nobody has viewed the slides in PowerPoint yet.

| Slide | Deck says | Battleship reality | Suggested change |
|---|---|---|---|
| 15 | "How does logging work?", "Where do we handle auth?" | No logging and no auth | Use the Lab 1 example: "How does a shot get from the controller to the board?" Also: "Where are the computer's ships hidden from the API?" |
| 22 | "add input validation to the signup form" | No signup form. `FireRequest` and `PlaceShipRequest` have `@NotNull` but no 0–9 range check. | "add range validation (0–9) to FireRequest and PlaceShipRequest" |
| 33 | Login bug in `src/auth/` | No auth | A Battleship brief, for example: "Firing at a cell twice counts as a new turn. Check `Board` and `GameService`. Write a failing test first." Confirm the bug exists first, or phrase it as an example. |
| 113 | `npm test` in `claude -p` examples | `mvn verify` | Replace with `./mvnw verify`. |
| 42 | Ticket board | `exercises/lab1-story-to-pr/tickets/LAB-01..08` and `SPEC-TEMPLATE.md` | Add the folder path to the slide or notes. |

### 2.4 Already consistent (no change)

- Slide 42 Lab 1 steps match `exercises/lab1-story-to-pr/README.md`.
- Slide 128 Lab 2 steps match both kit READMEs (apart from step 3 above).
- Slide 118 `/team-plugin:review` matches the starter skill name.
- Slide 121 subtypes and slide 116 `ResultMessage` fields match what `orchestrator.py` reads.
- `battleship/.github/pull_request_template.md` matches the evidence ask on slides 41–42.

## Suggested order of work

1. Done: the client confirmed the V2 objective list (1.1), and `Fed AI Training.md` is updated.
2. Fix the Day 4 slides 115–129 and the four repository defects in 2.1. Attendees type these commands.
3. Fix the Days 2–3 slides in 2.2. Add the missing Stop hook.
4. Swap the Day 1 demo prompts in 2.3 to Battleship.
5. Apply the alignment items in 1.4. (1.3 is deferred.)
