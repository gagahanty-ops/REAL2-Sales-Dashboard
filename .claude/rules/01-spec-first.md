# Rule: approved specification first

- Read `SPEC.md`, `METRICS_CATALOG.md`, `SECURITY_READ_ONLY.md`, and the active plan before changing behavior.
- A changed requirement is first written into the relevant spec and approved; code does not redefine the requirement implicitly.
- Implement one plan task at a time with a failing test, minimal implementation, passing tests, and a focused commit.
- No unfinished marker, vague error handling, unnamed future work, or undocumented interface drift is accepted.
- YAGNI applies: do not add webhook writes, amoCRM mutation, AI scoring, telephony control, or messaging automation to this MVP.
