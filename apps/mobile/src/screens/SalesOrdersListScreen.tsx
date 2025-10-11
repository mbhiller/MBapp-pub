// apps/mobile/src/screens/SalesOrdersListScreen.tsx
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
import { useRefetchOnFocus } from "../features/_shared/useRefetchOnFocus";
import { useObjectsList } from "../features/_shared/useObjectsList";
import type { components } from "../api/generated-types";

type SalesOrder = components["schemas"]["SalesOrder"];

export default function SalesOrdersListScreen({ navigation }: any) {
  const t = useColors();

  const q = useObjectsList<SalesOrder>({
    type: "salesOrder",
    limit: 20,
    by: "updatedAt",
    sort: "desc",
  });

  const [search, setSearch] = React.useState("");

  // Refs for silent refresh handling
  const searchRef = React.useRef<TextInput>(null);
  const listRef = React.useRef<FlatList<any>>(null);

  // Silent refresh on focus (one-shot): blur, clear, scroll top, refetch
useFocusEffect(
  React.useCallback(() => {
    const id = setTimeout(() => {
      searchRef.current?.blur?.();
      Keyboard.dismiss();

      // Clear the filter once when we return
      setSearch("");

      // Scroll to top
      listRef.current?.scrollToOffset?.({ offset: 0, animated: false });

      // Refetch without tying to loading flags (prevents re-run while you're typing)
      q.refetchStable?.();
    }, 0);

    return () => clearTimeout(id);
  }, []) // ⬅️ no q.isFetching / q.isLoading / q.refetch deps
);


  // Pull to refresh + small refetch debounce on focus changes
  const [pulling, setPulling] = React.useState(false);
  const onPull = React.useCallback(async () => {
    setPulling(true);
    try {
      await q.refetch();
    } finally {
      setPulling(false);
    }
  }, [q]);
  useRefetchOnFocus(q.refetchStable, { debounceMs: 150 });

  // Client-side filter for speed
  const items = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return q.items;
    return q.items.filter((so: any) => {
      const parts = [
        so?.id,
        so?.orderNumber,
        so?.customerName,
        so?.customerEmail,
        so?.customerPhone,
        so?.status,
      ]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase());
      return parts.some((p) => p.includes(needle));
    });
  }, [q.items, search]);

  const renderItem = ({ item }: { item: SalesOrder }) => {
    const id = String(item.id ?? "");
    const title =
      (item as any).name ??
      (item as any).number ??
      (item as any).customerName ??
      `Sales Order ${id.slice(0, 8)}`;
    const lineCount = Array.isArray((item as any).lines) ? (item as any).lines.length : 0;
    const subtitle =
      [
        (item as any).customerName ? String((item as any).customerName) : null,
        lineCount ? `${lineCount} line${lineCount === 1 ? "" : "s"}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "—";
    const status = String((item as any).status ?? "draft");

    return (
      <Pressable
        onPress={() => navigation.navigate("SalesOrderDetail", { id, mode: "edit" })}
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
          <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 16, flex: 1 }}>
            {title}
          </Text>
          <StatusPill value={status} />
        </View>
        <Text style={{ color: t.colors.muted, marginTop: 4 }}>{subtitle}</Text>
      </Pressable>
    );
  };

  const onNew = React.useCallback(() => {
    navigation.navigate("SalesOrderDetail", { mode: "new" });
  }, [navigation]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.colors.background,
        padding: 12,
        position: "relative", // ensures FAB overlays list
      }}
    >
      {/* Search (client-side) */}
      <View style={{ marginBottom: 10, flexDirection: "row", alignItems: "center" }}>
        <TextInput
          ref={searchRef}
          value={search}
          onChangeText={setSearch}
          placeholder="Search orders (name, email, phone, status, #)"
          placeholderTextColor={t.colors.textMuted}
          autoFocus={false}
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
        style={{ flex: 1 }} // ensure list fills the space
        contentContainerStyle={{ paddingBottom: 96, minHeight: "100%" }} // keeps full-height layout
        ListEmptyComponent={
          <View style={{ padding: 24 }}>
            {q.isLoading ? (
              <ActivityIndicator />
            ) : q.isError ? (
              <Text style={{ color: t.colors.danger }}>
                Error: {String(q.error?.message ?? "unknown")}
              </Text>
            ) : (
              <Text style={{ color: t.colors.muted }}>
                {search ? "No matching sales orders." : "No sales orders."}
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
          zIndex: 20, // ensure above list (iOS)
          elevation: 6, // ensure above list (Android)
          shadowColor: "#000",
          shadowOpacity: 0.2,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 },
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
  const { bg, fg, br } = getSOStatusStyle(t, v);
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: br,
        marginLeft: 8,
      }}
    >
      <Text style={{ color: fg, fontWeight: "700", fontSize: 12 }}>{v}</Text>
    </View>
  );
}

function getSOStatusStyle(t: ReturnType<typeof useColors>, v?: string) {
  const s = String(v || "").toLowerCase();
  if (["committed", "fulfilling", "fulfilled", "closed"].includes(s)) {
    return { bg: t.colors.card, fg: t.colors.primary, br: t.colors.primary };
    }
  if (s === "canceled" || s === "cancelled") {
    return { bg: t.colors.card, fg: t.colors.danger, br: t.colors.danger };
  }
  return { bg: t.colors.card, fg: t.colors.text, br: t.colors.border };
}
