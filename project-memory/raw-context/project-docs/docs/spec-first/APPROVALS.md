# Specification approvals

| Date | Artifact | Version | Decision | Evidence |
|---|---|---:|---|---|
| 2026-09-12 | `PROJECT_IDEA.md`, `SPEC.md`, `METRICS_CATALOG.md`, `SECURITY_READ_ONLY.md` | 1.0 | approved by the project owner | explicit message «утверждаю» in the project task |
| 2026-09-12 | `SPEC.md` quarantine storage clarification | 1.0.1 | non-behavioral technical clarification | M4.6 already required quarantine; added its missing table contract |
| 2026-09-15 | `SPEC.md` M4/M5 and `METRICS_CATALOG.md` event identity correction | 1.0.2 | review-verified technical correction; no new project-owner approval | [official amoCRM Events API](https://www.amocrm.ru/developers/content/crm_platform/events-and-notes) declares `id` as string and publishes `01pz58t6p04ymgsgfbmfyfy1mf`; composite cross-account deduplication and business rules are unchanged |

Approval of specifications does not authorize production credentials, OAuth installation, server deployment, Google sharing, switch enablement, or publication. Each operational action remains subject to its plan gate and explicit owner action.
