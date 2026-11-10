# Human review checklist

Run `/security-review` and `/code-review` first. Then a person checks the items below.

- [ ] The change matches the ticket. Nothing extra.
- [ ] Each new behavior has a test that failed before the change.
- [ ] No secrets, tokens, or real data in the diff.
- [ ] No new dependency, or the pull request explains why.
- [ ] No change to `pom.xml`, CI files, or hooks without a reason in the description.
- [ ] Error cases return the standard error body.
- [ ] The computer's ship positions are never returned or logged.
- [ ] The cost and turn count in the pull request look reasonable.
