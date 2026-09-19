import { test as teardown } from "@playwright/test";
import postgres from "postgres";

const TRUNCATE = "truncate table public.system_alerts, public.sheet_publications, public.sheet_layout_mappings, public.sheet_targets, public.current_snapshot, public.stage_snapshot_rows, public.metric_lead_facts, public.metric_cells, public.metric_snapshots, public.sales_plans, public.sync_work_queue, public.sync_critical_alerts, public.raw_retention_proofs, public.data_quality_issues, public.lead_milestones, public.lead_responsible_events, public.lead_stage_events, public.leads, public.pipeline_statuses, public.amo_users, public.amo_api_audit, public.raw_amo_quarantine, public.raw_amo_events, public.raw_amo_objects, public.sync_pages, public.sync_cursors, public.sync_runs, public.config_recalculation_requests, public.config_validations, public.channel_rules, public.pipeline_configs";

/**
 * Leaves the shared local database as the run found it. Without this, the
 * fixtures of the browser gate stay behind and break the database-backed unit
 * tests that expect to be able to wipe users and connections.
 */
teardown("remove the end-to-end fixtures", async () => {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") return;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(TRUNCATE);
    await sql`delete from public.oauth_states`;
    await sql`delete from public.amo_connections`;
    await sql`delete from public.app_users`;
  } finally {
    await sql.end();
  }
});
