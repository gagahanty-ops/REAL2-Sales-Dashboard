# REAL2 Project Memory Vault Instructions

This folder is the long-term project memory for REAL2 Sales Dashboard.

## On session start

Read:

1. `00-home/index.md`
2. `00-home/текущие приоритеты и точка продолжения.md`
3. `00-home/как продолжить проект новому агенту.md`

If the task touches code, also read:

- `raw-context/project-docs/SPEC.md`
- `raw-context/project-docs/METRICS_CATALOG.md`
- `raw-context/project-docs/SECURITY_READ_ONLY.md`
- the active plan in `raw-context/project-docs/docs/superpowers/plans/`
- the relevant SDD ledger/report in `raw-context/sdd/`

## Non-negotiable constraints

- Use external amoCRM OAuth only.
- Never use a private amoCRM integration.
- Never modify amoCRM business data.
- Never write to source Google Sheet `123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks`.
- Do not put secrets, tokens, OAuth codes, private keys, `.env` values, or personal client data into this vault.
- Treat `raw-context/` as copied evidence; if the live repo changed, verify against `/Users/arlandorizzi/Desktop/REAL2-Sales-Dashboard`.

## On session finish

Create or update a note in `sessions/`.

If a new decision was made, create a note in `knowledge/decisions/`.

If a bug/risk/review finding was found or fixed, create a note in `knowledge/debugging/`.

If a reusable implementation pattern emerged, create a note in `knowledge/patterns/`.

Update `00-home/текущие приоритеты и точка продолжения.md` when the next action changes.
