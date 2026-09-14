import { redirect } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { AmoIntegrationManager } from "../../../../components/amo-integration-manager";
import { requireRole } from "../../../../lib/auth/authorization";
import { requireUser } from "../../../../lib/auth/require-user";
import { getCurrentPublicAmoConnectionStatus } from "../../../../lib/amo/admin";
import { getDatabase } from "../../../../lib/server/runtime";

export const dynamic = "force-dynamic";

export default async function AmoIntegrationsPage() {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin"]);
  } catch {
    redirect("/");
  }

  const status = await getCurrentPublicAmoConnectionStatus(getDatabase());

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Настройки</p>
          <h1>Интеграция amoCRM</h1>
          <p className="muted">Токены и OAuth-секреты остаются только на сервере.</p>
        </div>
      </div>
      <AmoIntegrationManager initialStatus={status} />
    </AppShell>
  );
}
