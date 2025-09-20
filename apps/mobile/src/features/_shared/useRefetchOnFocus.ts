// apps/mobile/src/features/_shared/useRefetchOnFocus.ts
import * as React from "react";
import { useNavigation, NavigationProp } from "@react-navigation/native";

/**
 * Calls the provided refetch function once whenever the screen gains focus.
 * - Subscribes exactly once (no listener accumulation)
 * - Uses a ref to keep the latest callback without changing the listener
 * - Optional debounce to avoid overlapping with mount renders
 */
export function useRefetchOnFocus(refetch: () => void, options?: { debounceMs?: number }) {
  const navigation = useNavigation<NavigationProp<any>>();
  const ref = React.useRef(refetch);
  const debounceMs = options?.debounceMs ?? 0;

  // Keep latest callback without changing listener identity
  React.useEffect(() => {
    ref.current = refetch;
  }, [refetch]);

  // Subscribe once
  React.useEffect(() => {
    const unsub = navigation.addListener("focus", () => {
      if (debounceMs > 0) {
        const t = setTimeout(() => ref.current?.(), debounceMs);
        return;
      }
      ref.current?.();
    });
    return unsub;
  }, [navigation, debounceMs]);
}
