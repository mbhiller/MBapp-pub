// apps/mobile/src/screens/WorkspaceHubScreen.tsx
import React, { useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, RefreshControl, Alert } from "react-native";
import { useColors } from "../features/_shared/useColors";
import { useWorkspaceItems } from "../features/workspaces/hooks";
import type { RootStackParamList } from "../navigation/types";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const ENTITY_TYPES = [
  { label: "All", value: undefined },
  { label: "Purchase Order", value: "purchaseOrder" },
  { label: "Sales Order", value: "salesOrder" },
  { label: "Inventory", value: "inventoryItem" },
  { label: "Party", value: "party" },
  { label: "Product", value: "product" },
];

const ROUTE_BY_ENTITY: Record<string, keyof RootStackParamList> = {
  purchaseOrder: "PurchaseOrdersList",
  salesOrder: "SalesOrdersList",
  inventoryItem: "InventoryList",
  party: "PartyList",
  product: "ProductsList",
};

export default function WorkspaceHubScreen({ navigation }: { navigation: NavigationProp }) {
  const t = useColors();
  const [q, setQ] = useState("");
  const [entityType, setEntityType] = useState<string | undefined>(undefined);

  const { data, isLoading, error, refetch } = useWorkspaceItems({ q, entityType });

  const handleItemPress = (item: any) => {
    const route = ROUTE_BY_ENTITY[item?.entityType];
    if (!route) {
      Alert.alert("Unsupported", `No list screen for entity type: ${item?.entityType ?? "unknown"}`);
      return;
    }
    navigation.navigate(route as any, { viewId: item.id } as any);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      {/* Search Input */}
      <View style={{ padding: 12, gap: 8 }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search workspaces by name..."
          placeholderTextColor={t.colors.textMuted}
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            padding: 10,
            color: t.colors.text,
            backgroundColor: t.colors.card,
          }}
        />

        {/* Entity Type Filter (simple chips) */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: "row", gap: 8 }}>
          {ENTITY_TYPES.map((et) => (
            <Pressable
              key={et.label}
              onPress={() => setEntityType(et.value)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 16,
                backgroundColor: entityType === et.value ? t.colors.primary : t.colors.card,
                borderWidth: 1,
                borderColor: entityType === et.value ? t.colors.primary : t.colors.border,
                marginRight: 8,
              }}
            >
              <Text
                style={{
                  color: entityType === et.value ? t.colors.buttonText : t.colors.text,
                  fontSize: 12,
                  fontWeight: entityType === et.value ? "700" : "400",
                }}
              >
                {et.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Workspace List */}
      <ScrollView
        contentContainerStyle={{ padding: 12, gap: 8 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
      >
        {error && (
          <View style={{ padding: 16, backgroundColor: t.colors.card, borderRadius: 8, marginBottom: 8 }}>
            <Text style={{ color: t.colors.textMuted, textAlign: "center" }}>
              Error loading workspaces: {String(error)}
            </Text>
          </View>
        )}

        {!isLoading && data.length === 0 && (
          <View style={{ padding: 24 }}>
            <Text style={{ color: t.colors.textMuted, textAlign: "center" }}>
              No workspaces found.
              {(q || entityType) && "\nTry adjusting your filters."}
            </Text>
          </View>
        )}

        {data.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => handleItemPress(item)}
            style={{
              padding: 12,
              backgroundColor: t.colors.card,
              borderWidth: 1,
              borderColor: t.colors.border,
              borderRadius: 8,
            }}
          >
            <Text style={{ color: t.colors.text, fontWeight: "600", marginBottom: 4 }}>
              {item.name}
            </Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>
                {item.entityType}
              </Text>
              {item.updatedAt && (
                <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>
                  · Updated {new Date(item.updatedAt).toLocaleDateString()}
                </Text>
              )}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
