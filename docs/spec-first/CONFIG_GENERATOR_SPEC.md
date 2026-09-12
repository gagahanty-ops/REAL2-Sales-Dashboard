# Configuration generator specification

## Goal

Regenerate the project guidance package from approved normative documents without inventing product behavior, enabling production access, or overwriting unreviewed human additions.

## Inputs

1. `PROJECT_IDEA.md` with approved problem, audience, architecture, phases, and risks.
2. `SPEC.md` with approved module contracts and global invariants.
3. `METRICS_CATALOG.md` with exact metric/date/attribution formulas.
4. `SECURITY_READ_ONLY.md` with protected resources, allowlists, secrets, gates, and incident order.
5. `SPEC_TEMPLATE.md` with the required future-feature structure.

Every input is identified by path and SHA-256 in the generation record. A missing or unapproved input stops generation.

## Deterministic outputs

| Input content | Output |
|---|---|
| mission, architecture, commands, global constraints | `CLAUDE.md` |
| independent review/implementation responsibilities | exactly 5 files in `.claude/agents/` |
| cross-cutting invariants | exactly 4 files in `.claude/rules/` |
| repeated safety/metrics/release procedures | exactly 3 `SKILL.md` files in `.claude/skills/` |
| feature structure | `.claude/templates/feature-spec.md` |
| allowed tooling and scopes | `docs/spec-first/MCP_SETUP.md` |
| input/output hashes and validation result | `docs/spec-first/config-generation-record.json` when an automated generator is implemented |

## Transformation rules

1. Copy exact IDs, hosts, statuses, error codes, roles, timezone, switches, and metric rules from normative inputs.
2. Condense context in `CLAUDE.md`; keep it at or below 120 lines.
3. Assign each agent one primary responsibility and no production-enablement authority.
4. Put a constraint in a rule when it applies to more than one module.
5. Put a sequence in a skill when it must be repeated with evidence.
6. Keep credentials as secret-store names only; never generate a value-shaped credential.
7. Keep MCP disconnected until a separately reviewed connection record satisfies `MCP_SETUP.md`.
8. Render into a temporary directory, validate it, and show a semantic diff before replacing generated files.
9. Preserve any block delimited by `<!-- human:start -->` and `<!-- human:end -->`; reject malformed or overlapping blocks.
10. Exit nonzero on ambiguous, missing, contradictory, or unapproved input.

## Validation contract

Generation succeeds only when all checks pass:

- `CLAUDE.md` has no more than 120 lines;
- agents count is 4–6, rules count is 3–5, skills count is 2–3;
- every Markdown code fence is balanced;
- no unfinished markers exist outside the reusable template;
- protected Sheet ID occurs in `CLAUDE.md`, the integration rule, and read-only skill;
- exact amoCRM host and OAuth-only POST rule occur in project context and integration safeguards;
- no file sets either network switch to true;
- no token, private key, password, or connection-string value matches the secret scanner;
- every module M1–M10 maps to at least one implementation plan task.

## Change policy

A generator implementation is developer tooling, not runtime application code. It may be created after the plan package is accepted. Its golden test compares generated output to the reviewed package byte-for-byte, except for the generation record timestamp and hashes. Any semantic difference requires normal code review; automatic production application is forbidden.
