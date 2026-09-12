import { redirect } from "next/navigation";

import { LoginForm } from "../../components/login-form";
import { requireUser } from "../../lib/auth/require-user";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  try {
    await requireUser();
  } catch {
    return (
      <main className="login-page">
        <section className="login-card" aria-labelledby="login-title">
          <p className="eyebrow">Закрытый контур</p>
          <h1 id="login-title">Дашборд отдела продаж</h1>
          <p className="muted">
            Войдите с учётной записью, которую выдал администратор.
          </p>
          <LoginForm />
        </section>
      </main>
    );
  }

  redirect("/");
}
