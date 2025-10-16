// apps/mobile/src/features/_shared/useRefetchOnFocus.ts
import { useCallback, useEffect } from "react";
import { useFocusEffect } from "@react-navigation/native";

/**
 * Back-compat signature:
 *   useRefetchOnFocus(load)                    // focus only
 *   useRefetchOnFocus(load, [dep1, dep2])      // old array style
 *   useRefetchOnFocus(load, { deps:[...], when:true, refetchOnMount:true }) // new object style
 */
export type RefetchOpts = {
  /** Re-run when these change (also used for focus effect memoization). */
  deps?: any[];
  /** Gate whether we refetch at all (default true). */
  when?: boolean;
  /** Also run once on mount when true (default true). */
  refetchOnMount?: boolean;
};

export function useRefetchOnFocus(
  load: () => void | Promise<void>,
  optsOrDeps?: any[] | RefetchOpts
) {
  const opts: RefetchOpts = Array.isArray(optsOrDeps)
    ? { deps: optsOrDeps }
    : (optsOrDeps ?? {});

  const deps = opts.deps ?? [];
  const when = opts.when ?? true;
  const refetchOnMount = opts.refetchOnMount ?? true;

  // Run once on mount (or when deps change), if enabled
  useEffect(() => {
    if (when && refetchOnMount) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [when, refetchOnMount, ...deps]);

  // Re-run whenever the screen regains focus
  useFocusEffect(
    useCallback(() => {
      if (!when) return;
      void load();
      // no cleanup needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [when, ...deps])
  );
}

export default useRefetchOnFocus;
