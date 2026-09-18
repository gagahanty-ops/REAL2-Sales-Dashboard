import React from "react";

import type { DashboardFilters } from "@real2/domain";

import { CHANNEL_OPTIONS, selectedManagerValue } from "../../lib/dashboard/filter-url";

export type ManagerOption = Readonly<{ value: string; label: string }>;

export type FilterBarProps = Readonly<{
  action: string;
  filters: DashboardFilters;
  /** Leadership picks a manager; a manager sees only their own portfolio. */
  managers?: readonly ManagerOption[];
}>;

/**
 * A plain GET form: filters live in the URL, the control set works without
 * JavaScript, and every input carries a label, so keyboard and screen-reader
 * use need no extra wiring.
 */
export function FilterBar({ action, filters, managers = [] }: FilterBarProps) {
  const selectedManager = selectedManagerValue(filters);
  return (
    <form className="filter-bar" method="get" action={action}>
      <fieldset>
        <legend>Период</legend>
        <label htmlFor="filter-from">С даты</label>
        <input
          id="filter-from"
          name="from"
          type="date"
          defaultValue={filters.from}
          required
        />
        <label htmlFor="filter-to">По дату</label>
        <input id="filter-to" name="to" type="date" defaultValue={filters.to} required />
      </fieldset>

      <fieldset>
        <legend>Каналы</legend>
        {CHANNEL_OPTIONS.map((option) => (
          <span className="filter-choice" key={option.value}>
            <input
              id={`filter-channel-${option.value}`}
              name="channel"
              type="checkbox"
              value={option.value}
              defaultChecked={filters.channels.includes(option.value as never)}
            />
            <label htmlFor={`filter-channel-${option.value}`}>{option.label}</label>
          </span>
        ))}
      </fieldset>

      {managers.length > 0 ? (
        <fieldset>
          <legend>Менеджер</legend>
          <label htmlFor="filter-manager">Ответственный</label>
          <select id="filter-manager" name="manager" defaultValue={selectedManager}>
            <option value="all">Весь отдел</option>
            <option value="unassigned">Без ответственного</option>
            {managers.map((manager) => (
              <option key={manager.value} value={manager.value}>
                {manager.label}
              </option>
            ))}
          </select>
        </fieldset>
      ) : null}

      <fieldset>
        <legend>Сравнение</legend>
        <span className="filter-choice">
          <input
            id="filter-compare"
            name="compare"
            type="checkbox"
            value="previous"
            defaultChecked={filters.compare}
          />
          <label htmlFor="filter-compare">С предыдущим периодом</label>
        </span>
      </fieldset>

      <button type="submit">Применить</button>
    </form>
  );
}
