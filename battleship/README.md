# Battleship: lab repository for the Claude Code training

This repository is the practice codebase for the course "Operationalizing Development with Claude Code". It is a small Battleship game. You play against the computer through a REST API or a plain web page.

The code uses an old stack on purpose: Java 8 and Spring Boot 2.3. Real teams often maintain code like this, and it gives Claude something realistic to work with.

## Requirements

- JDK 8 or JDK 11 (JDK 8 matches CI)
- Maven (optional): the repository includes the Maven wrapper, so use `./mvnw` instead of `mvn`
- A Git client

## Run the game

```bash
./mvnw spring-boot:run
```

Open http://localhost:8080 and click "New game".

## Run the tests

```bash
./mvnw verify
```

## API

| Method and path | What it does |
|---|---|
| `POST /api/games` | Creates a game. The computer places its fleet. |
| `GET /api/games/{id}` | Shows the game. Enemy ship positions stay hidden. |
| `POST /api/games/{id}/ships` | Places one ship. Body: `{"type":"CRUISER","row":0,"col":0,"orientation":"HORIZONTAL"}` |
| `POST /api/games/{id}/ships/random` | Places every ship that you have not placed yet. |
| `POST /api/games/{id}/shots` | Fires a shot. Body: `{"row":3,"col":4}`. The computer fires back. |

If you place all five ships, the game starts. The ships are CARRIER (5), BATTLESHIP (4), CRUISER (3), SUBMARINE (3), DESTROYER (2). Rows and columns run from 0 to 9. Errors return `{"error": "..."}` with status 400, 404, or 409.

## Set up your editor

The repository works in IntelliJ IDEA and in VS Code. Both need a JDK 8 or JDK 11. If you use SDKMAN, run `sdk env install` in the repository root to get the right one.

IntelliJ IDEA:

1. Open the repository folder. IntelliJ imports `pom.xml` as a Maven project.
2. Open File, Project Structure, and set the project SDK to your JDK 8 or 11.
3. Use the shared run configurations "Battleship" and "mvn verify" in the toolbar.

VS Code:

1. Open the repository folder and accept the recommended extensions.
2. If VS Code uses the wrong Java, set `java.configuration.runtimes` in your user settings to point at your JDK 8.
3. Press F5 to run "Battleship (Spring Boot)". Run the task "mvn verify" for tests.

Shared settings live in `.editorconfig`, `.vscode/`, and `.idea/runConfigurations/`. Your personal editor files stay out of git.

## Folder map

| Folder | Purpose |
|---|---|
| `src/` | The Battleship application and its tests |
| `docs/standards.md` | Rules for the `standards-reviewer` subagent (Day 2 and Day 3) |
| `.github/` | CI workflow and pull request template |

## Notes for attendees

Start Claude Code in this folder. The exercise steps, cheat sheets, and Lab 2 starter kit live elsewhere in the course. Claude does not see them here.

This repository does not contain a `CLAUDE.md` file. You create it in Lab 1 with `/init`.

Work on a branch for every ticket. Do not commit to `main`.
