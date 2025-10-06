import * as React from "react";
import { apiClient } from "../../api/client";

export type ScanAction = "receive" | "pick" | "count";

export function useScannerSession() {
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const s = await apiClient.post<{ id: string }>("/scanner/sessions", { op: "start" });
        if (mounted) { setSessionId(s.id); setReady(true); }
      } catch {
        if (mounted) setReady(false);
      }
    })();
    return () => {
      mounted = false;
      if (sessionId) apiClient.post("/scanner/sessions", { op: "stop", sessionId }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = React.useCallback(async (action: ScanAction, epc: string, opts?: { idem?: string }) => {
    if (!sessionId) throw new Error("Scanner session not ready");
    const headers = opts?.idem ? { "Idempotency-Key": opts.idem } : undefined;
    // optional optimistic resolve:
    // await apiClient.get(`/epc/resolve?epc=${encodeURIComponent(epc)}`);
    return apiClient.post("/scanner/actions", { sessionId, epc, action }, headers);
  }, [sessionId]);

  return { sessionId, ready, act };
}
