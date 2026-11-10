# Operationalizing Development with Claude Code: Agenda V2

**Audience:** Fed development team
**Format:** Four half-days over two weeks (Tuesday and Thursday × 2), 9:00–12:30, one 10-minute break per session
**Deck:** *Operationalizing Development with Claude Code - Training Deck V2.pptx*

## What changed from V1

- **Days 1 and 2 merged.** Core feature fluency and best practices are now one half-day, **Claude Code fundamentals**. It is breadth-first: every topic is covered once, and reference slides move to a hidden appendix.
- **Customization moves to Day 2 and security to Day 3.** Their content is largely unchanged, apart from fixes for the review comments.
- **New Day 4: automating agentic workflows with the Agent SDK.** It is hands-on, and the harness it builds reuses the earlier work: Day 1's workflow map, Day 2's team plugin and Day 3's guardrails.
- **Scheduling and `claude -p` move to Day 4,** where they serve as the first rungs of the "automation ladder."
- **Every comment on the V1 deck has been addressed or logged as an open item.** See the appendix.

## Learning objectives

1. **Claude Code fundamentals.** Execution modes, built-in commands, project memory, context, compaction, tokens and usage. Also best practices for AI development: how developers lead with their expertise even when they aren't writing the code.
2. **Customization.** Skills, commands, subagents, hooks, MCP and plugins.
3. **Security.** Permission rules, sandboxing, guardrail hooks, layered code review and testing.
4. **Automation with the Agent SDK.** Define, execute and iterate on an automated development workflow (a "harness").

## Co-development objectives

1. **Workflow brainstorming** (Day 1): how the team envisions an ideal AI-powered workflow, and which tasks it wants to give to AI. The output is a workflow map, a backlog and a draft working agreement.
2. **Shared team plugin** (Days 2–3): a set of shared skills, subagents and hooks that the team uses and iterates on. v0 is built on Day 2; v1 is hardened and published on Day 3.
3. **Automated workflow harness** (Day 4): one stage of the team's workflow map running headlessly on the Agent SDK. It uses plugin v1, guardrails, structured outputs and run logs.

## At a glance

| | Week 1 · Tue | Week 1 · Thu | Week 2 · Tue | Week 2 · Thu |
|---|---|---|---|---|
| **Learn** | Day 1: Claude Code fundamentals | Day 2: Customization | Day 3: Security, review and shipping | Day 4: Automating workflows with the Agent SDK |
| **Build** | Workflow map, backlog, working-agreement draft | Team plugin v0 | Plugin v1 published | Harness v1 running one workflow |
| **Homework** | Use Claude Code daily; log friction and repeated prompts | Dogfood plugin v0; log issues | Spec the workflow you'd automate | — |

---

## Day 1 · Claude Code fundamentals (Week 1, Tuesday)

**By 12:30:** everyone has worked a real ticket from spec to a draft PR in the lab repo, using three permission modes, a committed `CLAUDE.md` and a fresh-context review. The team has a workflow map, a prioritized backlog for the plugin and a draft of "lines we won't cross."

| Time | Block | Format | Covers |
|---|---|---|---|
| 9:00–9:20 | Welcome, introductions, ground rules | Talk, introductions | Facilitators (Joe, Q), who's in the room, the four-day arc |
| 9:20–9:45 | How Claude Code works | Talk, demo | The agent loop and what happens under the hood; where it runs; context, tokens and price; demo: ask the codebase |
| 9:45–10:15 | Staying in control | Talk, demo | Six permission modes, auto-mode policy (discussion), plan mode (when, what to feed it, what to edit), sessions and undo; demo: one task, three modes |
| 10:15–10:25 | Break | — | |
| 10:25–10:50 | Memory, context and cost | Talk, demo | Commands across a session, `CLAUDE.md`, demo: `/init`, `/context`, `/clear` vs `/compact`, model vs effort, what drives usage, usage monitoring |
| 10:50–11:15 | Working practices | Talk, demo | Expertise is the product; what good looks like; a wish vs a brief; spec interview; breaking work into stories; watching and course-correcting; subagent vs `/btw` vs a fresh session; verification; writer vs reviewer; "is Claude grading its own homework?"; demo: spec to verified PR |
| 11:15–11:50 | **Lab 1: Story to verified PR** | Pairs | Codebase questions → `/init` → spec interview from a board ticket → plan mode → implement with tests → fresh-context review → draft PR with evidence |
| 11:50–12:20 | Workshop: map our workflow | Whole team | Where our time goes and its bottlenecks (8 min) → the ideal AI-powered workflow (10) → impact vs effort, with owners and triggers (7) → lines we won't cross (5) |
| 12:20–12:30 | Wrap-up and homework | Discussion | What you can do now; homework |

