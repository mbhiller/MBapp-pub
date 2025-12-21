// apps/mobile/src/screens/PartyListScreen.tsx
import * as React from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, TextInput } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { findParties, createParty } from "../features/parties/api";
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
  const [seedMessage, setSeedMessage] = React.useState<string | null>(null);
  const [isSeeding, setIsSeeding] = React.useState(false);

  React.useEffect(() => {
    void load();
  }, [q, role]);

  const load = async () => {
    setIsLoading(true);
    setLastError(null);
    try {
      const parties = await findParties({
        q: q || undefined,
        role: role || undefined,
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

  const seedParty = async () => {
    setIsSeeding(true);
    setSeedMessage(null);
    try {
      await createParty({
        kind: "person",
        name: "Seed Party - Dev",
      });
      setSeedMessage("✓ Party created");
      // Reset search and reload list
      setQ("");
      setRole("");
      setItems([]);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setSeedMessage(`✗ Failed to create party: ${msg}`);
    } finally {
      setIsSeeding(false);
    }
  };

  const renderItem = ({ item }: { item: Party }) => {
    const title = displayName(item);
    const kind = (item as any).kind || "unknown";
    const status = (item as any).status || "active";

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
        <Text style={{ color: t.colors.text, fontWeight: "700", marginBottom: 4 }}>
          {title}
        </Text>
        <Text style={{ color: t.colors.textMuted, fontSize: 12, marginBottom: 2 }}>
          Kind: {kind}
        </Text>
        <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>Status: {status}</Text>
      </Pressable>
    );
  };

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

      {__DEV__ && (
        <View style={{ marginBottom: 12, flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Pressable
            onPress={seedParty}
            disabled={isSeeding}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              backgroundColor: isSeeding ? t.colors.border : t.colors.primary,
              borderRadius: 6,
              flex: 1,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "600", fontSize: 12 }}>
              {isSeeding ? "Seeding..." : "Seed Party"}
            </Text>
          </Pressable>
          {seedMessage && (
            <Text
              style={{
                fontSize: 11,
                color: seedMessage.startsWith("✓") ? t.colors.primary : "#d32f2f",
                flex: 1,
              }}
            >
              {seedMessage}
            </Text>
          )}
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
      ) : items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: t.colors.textMuted }}>No parties found</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
        />
      )}
    </View>
  );
}
