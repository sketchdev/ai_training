# Day 3: Security, review, and shipping

Defense in layers. No single layer is enough.

1. Permission modes and rules: what Claude may do without asking (allow, ask, deny)
2. Working-directory boundary: writes stay inside the project
3. Bash sandbox: the operating system limits the files and network hosts that shell commands can reach
4. Container or VM: isolation for unattended runs
5. Organization policy: managed settings that developers cannot override
6. Review and tests: machine review, then a human checklist, and tests in CI
7. Audit: telemetry and configuration-change logs

Hooks that block unsafe actions work with layer 1. They fire in every permission mode.

Hooks run with your permissions. Keep them in the plugin repository, review them like code, and test them.

Review commands: `/security-review` and `/code-review`.
