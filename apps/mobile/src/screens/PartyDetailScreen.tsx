// apps/mobile/src/screens/PartyDetailScreen.tsx
import * as React from "react";
import { View, Text, ActivityIndicator, ScrollView, Pressable } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { getParty } from "../features/parties/api";
import type { RootStackParamList } from "../navigation/types";
import { useColors } from "../features/_shared/useColors";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RoutePropType = RouteProp<RootStackParamList, "PartyDetail">;

export default function PartyDetailScreen() {
  const t = useColors();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RoutePropType>();

  const partyId = route.params?.id;
  const [party, setParty] = React.useState<any | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [lastError, setLastError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void load();
  }, [partyId]);

  const load = async () => {
    if (!partyId) {
      setLastError("No party id provided");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLastError(null);
    try {
      const res = await getParty(partyId);
      setParty(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setLastError(msg);
      setParty(null);
    } finally {
      setIsLoading(false);
    }
  };

  const renderField = (label: string, value: any) => {
    const display = value === null || value === undefined || value === "" ? "—" : String(value);
    return (
      <View style={{ marginBottom: 12 }}>
        <Text style={{ fontSize: 12, color: t.colors.textMuted, marginBottom: 4 }}>{label}</Text>
        <Text style={{ fontSize: 14, color: t.colors.text, fontWeight: "500" }}>{display}</Text>
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.colors.background }}>
        <ActivityIndicator size="large" color={t.colors.primary} />
      </View>
    );
  }

  if (lastError || !party) {
    return (
      <View style={{ flex: 1, padding: 16, backgroundColor: t.colors.background }}>
        <View
          style={{
            padding: 10,
            backgroundColor: "#fdecea",
            borderColor: "#f5c6cb",
            borderWidth: 1,
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: "#8a1f2d", fontWeight: "700", marginBottom: 4 }}>
            Error loading party
          </Text>
          <Text style={{ color: "#8a1f2d" }}>{lastError || "Party not found"}</Text>
        </View>
        <Pressable
          onPress={load}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 12,
            backgroundColor: t.colors.primary,
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const displayName = party.displayName || party.name || `${party.firstName || ""} ${party.lastName || ""}`.trim() || party.id;
  const kind = party.kind || "unknown";
  const status = party.status || "active";
  const firstName = party.firstName || null;
  const lastName = party.lastName || null;
  const email = party.email || null;
  const phone = party.phone || null;
  const notes = party.notes || null;
  const tags = party.tags || [];
  const addresses = party.addresses || [];
  const roles = party.roles || [];
  const roleFlags = party.roleFlags || {};

  return (
    <ScrollView style={{ flex: 1, padding: 16, backgroundColor: t.colors.background }}>
      {/* Core Fields */}
      {renderField("Name", displayName)}
      {renderField("Kind", kind)}
      {renderField("Status", status)}

      {/* Name Details */}
      {firstName && renderField("First Name", firstName)}
      {lastName && renderField("Last Name", lastName)}

      {/* Contact Info */}
      {email && renderField("Email", email)}
      {phone && renderField("Phone", phone)}

      {/* Addresses */}
      {addresses.length > 0 && (
        <View style={{ marginBottom: 12 }}>
          <Text style={{ fontSize: 12, color: t.colors.textMuted, marginBottom: 4 }}>Addresses</Text>
          {addresses.map((addr: any, idx: number) => (
            <Text key={idx} style={{ fontSize: 14, color: t.colors.text, marginBottom: 4 }}>
              {[addr.address1, addr.address2, addr.city, addr.state, addr.postal, addr.country]
                .filter(Boolean)
                .join(", ")}
            </Text>
          ))}
        </View>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <View style={{ marginBottom: 12 }}>
          <Text style={{ fontSize: 12, color: t.colors.textMuted, marginBottom: 4 }}>Tags</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {tags.map((tag: string, idx: number) => (
              <View
                key={idx}
                style={{
                  paddingVertical: 4,
                  paddingHorizontal: 10,
                  backgroundColor: t.colors.card,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: t.colors.border,
                }}
              >
                <Text style={{ fontSize: 12, color: t.colors.text }}>{tag}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Notes */}
      {notes && renderField("Notes", notes)}

      {/* Roles */}
      {(roles.length > 0 || Object.keys(roleFlags).length > 0) && (
        <View style={{ marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: t.colors.border }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: t.colors.text, marginBottom: 12 }}>
            Roles
          </Text>
          {roles.length > 0 && (
            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 12, color: t.colors.textMuted, marginBottom: 6 }}>Assigned Roles</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {roles.map((role: string, idx: number) => (
                  <View
                    key={idx}
                    style={{
                      paddingVertical: 6,
                      paddingHorizontal: 12,
                      backgroundColor: t.colors.primary,
                      borderRadius: 16,
                    }}
                  >
                    <Text style={{ fontSize: 12, color: "#fff", fontWeight: "600" }}>{role}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
          {Object.keys(roleFlags).length > 0 && (
            <View>
              <Text style={{ fontSize: 12, color: t.colors.textMuted, marginBottom: 6 }}>Role Flags</Text>
              {Object.entries(roleFlags).map(([roleKey, isActive]: [string, any]) => (
                <Text key={roleKey} style={{ fontSize: 12, color: t.colors.text, marginBottom: 4 }}>
                  {roleKey}: {isActive ? "✓" : "✗"}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}
