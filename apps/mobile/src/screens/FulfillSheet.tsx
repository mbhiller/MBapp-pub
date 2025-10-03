import React from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useColors } from "../features/_shared/useColors";
import type { components } from "../api/generated-types";
import { fulfillSO } from "../features/salesOrders/actions";
type Schemas = components["schemas"];

export default function FulfillSheet({
  soId,
  lines,
  onDone,
}: {
  soId: string;
  lines: Schemas["SalesOrder"]["lines"] | undefined;
  onDone: () => void;
}) {
  const t = useColors();
  const [qtys, setQtys] = React.useState<Record<string, string>>({});
  const [carrier, setCarrier] = React.useState("");
  const [tracking, setTracking] = React.useState("");

  const remaining = (l: any) => Math.max(0, Number(l.qty ?? 0) - Number(l.qtyFulfilled ?? 0));

  const onSubmit = async () => {
    const body = {
      carrier: carrier.trim() || undefined,
      tracking: tracking.trim() || undefined,
      lines: (lines ?? [])
        .map((l: any) => {
          const rem = remaining(l);
          const input = Number(qtys[l.id!] ?? 0);
          const delta = Number.isFinite(input) && input > 0 ? Math.min(input, rem) : 0;
          return delta > 0 ? { lineId: String(l.id), deltaQty: delta } : null;
        })
        .filter(Boolean) as { lineId: string; deltaQty: number }[],
    };
    if (body.lines.length === 0) {
      Alert.alert("Nothing to fulfill", "Enter a positive quantity for at least one line.");
      return;
    }
    try {
      await fulfillSO(soId, body);
      onDone();
    } catch (e: any) {
      Alert.alert("Fulfill failed", e?.message ?? "Unknown error");
    }
  };

  return (
    <View style={{ padding: 16, backgroundColor: t.colors.card, borderRadius: 12, borderWidth: 1, borderColor: t.colors.border }}>
      <Text style={{ color: t.colors.text, fontWeight: "700", marginBottom: 8 }}>Fulfill</Text>

      <TextInput
        value={carrier}
        onChangeText={setCarrier}
        placeholder="Carrier (optional)"
        placeholderTextColor={t.colors.muted}
        style={{ backgroundColor: t.colors.bg, color: t.colors.text, borderColor: t.colors.border, borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 8 }}
      />
      <TextInput
        value={tracking}
        onChangeText={setTracking}
        placeholder="Tracking (optional)"
        placeholderTextColor={t.colors.muted}
        style={{ backgroundColor: t.colors.bg, color: t.colors.text, borderColor: t.colors.border, borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 8 }}
      />

      {(lines ?? []).map((l: any) => {
        const rem = remaining(l);
        return (
          <View key={l.id} style={{ marginBottom: 10 }}>
            <Text style={{ color: t.colors.muted, marginBottom: 4 }}>
              Item {l.itemId} — Remaining: {rem}
            </Text>
            <TextInput
              value={qtys[l.id!] ?? ""}
              onChangeText={(v) => setQtys((p) => ({ ...p, [l.id!]: v }))}
              keyboardType="numeric"
              placeholder="qty to fulfill"
              placeholderTextColor={t.colors.muted}
              style={{
                backgroundColor: t.colors.bg,
                color: t.colors.text,
                borderColor: t.colors.border,
                borderWidth: 1,
                borderRadius: 8,
                padding: 10,
              }}
            />
          </View>
        );
      })}
      <Pressable onPress={onSubmit} style={{ marginTop: 8, backgroundColor: t.colors.primary, padding: 12, borderRadius: 8, alignItems: "center" }}>
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>Submit Fulfillment</Text>
      </Pressable>
    </View>
  );
}
