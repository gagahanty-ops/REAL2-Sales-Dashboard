# REAL2 Project Memory Vault Manifest

Generated: 2026-09-16. Updated: 2026-09-17.

## Location

```text
<repository>/project-memory
(machine arlandorizzi: /Users/arlandorizzi/Desktop/REAL2-Sales-Dashboard/project-memory;
 machine ishop: /Users/ishop/Desktop/REAL2-Sales-Dashboard.nosync/project-memory)
```

## Purpose

Portable project memory for REAL2 Sales Dashboard. Built according to the Obsidian + Claude Code guide:

- concise home/index notes;
- architecture atlas;
- knowledge notes for integrations, decisions, debugging, patterns, business context;
- session log;
- inbox;
- raw context with primary documents and SDD evidence.

Primary private source repository: `https://github.com/sarrinoj-glitch/REAL2-Sales-Dashboard`, default branch `feat/foundation-access`.

## Included

- Obsidian-style Markdown vault.
- `CLAUDE.md` for future agents.
- Current status and continuation instructions.
- Primary project docs copied from the repository.
- All executable plans copied from `docs/superpowers/plans`.
- SDD ledger, task briefs, task reports, and review diffs copied from `.superpowers/sdd`.
- Obsidian guide PDF copied into `raw-context/guide`.
- Memory is embedded directly in the primary source repository under `project-memory/`.
- Repository snapshots, nested `.git`, and source bundles are intentionally excluded to avoid recursive duplication.
- SDD ledger, briefs, reports, and review diffs are tracked explicitly; the copied source `.gitignore` is intentionally omitted.

## Source Repository

Snapshot source:

```text
/Users/arlandorizzi/Desktop/REAL2-Sales-Dashboard
```

Branch:

```text
feat/foundation-access
```

Latest verified and pushed commit:

```text
docs: checkpoint deterministic normalization task (after 4c46499; verify with git ls-remote)
```

Clone the primary repository to obtain code and memory together. Local `.env` variants, generated dependencies, nested repositories, snapshots, and bundles are excluded.

## File Counts At Creation

- Total vault files: 1536
- SDD raw files: 28
- Portable repository snapshot files: 1214
- Worktree-copy evidence files: 247

## Start Here

1. `README.md`
2. `00-home/index.md`
3. `00-home/текущие приоритеты и точка продолжения.md`
4. `00-home/как продолжить проект новому агенту.md`
5. `raw-context/sdd/2026-09-12-03-normalization-metrics/progress.md`

## Non-Negotiable Safety Rules

- Do not use private amoCRM integration.
- Do not modify amoCRM business data.
- Do not write to source Google Sheet `123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks`.
- Do not store real secrets in this vault.
- Plan 2 Task 7 and Plan 3 Task 1 are complete. Plan 3 Task 2 code is complete and review-approved; its DB-backed gate is pending. Run the full gate on a host with local Supabase, then continue with Plan 3 Task 3.
- On macOS with iCloud Desktop sync, keep the working copy in a `.nosync` folder.
