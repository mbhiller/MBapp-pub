// apps/mobile/src/features/_shared/DateTimeField.tsx
import React from "react";
import { View, Text, Pressable, Modal, Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useColors } from "./useColors";

type Mode = "date" | "time" | "datetime";

export default function DateTimeField({
  label,
  value,
  onChange,
  mode = "datetime",
  placeholder = "Select…",
}: {
  label: string;
  value?: string;
  onChange: (v?: string) => void;
  mode?: Mode;
  placeholder?: string;
}) {
  const t = useColors();
  const [open, setOpen] = React.useState(false);
  const [temp, setTemp] = React.useState<Date>(value ? new Date(value) : new Date());

  // keep internal date in sync if parent changes value
  React.useEffect(() => {
    if (value) setTemp(new Date(value));
  }, [value]);

  const formatted = React.useMemo(() => {
    if (!value) return "";
    const d = new Date(value);
    if (mode === "date") return d.toLocaleDateString();
    if (mode === "time") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }, [value, mode]);

  const isAndroidCombo = Platform.OS === "android" && mode === "datetime";
  const [androidStep, setAndroidStep] = React.useState<"date" | "time">("date");

  const openPicker = () => {
    setAndroidStep("date");
    setOpen(true);
  };
  const closePicker = () => setOpen(false);
  const confirm = (d: Date) => { onChange(d.toISOString()); closePicker(); };

  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: t.colors.muted, marginBottom: 6 }}>{label}</Text>

      {/* Pressable row to avoid TextInput swallowing taps */}
      <Pressable
        onPress={openPicker}
        style={{
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 12,
          backgroundColor: t.colors.card,
        }}
      >
        <Text style={{ color: value ? t.colors.text : t.colors.muted }}>
          {formatted || placeholder}
        </Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={closePicker} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: "#0008", justifyContent: "center", padding: 16 }}>
          <View style={{ backgroundColor: t.colors.card, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border, padding: 12 }}>
            {/* iOS: DateTimePicker supports "datetime" */}
            {Platform.OS === "ios" ? (
              <DateTimePicker
                value={temp}
                // iOS accepts "date" | "time" | "datetime"
                mode={mode as "date" | "time" | "datetime"}
                display="inline"
                onChange={(_, d) => d && setTemp(d)}
              />
            ) : (
              // Android: never pass "datetime" directly
              <>
                {isAndroidCombo ? (
                  androidStep === "date" ? (
                    <DateTimePicker
                      value={temp}
                      mode="date"
                      display="calendar"
                      onChange={(_, d) => { if (d) setTemp(d); setAndroidStep("time"); }}
                    />
                  ) : (
                    <DateTimePicker
                      value={temp}
                      mode="time"
                      display="spinner"
                      onChange={(_, d) => d && setTemp(d)}
                    />
                  )
                ) : (
                  <DateTimePicker
                    value={temp}
                    // Android only: "date" | "time"
                    mode={mode === "time" ? "time" : "date"}
                    display={mode === "time" ? "clock" : "calendar"}
                    onChange={(_, d) => d && setTemp(d)}
                  />
                )}
              </>
            )}

            <View style={{ height: 12 }} />
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
              <Pressable onPress={closePicker} style={{ paddingVertical: 10, paddingHorizontal: 14 }}>
                <Text style={{ color: t.colors.muted, fontWeight: "700" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (isAndroidCombo && androidStep === "date") { setAndroidStep("time"); return; }
                  confirm(temp);
                }}
                style={{ backgroundColor: t.colors.primary, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 }}
              >
                <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>
                  {isAndroidCombo && androidStep === "date" ? "Next" : "Done"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
