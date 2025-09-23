// apps/mobile/src/features/_shared/useRefetchOnFocus.ts
import * as React from "react";
import { AppState, AppStateStatus } from "react-native";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";

type Opts = {
  /** Delay (ms) before calling refetch after focus/foreground. Default: 0 */
  debounceMs?: number;
  /** Also refetch when app returns to foreground (screen must be focused). Default: true */
  onAppForeground?: boolean;
  /** Fire on the initial mount-focus as well. Default: true */
  fireOnMount?: boolean;
};

/**
 * Calls `refetch` whenever the screen becomes focused.
 * - Optional debounce (to avoid double work during rapid nav).
 * - Optional foreground refetch when app comes back to ACTIVE.
 * - No memory leaks: all timers/listeners are cleaned up.
 */
export function useRefetchOnFocus(
  refetch: () => void | Promise<unknown>,
  opts: Opts = {}
) {
  const { debounceMs = 0, onAppForeground = true, fireOnMount = true } = opts;

  // Keep the latest refetch without re-subscribing listeners
  const refetchRef = React.useRef(refetch);
  React.useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  // Utility: run (debounced) once
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const run = React.useCallback(() => {
    // clear any pending timer first
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (debounceMs > 0) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        refetchRef.current?.();
      }, debounceMs);
    } else {
      refetchRef.current?.();
    }
  }, [debounceMs]);

  // Refetch when the screen gains focus
  useFocusEffect(
    React.useCallback(() => {
      if (fireOnMount) run();

      // Cleanup clears any in-flight debounce timer
      return () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      };
    }, [run, fireOnMount])
  );

  // Optionally refetch when app foregrounds, but only if this screen is focused
  const isFocused = useIsFocused();
  React.useEffect(() => {
    if (!onAppForeground) return;

    const onChange = (state: AppStateStatus) => {
      if (state === "active" && isFocused) {
        run();
      }
    };

    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [onAppForeground, isFocused, run]);

  // Also clear any timer on unmount (belt & suspenders)
  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);
}
