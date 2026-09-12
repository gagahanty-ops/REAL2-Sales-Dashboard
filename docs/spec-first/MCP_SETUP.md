# MCP setup policy

## Purpose

MCP connections may help inspect source code, issue trackers, observability, and staging data during implementation. They are optional tooling and do not replace application runtime integrations.

No MCP server is connected or authorized by this repository.

## Allowed capabilities

| Capability | Environment | Access |
|---|---|---|
| Repository and CI inspection | development/staging | read plus pull-request changes approved by the owner |
| Supabase schema and logs | local/staging | read-only; migrations run through reviewed CLI/CI |
| Deployment logs and health | staging/production | read-only |
| Google Drive metadata | staging | read-only until the Sheet publication plan is accepted |

## Forbidden capabilities

- amoCRM mutation tools or generic HTTP tools holding the production OAuth token;
- Google Drive/Sheets access to spreadsheet `123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks`;
- production database SQL write tools;
- secret-manager export or token display;
- tools that can enable `sync_enabled` or `sheet_publish_enabled` without a reviewed release procedure.

## Activation gate

Before an MCP connection is added, record in a reviewed change:

1. exact server/package and pinned version;
2. owner and environment;
3. minimum scopes;
4. read-only enforcement mechanism;
5. secret location and rotation procedure;
6. audit-log location;
7. uninstall/revocation procedure;
8. negative test proving protected resources are inaccessible.

Production MCP access is not required to build or test the MVP. Synthetic fixtures and mock upstream servers remain the default development path.
