import { redirect } from "next/navigation";

import { AppShell } from "../components/app-shell";
import { requireUser } from "../lib/auth/require-user";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Рабочее пространство</p>
          <h1>Дашборд отдела продаж</h1>
          <p className="muted">
            Фундамент доступа готов. Метрики будут подключены после теневой
            синхронизации.
          </p>
        </div>
      </div>
      <p className="safe-mode">
        Безопасный режим активен: чтение amoCRM и публикация в Google Sheets
        отключены.
      </p>
    </AppShell>
  );
}