**Homework (before Thursday):** use Claude Code on real work every day. Log the friction points and the prompts you type more than once. They are the raw material for Day 2's plugin.

## Day 2 · Customization (Week 1, Thursday)

**By 12:30:** the team has a plugin repo with 3–5 working components built from its own backlog, and every participant has written at least one skill, subagent or hook.

| Time | Block | Format |
|---|---|---|
| 9:00–9:15 | Recap, parking-lot answers, backlog check | Discussion |
| 9:15–9:35 | The extension map: `CLAUDE.md`, skills, subagents, hooks, MCP, plugins; requests vs guarantees; context cost | Talk |
| 9:35–10:05 | Skills and commands; skill-creator; demo: build a skill live | Talk, demo |
| 10:05–10:30 | Subagents; demo: a read-only standards reviewer | Talk, demo |
| 10:30–10:40 | Break | — |
| 10:40–11:05 | Hooks; demo: format on save | Talk, demo |
| 11:05–11:20 | MCP and plugins | Talk |
| 11:20–12:20 | **Build sprint: team plugin v0** | Teams of 2–3 |
| 12:20–12:30 | Wrap-up | Discussion |

**Homework (before Tuesday):** dogfood plugin v0 on real work. Log friction as issues in the plugin repo and finish your component's README.

## Day 3 · Security, review and shipping (Week 2, Tuesday)

**By 12:30:** plugin v1, with guardrail hooks and a reviewer subagent, is published to the team marketplace and enabled in the lab repo, and the working agreement is final.

| Time | Block | Format |
|---|---|---|
| 9:00–9:15 | Recap and dogfooding report | Discussion |
| 9:15–9:50 | The security model for agentic coding: what can go wrong, defense in layers, permission rules, sandbox, organization policy, data and provider | Talk |
| 9:50–10:20 | Hooks as guardrails; demo: two guardrails | Talk, demo |
| 10:20–10:30 | Break | — |
| 10:30–11:05 | Code review and testing; demo: layered review on the Lab 1 PR | Talk, demo |
| 11:05–12:05 | **Ship sprint: harden, publish, govern** (20 minutes each) | Teams of 2–3 |
| 12:05–12:25 | Finalize the working agreement | Whole team |
| 12:25–12:30 | Homework | Individual |

**Homework (before Thursday):** pick one workflow from Day 1's map to automate. Write down its trigger, its stages, the check that proves each stage is done and what a human must approve. This is the spec for Day 4's harness.

## Day 4 · Automating workflows with the Agent SDK (Week 2, Thursday)

**Goal:** attendees can **define, execute and iterate** on an automated development workflow. They build a harness on the Claude Agent SDK that runs one stage of the team's own workflow without a person at the keyboard. It reuses the team plugin, `CLAUDE.md` and the guardrails built earlier in the course.

**By 12:30:** each team has a harness that:
- runs a workflow they defined in a file
- loads plugin v1 and `CLAUDE.md`
- enforces guardrails in code
- hands typed results from stage to stage
- logs every run with its outcome, turns and cost

Each team has also run it on three stories and improved it at least once.

| Time | Block | Format | Covers |
|---|---|---|---|
| 9:00–9:15 | Recap and workflow pick | Discussion | Which workflow do we automate? It should be one stage of the map, already working by hand with plugin v1, with a check that proves it's done |
| 9:15–9:40 | From interactive to automated | Talk, demo | The automation ladder: `/loop` → scheduled tasks and routines → `claude -p` in CI → an Agent SDK harness. Three ways to schedule; non-interactive runs; `claude -p` vs the SDK |
| 9:40–10:10 | Agent SDK essentials | Talk, demo | Claude Code as a library; a first harness with `query()`; options that matter; bringing in the plugin and `CLAUDE.md`; guardrails as code; structured hand-offs; reading the result; demo: hello, harness |
| 10:10–10:20 | Break | — | |
| 10:20–10:35 | Designing a harness | Talk | Define → execute → iterate; the workflow as a spec file; the orchestrator; running it like untrusted code; iterating with evidence |
| 10:35–11:45 | **Lab 2: Build the team's harness** | Teams of 2–3 | Hands-on; see below |
| 11:45–12:05 | Show and tell; where the harness runs | Whole team | One run end to end per team: cost, one failure, one change. Where it runs: on demand, in CI, on a schedule, as a service |
| 12:05–12:20 | Automation in the working agreement; roadmap and retro | Whole team | What may run unattended, what needs a human, who owns each harness and its budget |
| 12:20–12:30 | Self-assessment and close | Individual | |

