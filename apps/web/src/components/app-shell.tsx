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
          <nav className="app-nav" aria-label="Дашборд">
            <Link href="/">Обзор</Link>
            <Link href="/managers">Менеджеры</Link>
            <Link href="/channels">Каналы</Link>
            <Link href="/funnel">Воронка</Link>
            <Link href="/attention">Внимание</Link>
          </nav>
          {user.role === "admin" ? (
            <nav className="app-nav" aria-label="Администрирование">
              <Link href="/settings/pipeline">Настройка воронки</Link>
              <Link href="/settings/channels">Правила каналов</Link>
              <Link href="/settings/integrations/amo">amoCRM</Link>
              <Link href="/settings/users">Пользователи</Link>
              <Link href="/settings/plans">Планы</Link>
              <Link href="/settings/google-sheet">Публикация</Link>
            </nav>
          ) : null}
          {user.role === "admin" || user.role === "head" ? (
            <>
              <Link href="/quality">Качество данных</Link>
              <Link href="/quality/config">Проверка конфигурации</Link>
              <Link href="/sync">Синхронизации</Link>
              <Link href="/snapshots/current">Снимок</Link>
              <Link href="/system">Система</Link>
              <Link href="/alerts">Оповещения</Link>
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
