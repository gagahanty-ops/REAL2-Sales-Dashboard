import { redirect } from "next/navigation";

import { INITIAL_CHANNEL_RULES } from "@real2/domain";

import { AppShell } from "../../../components/app-shell";
import { PipelineConfigManager } from "../../../components/pipeline-config-manager";
import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";

export const dynamic = "force-dynamic";

export default async function PipelineSettingsPage() {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin"]);
  } catch {
    redirect("/");
  }

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Настройки</p>
          <h1>Воронка и этапы</h1>
          <p className="muted">
            Подтвердите имена и ID по live-метаданным до запуска синхронизации.
          </p>
        </div>
      </div>
      <PipelineConfigManager initialChannelRules={INITIAL_CHANNEL_RULES} />
    </AppShell>
  );
}
