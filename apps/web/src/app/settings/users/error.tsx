"use client";

export default function UsersError({ reset }: { reset: () => void }) {
  return (
    <main className="state-page">
      <section className="state-card">
        <p className="eyebrow">Ошибка</p>
        <h1>Не удалось загрузить пользователей</h1>
        <p className="muted">
          Проверьте подключение и повторите попытку. Технические подробности не
          показываются в браузере.
        </p>
        <button className="button" onClick={reset} type="button">
          Повторить
        </button>
      </section>
    </main>
  );
}
