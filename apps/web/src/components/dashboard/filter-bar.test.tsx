import { parseDashboardFilters } from "@real2/domain";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { dashboardHref } from "../../lib/dashboard/filter-url";
import { DataState } from "../data-state";
import { FilterBar } from "./filter-bar";
import { FreshnessBanner } from "./freshness-banner";

function filters(query: string) {
  return parseDashboardFilters(new URLSearchParams(query), { today: "2026-09-19" });
}

describe("FilterBar", () => {
  it("renders a GET form whose controls all carry labels", () => {
    const html = renderToStaticMarkup(
      <FilterBar action="/dashboard" filters={filters("from=2026-09-01&to=2026-09-30")} />,
    );

    expect(html).toContain('method="get"');
    expect(html).toContain('action="/dashboard"');
    for (const id of ["filter-from", "filter-to", "filter-compare"]) {
      expect(html).toContain(`for="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("Применить");
  });

  it("marks the active channels and the comparison switch", () => {
    const html = renderToStaticMarkup(
      <FilterBar
        action="/dashboard"
        filters={filters("from=2026-09-01&to=2026-09-30&channel=phone_uis&compare=none")}
      />,
    );

    expect(html).toMatch(/id="filter-channel-phone_uis"[^>]*checked/);
    expect(html).not.toMatch(/id="filter-channel-site"[^>]*checked/);
    expect(html).not.toMatch(/id="filter-compare"[^>]*checked/);
  });

  it("offers the manager selector only to leadership", () => {
    const withoutManagers = renderToStaticMarkup(
      <FilterBar action="/dashboard" filters={filters("")} />,
    );
    const withManagers = renderToStaticMarkup(
      <FilterBar
        action="/dashboard"
        filters={filters("manager=amo:7")}
        managers={[{ value: "7", label: "Менеджер один" }]}
      />,
    );

    expect(withoutManagers).not.toContain("filter-manager");
    expect(withManagers).toContain("Весь отдел");
    // Attribute order is React's business; what matters is that the current
    // manager is the selected option and that it is the only one.
    expect(withManagers).toMatch(/<option[^>]*value="7"[^>]*selected|selected[^>]*value="7"/);
    expect(withManagers.match(/selected=""/gu)).toHaveLength(1);
  });

  it("keeps the slice in a shareable link", () => {
    const slice = filters("from=2026-09-01&to=2026-09-30&channel=site&manager=amo:7");

    expect(dashboardHref("/dashboard", slice)).toBe(
      "/dashboard?from=2026-09-01&to=2026-09-30&channel=site&manager=amo%3A7",
    );
  });
});

describe("DataState", () => {
  it("announces loading with a shape-matched skeleton", () => {
    const html = renderToStaticMarkup(<DataState kind="loading" skeletonRows={2} />);

    expect(html).toContain('aria-busy="true"');
    expect(html.match(/skeleton-row/gu)).toHaveLength(2);
  });

  it("explains an error and shows the trace identifier", () => {
    const html = renderToStaticMarkup(
      <DataState
        kind="error"
        errorCode="E_CONFIG_INCOMPLETE"
        traceId="01M2V6QAKXVY2D248F5NYA6FR6"
        retryHref="/dashboard"
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Настройка не завершена");
    expect(html).toContain("01M2V6QAKXVY2D248F5NYA6FR6");
    expect(html).toContain("Повторить");
  });

  it("explains an empty period instead of showing nothing", () => {
    const html = renderToStaticMarkup(<DataState kind="empty" />);

    expect(html).toContain("За выбранный период данных нет");
  });

  it("keeps content on screen with a notice when a refresh failed", () => {
    const html = renderToStaticMarkup(
      <DataState kind="content" stale traceId="01M2V6QAKXVY2D248F5NYA6FR6">
        <p>7 038 599 ₽</p>
      </DataState>,
    );

    expect(html).toContain("Показаны последние доступные данные");
    expect(html).toContain("7 038 599 ₽");
  });
});

describe("FreshnessBanner", () => {
  it("names the snapshot and warns when synchronization lags", () => {
    const html = renderToStaticMarkup(
      <FreshnessBanner
        snapshotVersion={41}
        generatedAt={new Date("2026-09-19T09:00:00Z")}
        sourceFreshAt={new Date("2026-09-19T08:55:00Z")}
        stale
      />,
    );

    expect(html).toContain("Снимок №41");
    expect(html).toContain("Синхронизация отстаёт больше 10 минут");
  });
});
