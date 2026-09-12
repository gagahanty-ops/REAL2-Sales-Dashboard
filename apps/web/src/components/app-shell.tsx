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
            <Link href="/settings/users">Пользователи</Link>
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
