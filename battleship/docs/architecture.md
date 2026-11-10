# Architecture

Last updated: March 2023

## Overview

Battleship is a Spring Boot application with a layered design:

```
web  ->  service  ->  repository  ->  H2 database
```

## Packages

| Package | Responsibility |
|---|---|
| `web` | REST controllers and request and response objects |
| `service` | Coordinates turns between the player and the computer |
| `model` | Game rules: boards, ships, shots |
| `repository` | `GameRepository`, a Spring Data JPA repository for `Game` entities |

## Persistence

Games are stored in an H2 database. In development, the database runs in memory. The H2 console is at http://localhost:8080/h2-console. In production, H2 runs in file mode so that games survive a restart.

`Game` and `Board` are JPA entities. Ship positions are stored as a JSON column.

## Computer opponent

The computer uses a hunt-and-target strategy. After a hit, it fires at the neighboring cells until it sinks the ship.

## Front end

The web page in `src/main/resources/static` calls the REST API with `fetch`.
