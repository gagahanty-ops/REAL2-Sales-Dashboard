---
tags: [real2, decision, spec-first]
date: 2026-09-16
---

# Проект идет по Spec First и изменения сначала сверяются со спецификацией

## Решение

REAL2 ведется по Spec First:

- Layer 1: `PROJECT_IDEA.md`;
- Layer 2: `SPEC.md`;
- normative appendices: `METRICS_CATALOG.md`, `SECURITY_READ_ONLY.md`;
- executable plans: `docs/superpowers/plans/`;
- SDD progress: `.superpowers/sdd/...`.

## Правило

Если код и спецификация расходятся, агент не должен молча менять поведение. Сначала надо зафиксировать техническое уточнение или решение в спецификации/плане, затем менять код.

## Почему

Проект имеет высокий риск: рабочая amoCRM, персональные данные, управленческая отчетность и поддержка amoCRM. Spec First нужен, чтобы не "договариваться в голове" и не менять границы безопасности случайно.

## Гайд

Vault построен по `raw-context/guide/Obsidian_ClaudeCode_Guide.pdf`: короткий `CLAUDE.md`, Obsidian-style knowledge vault, session logs, decision/debugging notes, wiki-links.
