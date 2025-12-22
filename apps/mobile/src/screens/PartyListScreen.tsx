// apps/mobile/src/screens/PartyListScreen.tsx
import * as React from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, TextInput, InteractionManager } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { findParties } from "../features/parties/api";
import type { Party } from "../features/parties/api";
import type { RootStackParamList } from "../navigation/types";
import { useColors } from "../features/_shared/useColors";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function PartyListScreen() {
  const t = useColors();
  const navigation = useNavigation<NavigationProp>();
  const [items, setItems] = React.useState<Party[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [role, setRole] = React.useState("");
  const listRef = React.useRef<FlatList<Party>>(null);

  React.useEffect(() => {
    void load();
  }, [q, role]);

  useFocusEffect(
    React.useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        void load();
      });
      return () => task.cancel?.();
    }, [q, role])
  );

  const load = async () => {
    setIsLoading(true);
    setLastError(null);
    try {
      const parties = await findParties({
        q: q || undefined,
      });
      setItems(parties || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setLastError(msg);
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  const displayName = (party: Party): string => {
    const display = (party as any).displayName || (party as any).name;
    if (display) return display;
    if ((party as any).firstName || (party as any).lastName) {
      return `${(party as any).firstName || ""} ${(party as any).lastName || ""}`.trim();
    }
    return party.id || "(unnamed)";
  };

  const renderItem = ({ item }: { item: Party }) => {
    const title = displayName(item);
    const kind = (item as any).kind || "unknown";
    const status = (item as any).status || "active";
    const createdAt = (item as any).createdAt as string | undefined;
    const updatedAt = (item as any).updatedAt as string | undefined;

    const formatDateTime = (value?: string) => {
      if (!value) return "";
      const d = new Date(value);
      return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
    };

    const isNew = (() => {
      if (!createdAt) return false;
      const now = Date.now();
      const ts = new Date(createdAt).getTime();
      if (isNaN(ts)) return false;
      return now - ts <= 10 * 60 * 1000; // 10 minutes
    })();

    return (
      <Pressable
        onPress={() => navigation.navigate("PartyDetail", { id: item.id })}
        style={{
          padding: 12,
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: 8,
          marginBottom: 8,
          backgroundColor: t.colors.card,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
          <Text style={{ color: t.colors.text, fontWeight: "700" }}>{title}</Text>
          {isNew && (
            <View style={{ marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, backgroundColor: t.colors.primary }}>
              <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>NEW</Text>
            </View>
          )}
        </View>
        <Text style={{ color: t.colors.textMuted, fontSize: 12, marginBottom: 2 }}>
          Kind: {kind}
        </Text>
        <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Status: {status}</Text>
        <Text style={{ color: t.colors.textMuted, fontSize: 11, marginTop: 4 }}>
          {createdAt ? `Created: ${formatDateTime(createdAt)}` : updatedAt ? `Updated: ${formatDateTime(updatedAt)}` : ""}
        </Text>
      </Pressable>
    );
  };

  // Derived display list: client-side role filtering + sort newest first
  const displayItems = React.useMemo(() => {
    const f = (role || "").trim().toLowerCase();
    let out = [...items];
    if (f) {
      out = out.filter((p: any) => {
        const flags: Record<string, boolean> = (p.roleFlags as any) || {};
        const roles: string[] = Array.isArray(p.roles) ? (p.roles as string[]) : [];
        const matchFlag = Object.entries(flags).some(([k, v]) => v === true && k.toLowerCase().includes(f));
        const matchRole = roles.some((r) => (r || "").toLowerCase().includes(f));
        return matchFlag || matchRole;
      });
    }
    const score = (p: any): number => {
      const ca = p?.createdAt ? new Date(p.createdAt).getTime() : NaN;
      const ua = p?.updatedAt ? new Date(p.updatedAt).getTime() : NaN;
      const ts = !isNaN(ca) ? ca : !isNaN(ua) ? ua : 0;
      return ts;
    };
    out.sort((a, b) => score(b) - score(a));
    return out;
  }, [items, role]);
  return (
    <View style={{ flex: 1, padding: 12, backgroundColor: t.colors.background }}>
      {lastError && (
        <View
          style={{
            padding: 8,
            backgroundColor: "#fdecea",
            borderColor: "#f5c6cb",
            borderWidth: 1,
            borderRadius: 6,
            marginBottom: 8,
          }}
        >
          <Text style={{ color: "#8a1f2d", fontWeight: "700", marginBottom: 2 }}>
            Error loading parties
          </Text>
          <Text style={{ color: "#8a1f2d", fontSize: 12 }}>{lastError}</Text>
          <Pressable
            onPress={load}
            style={{
              marginTop: 8,
              paddingVertical: 6,
              paddingHorizontal: 12,
              backgroundColor: "#d32f2f",
              borderRadius: 6,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "600", fontSize: 12 }}>Retry</Text>
          </Pressable>
        </View>
      )}

      {/* Search Input */}
      <TextInput
        placeholder="Search by name"
        placeholderTextColor={t.colors.textMuted}
        value={q}
        onChangeText={setQ}
        style={{
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: 8,
          padding: 10,
          marginBottom: 12,
          backgroundColor: t.colors.card,
          color: t.colors.text,
        }}
      />

      {/* Role Filter Input */}
      <TextInput
        placeholder="Filter by role (optional)"
        placeholderTextColor={t.colors.textMuted}
        value={role}
        onChangeText={setRole}
        style={{
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: 8,
          padding: 10,
          marginBottom: 12,
          backgroundColor: t.colors.card,
          color: t.colors.text,
        }}
      />

      {isLoading && items.length === 0 ? (
        <ActivityIndicator size="large" color={t.colors.primary} />
      ) : displayItems.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: t.colors.textMuted }}>No parties found</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={displayItems}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
        />
      )}
    </View>
  );
}
