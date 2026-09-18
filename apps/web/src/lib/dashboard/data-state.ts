export type DataStateKind = "loading" | "error" | "empty" | "content";

export type DataState<T> = Readonly<{
  /** Last successful payload; kept while a refresh fails. */
  data: T | null;
  loading: boolean;
  /** Set when the newest attempt failed, even if older data is still shown. */
  error: Readonly<{ code: string; traceId: string | null }> | null;
}>;

export type DataStateEvent<T> =
  | Readonly<{ type: "refresh" }>
  | Readonly<{ type: "loaded"; data: T }>
  | Readonly<{ type: "failed"; code: string; traceId: string | null }>;

export function initialDataState<T>(data: T | null = null): DataState<T> {
  return { data, loading: data === null, error: null };
}

/**
 * Keeps the last good answer visible when a refresh fails: a dashboard that
 * zeroes its cards on a network hiccup would be read as "sales stopped".
 */
export function nextDataState<T>(
  state: DataState<T>,
  event: DataStateEvent<T>,
): DataState<T> {
  if (event.type === "refresh") return { ...state, loading: true };
  if (event.type === "loaded") return { data: event.data, loading: false, error: null };
  return {
    data: state.data,
    loading: false,
    error: { code: event.code, traceId: event.traceId },
  };
}

export function dataStateKind<T>(
  state: DataState<T>,
  isEmpty: (data: T) => boolean,
): DataStateKind {
  if (state.data === null) {
    if (state.error !== null) return "error";
    return state.loading ? "loading" : "empty";
  }
  return isEmpty(state.data) ? "empty" : "content";
}

/** True when content is on screen but the newest refresh failed. */
export function showsStaleContent<T>(state: DataState<T>): boolean {
  return state.data !== null && state.error !== null;
}
