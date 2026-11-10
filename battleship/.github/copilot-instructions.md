# Copilot instructions

These instructions help GitHub Copilot generate code that fits this project.

## Language and build

- Target Java 17. Prefer records for request and response objects.
- If the type is obvious, use `var` for local variables.
- Use text blocks for multi-line strings, such as JSON in tests.
- Build with Gradle: `./gradlew build`. Run the app with `./gradlew bootRun`.

## Code style

- Use Lombok (`@Data`, `@Builder`, `@RequiredArgsConstructor`) instead of writing getters and constructors by hand.
- Use `jakarta.validation` annotations on request objects.
- Keep methods short. Prefer streams over loops.

## Persistence

- All game state goes through `GameRepository` (Spring Data JPA, H2 in development).
- Never store games in memory. The app runs as several instances behind a load balancer.

## Tests

- Use JUnit 5 and AssertJ.
- Name tests `methodName_condition_expectedResult`.
