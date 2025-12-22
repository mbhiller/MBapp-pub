import * as React from "react";
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator, InteractionManager } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useObjects } from "../features/_shared/useObjects";
import { useTheme } from "../providers/ThemeProvider";

export default function InventoryListScreen() {
  const t = useTheme();
  const nav = useNavigation<any>();
  const [q, setQ] = React.useState("");
  const { data, isLoading, refetch, hasNext, fetchNext, reset } = useObjects<any>({ type: "inventory", q, query: { sort: "desc", by: "updatedAt" }, params: { limit: __DEV__ ? 200 : 50 } });

  React.useEffect(() => { refetch(); }, [q]);
  useFocusEffect(
    React.useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        void refetch();
      });
      return () => task.cancel?.();
    }, [refetch])
  );
  const rawItems = data?.items ?? [];
  const items = [...rawItems].sort((a, b) => {
    const ta =
      Date.parse((a as any)?.createdAt ?? "") ||
      Date.parse((a as any)?.updatedAt ?? "") ||
      0;
    const tb =
      Date.parse((b as any)?.createdAt ?? "") ||
      Date.parse((b as any)?.updatedAt ?? "") ||
      0;

    if (tb !== ta) return tb - ta;

    const ia = String((a as any)?.id ?? "");
    const ib = String((b as any)?.id ?? "");
    return ib.localeCompare(ia);
  });

  const formatDateTime = (value?: string | null) => {
    if (!value) return "";
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  };

  return (
    <View style={{ flex: 1, padding: 12, backgroundColor: t.colors.bg }}>
      <TextInput
        placeholder="Search inventory"
        value={q}
        onChangeText={setQ}
        style={{ borderWidth: 1, borderRadius: 8, padding: 8, marginBottom: 8, borderColor: t.colors.border, color: t.colors.text }}
      />
      {isLoading && !data ? <ActivityIndicator size="large" color={t.colors.primary} /> : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => nav.navigate("InventoryDetail", { id: item.id })}>
              <View style={{ padding: 10, borderWidth: 1, borderRadius: 8, marginBottom: 8, borderColor: t.colors.border, backgroundColor: t.colors.card }}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                  <Text style={{ color: t.colors.text, fontWeight: "700" }}>{(item as any).name || item.id || "(no name)"}</Text>
                  {(() => {
                    const createdRaw = (item as any).createdAt as string | undefined;
                    if (!createdRaw) return null;
                    const ts = new Date(createdRaw).getTime();
                    if (isNaN(ts)) return null;
                    const isNew = Date.now() - ts < 10 * 60 * 1000;
                    return isNew ? (
                      <View style={{ marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, backgroundColor: t.colors.primary }}>
                        <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>NEW</Text>
                      </View>
                    ) : null;
                  })()}
                </View>
                <Text style={{ color: t.colors.textMuted, fontSize: 12, marginBottom: 2 }}>Product: {(item as any).productId || "—"}</Text>
                <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Updated: {formatDateTime((item as any).updatedAt) || "—"}</Text>
                <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Created: {formatDateTime((item as any).createdAt) || "—"}</Text>
              </View>
            </Pressable>
          )}
          onEndReachedThreshold={0.6}
          onEndReached={() => { if (hasNext && !isLoading) fetchNext?.(); }}
          ListFooterComponent={
            hasNext
              ? (
                <Pressable
                  onPress={() => fetchNext?.()}
                  style={{ paddingVertical: 12, alignItems: "center" }}
                >
                  {isLoading
                    ? <ActivityIndicator size="small" color={t.colors.primary} />
                    : <Text style={{ textAlign: "center", color: t.colors.text }}>Load more</Text>}
                </Pressable>
              )
              : null
          }
        />
      )}
    </View>
  );
}
