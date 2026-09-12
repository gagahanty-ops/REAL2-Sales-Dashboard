"use client";

import { useState, type FormEvent } from "react";

import type { AppRole } from "@real2/db";

export type ManagedUserView = Readonly<{
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
  amoUserId: number | null;
  isActive: boolean;
  updatedAt: string;
}>;

type ApiBody = {
  data?: ManagedUserView;
  error?: { message?: string };
};

const roleLabels: Record<AppRole, string> = {
  admin: "Администратор",
  head: "Руководитель",
  manager: "Менеджер",
};

function numberOrNull(value: FormDataEntryValue | null): number | null {
  const normalized = String(value ?? "").trim();
  return normalized ? Number(normalized) : null;
}

async function readApi(response: Response): Promise<ApiBody> {
  return (await response.json().catch(() => ({}))) as ApiBody;
}

export function UsersManager({
  initialUsers,
}: Readonly<{ initialUsers: readonly ManagedUserView[] }>) {
  const [users, setUsers] = useState([...initialUsers]);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("create");
    setError(null);
    setMessage(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
          fullName: form.get("fullName"),
          role: form.get("role"),
          amoUserId: numberOrNull(form.get("amoUserId")),
        }),
      });
      const body = await readApi(response);
      if (!response.ok || !body.data) {
        setError(body.error?.message ?? "Пользователь не создан");
        return;
      }

      setUsers((current) =>
        [...current, body.data!].sort((a, b) =>
          a.fullName.localeCompare(b.fullName, "ru"),
        ),
      );
      formElement.reset();
      setMessage("Пользователь создан");
    } catch {
      setError("Сервис временно недоступен. Повторите попытку");
    } finally {
      setPending(null);
    }
  }

  async function updateUser(
    user: ManagedUserView,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setPending(user.id);
    setError(null);
    setMessage(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: form.get("fullName"),
          role: form.get("role"),
          amoUserId: numberOrNull(form.get("amoUserId")),
          isActive: form.get("isActive") === "true",
          expectedUpdatedAt: user.updatedAt,
        }),
      });
      const body = await readApi(response);
      if (!response.ok || !body.data) {
        setError(body.error?.message ?? "Изменение не выполнено");
        return;
      }

      setUsers((current) =>
        current.map((item) => (item.id === user.id ? body.data! : item)),
      );
      setMessage(`Доступ для «${body.data.fullName}» обновлён`);
    } catch {
      setError("Сервис временно недоступен. Повторите попытку");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="settings-grid">
      <section className="panel" aria-labelledby="create-user-title">
        <h2 id="create-user-title">Новый пользователь</h2>
        <p className="muted">
          Самостоятельной регистрации нет. Пароль передайте сотруднику по
          защищённому каналу.
        </p>
        <form className="user-form" onSubmit={createUser}>
          <label className="field">
            Имя
            <input name="fullName" minLength={2} required />
          </label>
          <label className="field">
            Email
            <input name="email" type="email" required />
          </label>
          <label className="field">
            Временный пароль
            <input name="password" type="password" minLength={12} required />
          </label>
          <label className="field">
            Роль
            <select defaultValue="manager" name="role">
              {Object.entries(roleLabels).map(([role, label]) => (
                <option key={role} value={role}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            ID в amoCRM
            <input min={1} name="amoUserId" type="number" />
          </label>
          <button className="button" disabled={pending === "create"}>
            {pending === "create" ? "Создаём…" : "Создать"}
          </button>
        </form>
      </section>

      {error ? (
        <p aria-live="polite" className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p aria-live="polite" className="form-success">
          {message}
        </p>
      ) : null}

      <section className="panel" aria-labelledby="users-title">
        <h2 id="users-title">Доступы</h2>
        {users.length === 0 ? (
          <div className="state-card">
            <h3>Пользователей пока нет</h3>
            <p className="muted">Создайте первую учётную запись формой выше.</p>
          </div>
        ) : (
          <div className="users-list">
            {users.map((user) => (
              <form
                className="user-card"
                key={`${user.id}:${user.updatedAt}`}
                onSubmit={(event) => updateUser(user, event)}
              >
                <label className="field">
                  Имя
                  <input defaultValue={user.fullName} name="fullName" required />
                  <span className="user-email">{user.email}</span>
                </label>
                <label className="field">
                  Роль
                  <select defaultValue={user.role} name="role">
                    {Object.entries(roleLabels).map(([role, label]) => (
                      <option key={role} value={role}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  ID в amoCRM
                  <input
                    defaultValue={user.amoUserId ?? ""}
                    min={1}
                    name="amoUserId"
                    type="number"
                  />
                </label>
                <label className="field">
                  Статус
                  <select
                    defaultValue={String(user.isActive)}
                    name="isActive"
                  >
                    <option value="true">Активен</option>
                    <option value="false">Отключён</option>
                  </select>
                  <span
                    className={`status-chip${user.isActive ? "" : " inactive"}`}
                  >
                    {user.isActive ? "Доступ разрешён" : "Доступ отключён"}
                  </span>
                </label>
                <div className="card-actions">
                  <button
                    className="button"
                    disabled={pending === user.id}
                    type="submit"
                  >
                    {pending === user.id ? "Сохраняем…" : "Сохранить"}
                  </button>
                </div>
              </form>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
