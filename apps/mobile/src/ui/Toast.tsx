// apps/mobile/src/ui/Toast.tsx
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { Snackbar } from "react-native-paper";

type ToastEvent = { message: string; duration?: number };

let listeners: Array<(e: ToastEvent) => void> = [];

export function toast(message: string, opts?: { duration?: number }) {
  const ev: ToastEvent = { message, duration: opts?.duration };
  for (const l of listeners) l(ev);
}

export function ToastHost() {
  const [visible, setVisible] = useState(false);
  const [msg, setMsg] = useState("");
  const [duration, setDuration] = useState(2000);

  useEffect(() => {
    const handler = (e: ToastEvent) => {
      setMsg(e.message);
      setDuration(e.duration ?? 2000);
      setVisible(true);
    };
    listeners.push(handler);
    return () => {
      listeners = listeners.filter((l) => l !== handler);
    };
  }, []);

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
    >
      <Snackbar
        visible={visible}
        onDismiss={() => setVisible(false)}
        duration={duration}
      >
        {msg}
      </Snackbar>
    </View>
  );
}
