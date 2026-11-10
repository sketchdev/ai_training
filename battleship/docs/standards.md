# Development standards

Each rule has an ID.

- STD-01: Every new public method has at least one unit test.
- STD-02: Controllers hold no game logic. They call a service and return a view.
- STD-03: Game rules live in the `model` package. The `service` package coordinates only.
- STD-04: Errors return a JSON body with an `error` field and a correct HTTP status.
- STD-05: Code must compile for Java 8. Do not use `var`, `List.of`, records, or text blocks.
- STD-06: Do not log or return the position of the computer's ships.
- STD-07: Do not add a dependency without a note in the pull request that says why.
- STD-08: Use the `javax.*` packages. This project runs on Spring Boot 2.3.
