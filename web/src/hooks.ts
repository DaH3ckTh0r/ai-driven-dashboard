import { useCallback, useEffect, useRef, useState } from "react";

export interface Polled<T> {
  data: T | undefined;
  error: string | undefined;
  reload: () => void;
}

/** Loads data on mount and every `intervalMs`. Keeps the last good data when a refresh fails. */
export function usePolling<T>(load: () => Promise<T>, intervalMs: number, deps: unknown[] = []): Polled<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(() => {
    loadRef.current()
      .then((value) => {
        setData(value);
        setError(undefined);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    reload();
    const timer = window.setInterval(reload, intervalMs);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, intervalMs, ...deps]);

  return { data, error, reload };
}

/** Current location hash as a path, e.g. "/issues/abc". */
export function useRoute(): string {
  const read = () => window.location.hash.replace(/^#/, "") || "/monitors";
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export interface UserAction {
  busy: boolean;
  error: string | undefined;
  /** Runs one user-triggered change. Returns undefined when it fails; the error is shown instead. */
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}

/** One user-triggered change at a time: tracks busy and error state, then refreshes the data. */
export function useAction(onDone: () => void): UserAction {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(undefined);
      try {
        const value = await fn();
        onDone();
        return value;
      } catch (err) {
        setError((err as Error).message);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [onDone],
  );
  return { busy, error, run };
}
