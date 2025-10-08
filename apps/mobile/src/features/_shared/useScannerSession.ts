// apps/mobile/src/features/_shared/useScannerSession.ts
import * as React from "react";
import { apiClient } from "../../api/client";

export function useScannerSession(enabled: boolean) {
  const [sessionId, setSessionId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let ok = true;
    (async () => {
      if (!enabled) return;
      try {
        const res = await apiClient.post<{ id: string }>("/scanner/sessions", { op: "start" });
        if (ok) setSessionId(res.id);
      } catch { /* noop; caller can toast */ }
    })();
    return () => {
      ok = false;
      if (sessionId) apiClient.post("/scanner/sessions", { op: "stop", sessionId }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return sessionId;
}
