# ADR 0001: PostgreSQL 17 for Supabase

- Status: accepted
- Date: 2026-09-12

## Context

The approved draft named PostgreSQL 16. Supabase CLI 2.117.0 rejects
`db.major_version = 16`, while its generated local configuration uses PostgreSQL
17. Keeping an unsupported version in the specification would make the local RLS
test environment impossible to reproduce.

## Decision

Use PostgreSQL 17 in local, staging, and production Supabase environments. Pin
the local major version in `supabase/config.toml` and keep migrations portable
within PostgreSQL 17.

## Consequences

- RLS and migration tests run against the same PostgreSQL major version intended
  for production.
- A future major-version change requires a new ADR and a full migration/RLS test
  run before deployment.
