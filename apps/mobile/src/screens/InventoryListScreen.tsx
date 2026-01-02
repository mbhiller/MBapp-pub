import * as React from "react";
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator, InteractionManager } from "react-native";
import { useNavigation, useFocusEffect, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useObjects } from "../features/_shared/useObjects";
import { useTheme } from "../providers/ThemeProvider";
import { useViewsApi } from "../features/views/hooks";
import { mapViewToMobileState, type SavedView } from "../features/views/applyView";
import ViewPickerModal from "../features/views/ViewPickerModal";
import SaveViewModal from "../features/views/SaveViewModal";
import { buildViewFromState } from "../features/views/buildViewFromState";
import type { RootStackParamList } from "../navigation/types";

export default function InventoryListScreen() {
  const t = useTheme();
  const nav = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, "InventoryList">>();
  const { get: getView } = useViewsApi();
  const defaultSort = React.useMemo(() => ({ by: "updatedAt", dir: "desc" as const }), []);
  const [q, setQ] = React.useState("");
  const [appliedView, setAppliedView] = React.useState<SavedView | null>(null);
  const [showViewPicker, setShowViewPicker] = React.useState(false);
  const [showSaveModal, setShowSaveModal] = React.useState(false);
  const [filters, setFilters] = React.useState<{ filter?: Record<string, any>; sort?: { by?: string; dir?: "asc" | "desc" } }>({
    filter: undefined,
    sort: defaultSort,
  });
  const filterJSON = React.useMemo(() => JSON.stringify(filters.filter ?? {}), [filters.filter]);
  const sortJSON = React.useMemo(() => JSON.stringify(filters.sort ?? defaultSort), [filters.sort, defaultSort]);

  const { data, isLoading, refetch, hasNext, fetchNext, reset } = useObjects<any>({
    type: "inventory",
    q,
    filter: filters.filter,
    query: { sort: filters.sort?.dir ?? "desc", by: filters.sort?.by ?? "updatedAt" },
    params: { limit: __DEV__ ? 200 : 50 },
  });

  React.useEffect(() => { refetch(); }, [q, filterJSON, sortJSON, refetch]);
  useFocusEffect(
    React.useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        void refetch();
      });
      return () => task.cancel?.();
    }, [refetch])
  );

  React.useEffect(() => {
    const id = route.params?.viewId;
    if (!id) return;
    (async () => {
      try {
        const view = await getView(id);
        const result = mapViewToMobileState("inventoryItem", view);
        setAppliedView(view);
        if (result.applied.q !== undefined) setQ(result.applied.q ?? "");
        setFilters({
          filter: result.applied.filter,
          sort: result.applied.sort ?? defaultSort,
        });
        reset?.();
      } catch (e) {
        if (__DEV__) console.warn("Failed to apply view", e);
      }
    })();
  }, [route.params?.viewId, getView, defaultSort, reset]);

  const clearView = () => {
    setAppliedView(null);
    setFilters({ filter: undefined, sort: defaultSort });
    setQ("");
    reset?.();
  };

  const handleApplyView = (view: SavedView) => {
    const result = mapViewToMobileState("inventoryItem", view);
    setAppliedView(view);
    if (result.applied.q !== undefined) setQ(result.applied.q ?? "");
    setFilters({
      filter: result.applied.filter,
      sort: result.applied.sort ?? defaultSort,
    });
    setShowViewPicker(false);
  };

  const handleSaveView = (view: SavedView) => {
    setAppliedView(view);
    setShowSaveModal(false);
  };

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
      {appliedView && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 10, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card, marginBottom: 8 }}>
          <Text style={{ color: t.colors.text, fontWeight: "600" }}>
            Active View: {appliedView.name || appliedView.id}
          </Text>
          <Pressable onPress={clearView}>
            <Text style={{ color: t.colors.primary, fontWeight: "700" }}>Clear</Text>
          </Pressable>
        </View>
      )}

      {/* View Controls Row */}
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <Pressable
          onPress={() => setShowViewPicker(true)}
          style={{
            flex: 1,
            padding: 10,
            backgroundColor: t.colors.card,
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          <Text style={{ color: t.colors.primary, fontWeight: "600" }}>
            📋 Views
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setShowSaveModal(true)}
          style={{
            flex: 1,
            padding: 10,
            backgroundColor: t.colors.card,
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          <Text style={{ color: t.colors.primary, fontWeight: "600" }}>
            💾 Save
          </Text>
        </Pressable>
      </View>

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

      {/* View Picker Modal */}
      <ViewPickerModal
        visible={showViewPicker}
        onClose={() => setShowViewPicker(false)}
        onSelect={handleApplyView}
        entityType="inventoryItem"
      />

      {/* Save View Modal */}
      <SaveViewModal
        visible={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onSaved={handleSaveView}
        entityType="inventoryItem"
        currentState={{ q, filter: filters.filter, sort: filters.sort }}
        appliedView={appliedView}
      />
    </View>
  );
}
