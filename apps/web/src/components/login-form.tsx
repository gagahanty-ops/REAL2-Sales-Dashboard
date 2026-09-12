"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type LoginErrorBody = { error?: { message?: string } };

export function LoginForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as LoginErrorBody;
        setError(body.error?.message ?? "Войти не удалось. Попробуйте ещё раз");
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setError("Сервис временно недоступен. Попробуйте ещё раз");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <label className="field">
        Email
        <input
          autoComplete="username"
          inputMode="email"
          name="email"
          required
          type="email"
        />
      </label>
      <label className="field">
        Пароль
        <span className="password-wrap">
          <input
            autoComplete="current-password"
            name="password"
            required
            type={showPassword ? "text" : "password"}
          />
          <button
            aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
            className="button button-secondary"
            onClick={() => setShowPassword((value) => !value)}
            type="button"
          >
            {showPassword ? "Скрыть" : "Показать"}
          </button>
        </span>
      </label>
      {error ? (
        <p aria-live="polite" className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="button" disabled={pending} type="submit">
        {pending ? "Проверяем…" : "Войти"}
      </button>
    </form>
  );
}
