# Spec-First configuration package

## Status

Generated from approved `PROJECT_IDEA.md`, `SPEC.md`, `METRICS_CATALOG.md`, and `SECURITY_READ_ONLY.md` on 2026-09-12. This package configures future implementation work; it does not connect to amoCRM, Google, Supabase, or a server.

## Package inventory

| Artifact | Purpose |
|---|---|
| `CLAUDE.md` | concise project context, invariants, architecture, workflow, and checks |
| `.claude/agents/spec-guardian.md` | requirement coverage review |
| `.claude/agents/integration-safety-reviewer.md` | outbound request and secret audit |
| `.claude/agents/data-pipeline-engineer.md` | ingestion, normalization, quality, and metrics |
| `.claude/agents/dashboard-engineer.md` | role-scoped API and UI |
| `.claude/agents/release-verifier.md` | release evidence and go/no-go review |
| `.claude/rules/01-spec-first.md` | approved-document workflow |
| `.claude/rules/02-read-only-integrations.md` | fail-closed external integrations |
| `.claude/rules/03-data-contracts.md` | dates, money, identity, and snapshots |
| `.claude/rules/04-testing-release.md` | automated and operational gates |
| `.claude/skills/real2-readonly-gate/SKILL.md` | repeatable integration safety procedure |
| `.claude/skills/real2-metric-contract/SKILL.md` | repeatable metrics verification procedure |
| `.claude/skills/real2-release-evidence/SKILL.md` | repeatable release evidence procedure |
| `.claude/templates/feature-spec.md` | required shape for future feature specifications |
| `docs/spec-first/MCP_SETUP.md` | allowed MCP capabilities and activation gates |

The package intentionally contains five agents, four rules, three skills, one template, and one MCP policy document. `CLAUDE.md` stays below 120 lines.

## Generation rules

1. Normative facts are copied from approved specifications, not inferred from code.
2. Safety constraints are repeated only where an implementation worker must see them without loading another file.
3. Agents have narrow review or implementation responsibilities.
4. Skills describe deterministic procedures and required evidence.
5. No production secret, token, account credential, or live connector is generated.
6. Any future regeneration must preserve user-authored additions unless they contradict the approved specification.

## Acceptance checks

- `CLAUDE.md` has at most 120 lines.
- There are 4–6 agent definitions, 3–5 rules, and 2–3 local skills.
- Every protected system and kill switch from `SECURITY_READ_ONLY.md` appears in the operational configuration.
- No file enables production sync or publication.
- No file contains a secret-shaped value.
- Every implementation plan names the approved spec and global constraints.
