// apps/mobile/src/features/_shared/Toast.tsx
import React from "react";
import { View, Text } from "react-native";
import { useColors } from "./useColors";

type ToastKind = "success" | "error" | "warning" | "info" | undefined;
type ToastMsg = { id: number; text: string; kind: ToastKind };

const Ctx = React.createContext<{ push: (text: string, kind?: ToastKind, ms?: number) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const t = useColors();
  const [msg, setMsg] = React.useState<ToastMsg | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = React.useCallback((text: string, kind: ToastKind = "success", ms=1800) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const next = { id: Date.now(), text, kind };
    setMsg(next);
    timer.current = setTimeout(() => { setMsg(null); timer.current = null; }, ms);
  }, []);

  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const variantKind = msg?.kind ?? "success";
  const variants: Record<string, { bg: string; fg: string }> = {
    success: { bg: t.colors.success ?? "#0a7", fg: t.colors.buttonText || "#fff" },
    error: { bg: t.colors.danger ?? "#c33", fg: t.colors.buttonText || "#fff" },
    warning: { bg: "#f59e0b", fg: "#111" },
    info: { bg: t.colors.primary ?? "#007aff", fg: t.colors.buttonText || "#fff" },
  };
  const palette = variants[variantKind] ?? variants.success;

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      {msg ? (
        <View style={{
          position: "absolute", left: 12, right: 12, bottom: 12,
          borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12,
          backgroundColor: palette.bg, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 6, elevation: 5,
        }}>
          <Text style={{ color: palette.fg, fontWeight: "700" }}>{msg.text}</Text>
        </View>
      ) : null}
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider />");
  return ctx.push;
}
