import * as React from "react";
import { View, Text, ActivityIndicator, Pressable, ScrollView } from "react-native";
import { useColors } from "../features/_shared/useColors";
import { useObject, useUpsertObject } from "../features/_shared/useObject";
import type { components } from "../api/generated-types";
type GoodsReceipt = components["schemas"]["GoodsReceipt"];

export default function GoodsReceiptDetailScreen({ route, navigation }: any) {
  const t = useColors();
  const id: string | undefined = route?.params?.id;
  const { data, isLoading, isError, error } = useObject<GoodsReceipt>("goodsReceipt", id);
  const save = useUpsertObject<GoodsReceipt>("goodsReceipt");

  if (isLoading) return <View style={{ flex:1, justifyContent:"center", alignItems:"center" }}><ActivityIndicator/></View>;
  if (isError) return <View style={{ padding:16 }}><Text style={{ color: t.colors.danger }}>Error: {String(error?.message)}</Text></View>;

  const gr = data;
  return (
    <ScrollView style={{ flex:1, backgroundColor: t.colors.background }} contentContainerStyle={{ padding: 16 }}>
      <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 18 }}>
        {gr?.id ? `Goods Receipt ${gr.id.slice(0,8)}` : "New Goods Receipt"}
      </Text>
      {gr?.ts ? <Text style={{ color: t.colors.muted, marginTop: 6 }}>{new Date(gr.ts).toLocaleString()}</Text> : null}
      <Text style={{ color: t.colors.muted, marginTop: 6 }}>PO: {gr?.poId ?? "—"}</Text>
      <Text style={{ color: t.colors.muted, marginTop: 6 }}>Lines: {gr?.lines?.length ?? 0}</Text>

      {/* Placeholder: add edit UI later */}
      <Pressable
        onPress={() => {
          if (!gr) return;
          // example no-op update to demonstrate save
          save.mutate({ id: gr.id! });
        }}
        style={{ marginTop: 20, backgroundColor: t.colors.primary, padding: 12, borderRadius: 10, alignItems: "center" }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>{save.isPending ? "Saving…" : "Save"}</Text>
      </Pressable>
    </ScrollView>
  );
}