### Key concepts taught

- **The SDK is Claude Code as a library.** The Agent SDK (`pip install claude-agent-sdk` or `npm install @anthropic-ai/claude-agent-sdk`) provides the same agent loop, tools and context management as Claude Code, driven from Python or TypeScript. `query()` streams messages until Claude finishes and then returns a `ResultMessage` with a subtype, turn count, cost and session ID.
- **Climb the ladder only as far as you need.** `/loop` and scheduled tasks cover polling and timers. `claude -p` covers single headless runs in CI. A harness is for multi-stage workflows where your code must own the loop: gates, retries, typed hand-offs and logs.
- **The harness reuses what the team already built.** `setting_sources=["project"]` loads `CLAUDE.md` and the project's `.claude/` skills and hooks. `plugins=[{"type": "local", "path": "./team-plugin"}]` loads plugin v1. Plugin skills run as `/team-plugin:<skill>`.
- **Guardrails are written in code.** Permission settings decide what may run:
  - `allowed_tools` and `disallowed_tools`
  - `permission_mode="dontAsk"` for unattended runs
  - `max_turns` and `max_budget_usd` as hard limits

  Python hook callbacks (`PreToolUse`, `PostToolUse`, `Stop`) run alongside the plugin's hooks, and a single `deny` blocks the call.
- **Stages hand off structured results.** `output_format` with a JSON Schema (for example, from a Pydantic model) returns validated `structured_output` that the orchestrator can branch on.
- **The roles divide cleanly.** Your code decides *what happens next*: the next stage, a retry or a human. Claude decides *how to do each stage*.
- **Run it like untrusted code.** Use a container or VM and mount only the repo. Credentials are injected by a proxy rather than exposed to the agent. Use `dontAsk` with an explicit allowlist rather than `bypassPermissions`.
- **Iterate with evidence.** Log every message and denial. Track pass rate, turns and cost per run. Re-run a fixed set of stories after each change, and change one thing at a time. `resume` and `fork_session` replay from a known point.

### Lab 2: Build the team's harness (teams of 2–3, 70 minutes)

Starting point: the **harness starter kit** repo (see prep checklist), with plugin v1 and the lab repo beside it.

1. **Run the starter (10 min).** Run the starter harness on one practice story and read the `ResultMessage`: its subtype, turns, cost and session ID.
2. **Bring the team's setup.** Load plugin v1 and `CLAUDE.md`, and confirm they appear in the init message.
3. **Tune the guardrails.** The starter already sets `dontAsk`, a tool allowlist per stage, a `PreToolUse` hook and turn and budget limits. Set the team's protected paths, narrow each stage's allowlist and adjust the limits.
4. **Chain the stages.** Wire up plan → implement → review, with a structured result at each hand-off. Review runs in a fresh session using the plugin's reviewer.
5. **Run three stories.** Log the outcome, turns, cost and pass or fail for each.
6. **Iterate.** Change one thing (a prompt, the tool list, the schema or a skill), re-run the same three stories and compare.

**Stretch goals:** run the harness from a GitHub Actions workflow, or resume a failed run with `resume` and a higher limit.

**Done looks like:** the workflow file and harness are in git, `runs/` holds transcripts and a metrics file for at least six runs, and the team can explain one change it made and what the numbers did.

### Day 4 prerequisites

- Python 3.10+ (or Node 20+) on lab machines or in a lab container.
- **Credentials for the SDK.** The SDK authenticates with an API key from the Claude Console or with cloud-provider credentials (Amazon Bedrock, Google Cloud, Microsoft Foundry). Its docs direct builders to these methods rather than a claude.ai sign-in. Confirm which route the Fed will use.
- An isolated place to run unattended agents (a container or VM) that the security office has approved.

---

## Appendix: V1 deck comments and how V2 handles them

