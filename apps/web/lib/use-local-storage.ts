"use client";

import * as React from "react";

/**
 * Per-viewer preference persisted in localStorage (column visibility, collapsed panels…).
 * Built on useSyncExternalStore so the server render and first client render agree
 * (server snapshot = fallback) and there is no setState-in-effect flash.
 */

const listeners = new Map<string, Set<() => void>>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function useLocalStorageState<T>(key: string, fallback: T): [T, (value: T) => void] {
  const subscribe = React.useCallback(
    (listener: () => void) => {
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      window.addEventListener("storage", listener);
      return () => {
        set.delete(listener);
        window.removeEventListener("storage", listener);
      };
    },
    [key],
  );
  const raw = React.useSyncExternalStore(subscribe, () => read(key), () => null);
  const value = React.useMemo<T>(() => {
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
    // fallback is intentionally not a dependency: callers pass literals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);
  const setValue = React.useCallback(
    (next: T) => {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage unavailable: preference isn't remembered */
      }
      listeners.get(key)?.forEach((listener) => listener());
    },
    [key],
  );
  return [value, setValue];
}
