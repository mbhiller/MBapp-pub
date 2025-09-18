import { useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";

/**
 * Calls the provided function whenever the screen gains focus.
 * Accepts any zero-arg function (can return anything).
 */
export function useRefetchOnFocus(fn: () => any) {
  useFocusEffect(
    useCallback(() => {
      void fn();
      return () => {};
    }, [fn])
  );
}
