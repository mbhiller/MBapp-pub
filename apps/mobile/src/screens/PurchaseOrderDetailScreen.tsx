import * as React from "react";
import { View, Text, ActivityIndicator, FlatList, Pressable } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useObjects } from "../features/_shared/useObjects";
import { FEATURE_PO_QUICK_RECEIVE } from "../features/_shared/flags";
import { saveFromSuggestion, receiveAll } from "../features/purchasing/poActions";

export default function PurchaseOrderDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const id = route.params?.id as string | undefined;
  const { data, isLoading, refetch } = useObjects<any>({ type: "purchaseOrder", id });
  const po = data;
  const lines = (po?.lines ?? []) as any[];

  if (isLoading) return <ActivityIndicator />;

  return (
    <View style={{ flex: 1, padding: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 6 }}>Purchase Order {po?.id}</Text>
      <Text>Status: {po?.status}</Text>

      {/* Sprint G actions */}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
        {po?.status === "draft" && (
          <Pressable
            onPress={async () => {
              try {
                const r = await saveFromSuggestion(po);
                const newId = (r as any)?.id ?? (r as any)?.ids?.[0];
                if (newId && newId !== po?.id) navigation.replace("PurchaseOrderDetail", { id: newId });
              } catch (e) {
                console.error(e);
              }
            }}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 8 }}
          >
            <Text>Save Draft</Text>
          </Pressable>
        )}
        {FEATURE_PO_QUICK_RECEIVE && po?.id && (
          <Pressable
            onPress={async () => { try { await receiveAll(po); await refetch(); } catch (e) { console.error(e); } }}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 8 }}
          >
            <Text>Receive All</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        style={{ marginTop: 12 }}
        data={lines}
        keyExtractor={(l: any) => String(l.id ?? l.itemId)}
        renderItem={({ item: line }: any) => (
          <View style={{ padding: 10, borderWidth: 1, borderRadius: 8, marginBottom: 8 }}>
            <Text style={{ fontWeight: "600" }}>{line.itemId}</Text>
            <Text>Qty: {line.qty} {line.uom || "ea"}</Text>
          </View>
        )}
      />
    </View>
  );
}