| V1 slide | Comment | V2 change |
|---|---|---|
| 2 | Add an intro slide for Q | New facilitator slide for Q (photo and bio to fill in) |
| 3 | Set the tone with a fun one | Added a bonus prompt: the worst commit message you've pushed |
| 4 | Confirm the days with Adrienne | **Open.** In the speaker notes and prep checklist |
| 5 | Through-line feels shallow and doesn't fit everyone | Rewritten around "You're not doing less. You're managing a team that does more," plus the four-day arc |
| 6 | Might not be a real repo or real tasks | Speaker notes now say "lab repo, realistic tasks." **Open:** confirm the repo |
| 6 | Add "Law of Two Feet" and "Computers for lab sections only" | Added (as "Laptops for labs only") |
| 6 | Add "Focus on the practical" | Added as the first rule |
| 8 | Agenda doesn't match the slides | Every agenda now follows the slide order block by block |
| 9 | Technical peek under the hood | New "Under the hood" slide (request → model → harness runs tools → results go back), which sets up Day 4 |
| 9 | Is this about how the agent functions? | Yes. Slide 9 covers the loop; the new slide covers what the harness does |
| 10 | Talk about the chat side | Covered in the speaker notes |
| 10 | Fed says the desktop app and cloud are unavailable; recommend the desktop app | Caption gives our take. **Open:** Fed confirmation |
| 10 | "Browser" instead of "cloud"; parallel work | Column relabeled "Browser: cloud sessions, run in parallel" |
| 10 | Take a perspective on where to work; teach where students work | Caption: run labs where the team works and recommend the desktop app where allowed |
| 11 | What are tokens and context, why does quality drop, and what about price? | Slide 11 rewritten; new "Tokens and price" slide (output costs 5× input; caching) |
| 14 | Which environment is this for? | Bullet added: "Same modes in the terminal and the IDE" |
| 15 | Pose it as a question | Retitled "What is your auto mode policy?" |
| 16 | How to use plan mode: what to feed it, what you get back, when | New "Plan mode: when, what in, what out" slide |
| 17 | `claude -p` hasn't been introduced yet | Moved to Day 4, where it is a rung on the automation ladder |
| 24 | Settle the demo repo | **Open.** On the prep checklist |
| 25 | What is a token, and token pricing | Covered by the new tokens slide |
| 26 | Breaking work into stories (agile connection) | New "Break the work into stories" slide |
| 30 | Model vs effort, and how to set them | New "Model vs effort" slide |
| 30 | Large `CLAUDE.md` files and images; MCP uses fewer tokens than the UI | Added to "drives it up" and "levers" |
| 31 | `/schedule` depends on the subscription | Footer updated; slide moved to Day 4 |
| 34 | Demo needs a repo with tests in CI | Moved to the appendix. Lab repo requirement is on the checklist |
| 35 | Repo needs branches and a ticket board (Trello?) | On the prep checklist; Lab 1 pulls from the board |
| 36 | Reads like it was written by AI | Replaced with "What you can do now," a list of concrete skills |
| 39 | What does success look like, and what does code review look like? | New "What good looks like" slide; review is covered on the writer-vs-reviewer slides and Day 3 |
| 39 | Day 2 might not be opinionated enough | Same new slide, which takes clear positions |
| 40 | Give the parking lot its own slide on Day 2 | New "Parking lot" slide opens Day 2 |
| 43 | Avoid "tech lead" | Now "A wish vs a brief" |
| 49 | How do we tell Claude to break up the stories? | Stories slide, with the prompt in the speaker notes |
| 51 | Beef it up; how to monitor what's going on | Now "Watch it work": `Ctrl+O` transcript, `Ctrl+T` task list, asking what and why, `Esc` |
| 52 | Subagent vs `/btw` vs a new session | New comparison table |
| 54 | Hooks haven't been covered yet | Hook step removed; hard gates are deferred to Day 2 |
| 55 | Address the absurdity of Claude checking Claude | New slide: "Isn't Claude grading its own homework?" |
| 59 | Need sticky notes and a board | Prep checklist |
| 59 | Where are the bottlenecks? | Added to the workshop prompt |
| 60 | Provocation: do we want a second reviewer? | Added to the slide |
| 61 | Tagging assumes extensions were already taught | Tagging moved to Day 2; Day 1 captures owner and trigger instead |
| 71 | Content contradicts the title | Retitled "What each extension costs in context" |
| 75 | Discussion: project skills for this team | Discussion caption added |
| 77 | Talk about the skill builder | skill-creator card added; demo includes an evaluation step |
| 78 | Lab repo? Homework items might not apply | Demo uses a Day 1 backlog item in the lab repo, with a fallback |
| 81 | An agent that checks internal requirements | Example changed to a `standards-reviewer` subagent, which the demo also uses |
| 99 | Unmanaged, Claude reinvents instead of reusing | Caption added, with the mitigation |
