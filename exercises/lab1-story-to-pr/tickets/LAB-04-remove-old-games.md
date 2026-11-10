# LAB-04: Remove old games

Size: M

Games stay in memory forever. A long-running server will run out of memory.

Acceptance criteria:
- A scheduled job removes games that were created more than 60 minutes ago.
- The age limit is a property in `application.properties`.
- Finished games are removed after 10 minutes.
- A test proves that old games are removed and recent games stay.

Hint: Spring Boot 2.3 supports `@Scheduled` with `@EnableScheduling`. Inject a `java.time.Clock` to make the test simple.
