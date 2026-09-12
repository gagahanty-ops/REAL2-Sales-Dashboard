import { redirect } from "next/navigation";

import { AppShell } from "../../../components/app-shell";
import {
  UsersManager,
  type ManagedUserView,
} from "../../../components/users-manager";
import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { listManagedUsers } from "../../../lib/auth/user-admin";
import { getDatabase } from "../../../lib/server/runtime";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  let user;
  try {
    user = requireRole(await requireUser(), ["admin"]);
  } catch {
    redirect("/");
  }

  const users: ManagedUserView[] = (await listManagedUsers(getDatabase())).map(
    (item) => ({
      id: item.id,
      email: item.email,
      fullName: item.fullName,
      role: item.role,
      amoUserId: item.amoUserId,
      isActive: item.isActive,
      updatedAt: item.updatedAt.toISOString(),
    }),
  );

  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Настройки</p>
          <h1>Пользователи и роли</h1>
          <p className="muted">
            Роли проверяются сервером. Отключение сохраняет историю сотрудника.
          </p>
        </div>
      </div>
      <UsersManager initialUsers={users} />
    </AppShell>
  );
}
