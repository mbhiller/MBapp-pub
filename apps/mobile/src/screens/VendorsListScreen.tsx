import * as React from "react";
import { View, FlatList, Text, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useColors } from "../features/_shared/useColors";
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";
import { useObjectsList } from "../features/_shared/useObjectsList";
import type { components } from "../api/generated-types";
type Vendor = components["schemas"]["Vendor"];

// IMPORTANT: ensure 'type' matches Vendor's discriminator in generated-types.
// If Vendor shows `type: "vendor"` use "vendor"; if it (accidentally) shows "employee", set type: "employee".
const VENDOR_TYPE = "vendor" as const;

export default function VendorsListScreen({ navigation }: any) {
  const t = useColors();
  const q = useObjectsList<Vendor>({ type: VENDOR_TYPE, limit: 20, by: "updatedAt", sort: "desc" });

  const [pulling, setPulling] = React.useState(false);
  const onPull = React.useCallback(async () => { setPulling(true); try { await q.refetch(); } finally { setPulling(false); } }, [q]);
  useRefetchOnFocus(q.refetchStable, { debounceMs: 150 });

  const renderItem = ({ item }: { item: Vendor }) => {
    const id = String(item.id ?? "");
    const title = (item as any).name ?? `Vendor ${id.slice(0,8)}`;
    const parts: string[] = [];
    if ((item as any).email) parts.push((item as any).email);
    if ((item as any).phone) parts.push((item as any).phone);
    const subtitle = parts.join(" • ") || "—";

    return (
      <Pressable
        onPress={() => navigation.navigate("VendorDetail", { id, mode: "edit" })}
        style={{ backgroundColor: t.colors.card, borderColor: t.colors.border, borderWidth: 1, borderRadius: 12, marginBottom: 10, padding: 12 }}
      >
        <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 16 }}>{title}</Text>
        <Text style={{ color: t.colors.muted, marginTop: 2 }}>{subtitle}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      <FlatList
        data={q.items}
        keyExtractor={(i, idx) => String((i as any).id ?? idx)}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} />}
        renderItem={renderItem}
        ListEmptyComponent={<View style={{ padding: 24 }}>{q.isLoading ? <ActivityIndicator/> : q.isError ? <Text style={{ color: t.colors.danger }}>Error: {String(q.error?.message ?? "unknown")}</Text> : <Text style={{ color: t.colors.muted }}>No Vendors.</Text>}</View>}
        contentContainerStyle={{ paddingBottom: 96 }}
      />

      {/* + New */}
      <Pressable
        onPress={() => navigation.navigate("VendorDetail", { mode: "new" })}
        style={{ position: "absolute", right: 16, bottom: 16, backgroundColor: t.colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999 }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}
