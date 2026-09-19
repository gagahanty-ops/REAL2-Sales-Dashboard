import { describe, expect, it } from "vitest";

import { alertCodeLabel, alertSourceLabel } from "./labels";

describe("alert labels", () => {
  it("names every operational condition the health check can raise", () => {
    expect(alertCodeLabel("sync_stale")).toBe("Синхронизация отстала");
    expect(alertCodeLabel("sheet_checksum_mismatch")).toBe(
      "Контрольная сумма публикации не сошлась",
    );
  });

  it("names the publication error codes the Google client classifies", () => {
    expect(alertCodeLabel("E_SHEET_PROTECTED")).toBe("Запрет: защищённая таблица");
  });

  it("keeps an unknown code readable instead of hiding it", () => {
    expect(alertCodeLabel("brand_new_code")).toBe("brand_new_code");
    expect(alertSourceLabel("brand_new_source")).toBe("brand_new_source");
  });

  it("names the sources an operator sees", () => {
    expect(alertSourceLabel("operations")).toBe("Эксплуатация");
    expect(alertSourceLabel("sheet_publication")).toBe("Публикация в таблицу");
  });
});
