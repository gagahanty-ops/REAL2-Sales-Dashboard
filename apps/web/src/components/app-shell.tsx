import Link from "next/link";
import type { ReactNode } from "react";

import type { SessionUser } from "../lib/auth/authorization";
import { LogoutButton } from "./logout-button";

const roleLabels = {
  admin: "Администратор",
  head: "Руководитель",
  manager: "Менеджер",
} as const;

export function AppShell({
  user,
  children,
}: Readonly<{ user: SessionUser; children: ReactNode }>) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" href="/">
          РЕАЛ ДВА
        </Link>
        <div className="header-actions">
          {user.role === "admin" ? (
            <nav className="app-nav" aria-label="Администрирование">
              <Link href="/settings/pipeline">Воронка</Link>
              <Link href="/settings/channels">Каналы</Link>
              <Link href="/settings/integrations/amo">amoCRM</Link>
              <Link href="/settings/users">Пользователи</Link>
            </nav>
          ) : null}
          {user.role === "admin" || user.role === "head" ? (
            <>
              <Link href="/quality">Качество данных</Link>
              <Link href="/quality/config">Конфигурация</Link>
              <Link href="/sync">Синхронизации</Link>
            </>
          ) : null}
          <div className="user-identity">
            <span>{user.fullName}</span>
            <span className="role-chip">{roleLabels[user.role]}</span>
          </div>
          <LogoutButton />
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
