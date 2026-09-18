import { describe, expect, it } from "vitest";

import {
  dataStateKind,
  initialDataState,
  nextDataState,
  showsStaleContent,
  type DataState,
} from "./data-state";

type Payload = Readonly<{ revenueRub: string; rows: number }>;

const first: Payload = { revenueRub: "7038599.00", rows: 3 };
const isEmpty = (data: Payload): boolean => data.rows === 0;

function loaded(): DataState<Payload> {
  return nextDataState(initialDataState<Payload>(), { type: "loaded", data: first });
}

describe("dashboard data state", () => {
  it("starts in loading and becomes content", () => {
    expect(dataStateKind(initialDataState<Payload>(), isEmpty)).toBe("loading");
    expect(dataStateKind(loaded(), isEmpty)).toBe("content");
  });

  it("keeps the previous result when a refresh fails", () => {
    const refreshing = nextDataState(loaded(), { type: "refresh" });
    const failed = nextDataState(refreshing, {
      type: "failed",
      code: "E_UPSTREAM",
      traceId: "01M2V6QAKXVY2D248F5NYA6FR6",
    });

    expect(failed.data).toEqual(first);
    expect(dataStateKind(failed, isEmpty)).toBe("content");
    expect(showsStaleContent(failed)).toBe(true);
    expect(failed.error?.traceId).toBe("01M2V6QAKXVY2D248F5NYA6FR6");
  });

  it("shows the error state only when there is nothing to keep", () => {
    const failed = nextDataState(initialDataState<Payload>(), {
      type: "failed",
      code: "E_CONFIG_INCOMPLETE",
      traceId: null,
    });

    expect(dataStateKind(failed, isEmpty)).toBe("error");
    expect(showsStaleContent(failed)).toBe(false);
  });

  it("separates an empty answer from a missing one", () => {
    const empty = nextDataState(initialDataState<Payload>(), {
      type: "loaded",
      data: { revenueRub: "0.00", rows: 0 },
    });

    expect(dataStateKind(empty, isEmpty)).toBe("empty");
    expect(showsStaleContent(empty)).toBe(false);
  });

  it("clears the error once a refresh succeeds", () => {
    const failed = nextDataState(loaded(), {
      type: "failed",
      code: "E_UPSTREAM",
      traceId: null,
    });
    const recovered = nextDataState(failed, {
      type: "loaded",
      data: { revenueRub: "1.00", rows: 1 },
    });

    expect(recovered.error).toBeNull();
    expect(showsStaleContent(recovered)).toBe(false);
  });
});
