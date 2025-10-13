// apps/mobile/src/screens/PurchaseOrdersListScreen.tsx
import * as React from "react";
import {
  View,
  FlatList,
  Text,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Keyboard,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "../features/_shared/useColors";
import { useObjectsList } from "../features/_shared/useObjectsList"; // your existing list hook
import type { PurchaseOrder } from "../features/purchaseOrders/api";

export default function PurchaseOrdersListScreen({ navigation }: any) {
  const t = useColors();
  const q = useObjectsList<PurchaseOrder>({
    type: "purchaseOrder",
    limit: 20,
    by: "updatedAt",
    sort: "desc",
  });

  const [search, setSearch] = React.useState("");
  const searchRef = React.useRef<TextInput>(null);
  const listRef = React.useRef<FlatList<any>>(null);

  // Silent refresh & reset UI on focus
  useFocusEffect(
    React.useCallback(() => {
      const id = setTimeout(() => {
        searchRef.current?.blur?.();
        Keyboard.dismiss();
        setSearch("");
        listRef.current?.scrollToOffset?.({ offset: 0, animated: false });
        q.refetchStable?.();
      }, 0);
      return () => clearTimeout(id);
    }, [])
  );

  const [pulling, setPulling] = React.useState(false);
  const onPull = React.useCallback(async () => {
    setPulling(true);
    try {
      await q.refetch();
    } finally {
      setPulling(false);
    }
  }, [q]);

  const items = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return q.items;
    return q.items.filter((po: any) => {
      const parts = [
        po?.id,
        po?.poNumber ?? po?.number,
        po?.vendorName,
        po?.status,
      ]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase());
      return parts.some((p) => p.includes(needle));
    });
  }, [q.items, search]);

  const renderItem = ({ item }: { item: PurchaseOrder }) => {
    const id = String(item.id ?? "");
    const title =
      (item as any).poNumber ??
      (item as any).number ??
      `PO ${id.slice(0, 8)}`;
    const lineCount = Array.isArray(item.lines) ? item.lines.length : 0;
    const subtitle =
      [item.vendorName, lineCount ? `${lineCount} line${lineCount === 1 ? "" : "s"}` : null]
        .filter(Boolean)
        .join(" · ") || "—";
    const status = String(item.status ?? "draft");

    return (
      <Pressable
        onPress={() => navigation.navigate("PurchaseOrderDetail", { id })}
        style={{
          backgroundColor: t.colors.card,
          borderColor: t.colors.border,
          borderWidth: 1,
          borderRadius: 12,
          marginBottom: 10,
          padding: 12,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text
            style={{ color: t.colors.text, fontWeight: "700", fontSize: 16, flex: 1 }}
            numberOfLines={1}
          >
            {title}
          </Text>
          <StatusPill value={status} />
        </View>
        <Text style={{ color: t.colors.muted, marginTop: 4 }}>{subtitle}</Text>
      </Pressable>
    );
  };

  const onNew = React.useCallback(() => {
    navigation.navigate("PurchaseOrderDetail", { mode: "new" });
  }, [navigation]);

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, padding: 12 }}>
      {/* Search */}
      <View style={{ marginBottom: 10, flexDirection: "row", alignItems: "center" }}>
        <TextInput
          ref={searchRef}
          value={search}
          onChangeText={setSearch}
          placeholder="Search POs (vendor, status, #)"
          placeholderTextColor={t.colors.textMuted}
          blurOnSubmit
          onSubmitEditing={Keyboard.dismiss}
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            backgroundColor: (t.colors as any).inputBg ?? t.colors.card,
            color: t.colors.text,
          }}
        />
        {search ? (
          <Pressable
            onPress={() => setSearch("")}
            style={{
              marginLeft: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: t.colors.border,
              backgroundColor: t.colors.card,
            }}
          >
            <Text style={{ color: t.colors.text }}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(i, idx) => String((i as any).id ?? idx)}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} />}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: 96, minHeight: "100%" }}
        ListEmptyComponent={
          <View style={{ padding: 24 }}>
            {q.isLoading ? (
              <ActivityIndicator />
            ) : q.isError ? (
              <Text style={{ color: t.colors.danger }}>Error: {String(q.error?.message ?? "unknown")}</Text>
            ) : (
              <Text style={{ color: t.colors.muted }}>
                {search ? "No matching purchase orders." : "No purchase orders."}
              </Text>
            )}
          </View>
        }
      />

      {/* + New */}
      <Pressable
        onPress={onNew}
        style={{
          position: "absolute",
          right: 16,
          bottom: 16,
          backgroundColor: t.colors.primary,
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderRadius: 999,
        }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>+ New</Text>
      </Pressable>
    </View>
  );
}

function StatusPill({ value }: { value: string }) {
  const t = useColors();
  const v = value?.toLowerCase?.() ?? "draft";
  const ok = ["approved", "received", "closed"].includes(v);
  const bad = ["cancelled", "canceled"].includes(v);
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: t.colors.card,
        borderWidth: 1,
        borderColor: bad ? t.colors.danger : ok ? t.colors.primary : t.colors.border,
      }}
    >
      <Text
        style={{
          color: bad ? t.colors.danger : ok ? t.colors.primary : t.colors.text,
          fontWeight: "700",
          fontSize: 12,
        }}
      >
        {v}
      </Text>
    </View>
  );
}
