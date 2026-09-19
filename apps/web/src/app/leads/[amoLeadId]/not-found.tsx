import Link from "next/link";

/**
 * A lead can be in a snapshot and absent from the normalized layer, for
 * example after it left the configured pipeline. The reader deserves that
 * explanation instead of a bare 404.
 */
export default function LeadNotFound() {
  return (
    <div className="state-page">
      <div>
        <h1>Сделка недоступна</h1>
        <p>
          Её нет в нормализованном слое: она могла уйти в другую воронку, быть
          скрытой правами доступа или ещё не попасть в синхронизацию.
        </p>
        <p>
          <Link href="/attention">Вернуться к списку «Требует внимания»</Link>
        </p>
      </div>
    </div>
  );
}
