export default function UsersLoading() {
  return (
    <main className="content" aria-busy="true" aria-label="Загрузка пользователей">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Настройки</p>
          <h1>Пользователи и роли</h1>
        </div>
      </div>
      <div className="settings-grid">
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    </main>
  );
}
