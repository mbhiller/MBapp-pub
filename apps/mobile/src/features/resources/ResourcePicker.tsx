// apps/mobile/src/features/resources/ResourcePicker.tsx
import * as React from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  Modal,
  ScrollView,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listResources } from "./api";
import { useTheme } from "../../providers/ThemeProvider";
import type { Resource } from "./types";
import type { RootStackParamList } from "../../navigation/types";

interface ResourcePickerProps {
  visible: boolean;
  onSelect: (resourceId: string) => void;
  onCancel: () => void;
}

export default function ResourcePicker({
  visible,
  onSelect,
  onCancel,
}: ResourcePickerProps) {
  const t = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [q, setQ] = React.useState("");
  const [resources, setResources] = React.useState<Resource[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);

  React.useEffect(() => {
    if (visible) {
      fetchResources();
    }
  }, [visible, q]);

  const fetchResources = async () => {
    setIsLoading(true);
    try {
      const result = await listResources({ q: q || undefined, limit: 50 });
      setResources(result.items || []);
    } catch (error) {
      console.error("Failed to load resources:", error);
      setResources([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelect = (resourceId: string) => {
    onSelect(resourceId);
    setQ("");
    setResources([]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          justifyContent: "flex-end",
        }}
      >
        <View
          style={{
            backgroundColor: t.colors.bg,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: "80%",
            paddingBottom: 20,
          }}
        >
          {/* Header */}
          <View
            style={{
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: t.colors.border,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "700", color: t.colors.text }}>
              Select Resource
            </Text>
            <Pressable onPress={onCancel}>
              <Text style={{ fontSize: 16, color: t.colors.primary }}>Cancel</Text>
            </Pressable>
          </View>

          {/* Search Input */}
          <View style={{ padding: 12 }}>
            <TextInput
              placeholder="Search resources"
              placeholderTextColor={t.colors.textMuted}
              value={q}
              onChangeText={setQ}
              style={{
                borderWidth: 1,
                borderColor: t.colors.border,
                borderRadius: 8,
                padding: 10,
                backgroundColor: t.colors.card,
                color: t.colors.text,
              }}
            />
          </View>

          {/* List */}
          {isLoading ? (
            <View style={{ padding: 20, alignItems: "center" }}>
              <ActivityIndicator size="large" color={t.colors.primary} />
            </View>
          ) : resources.length === 0 ? (
            <View style={{ padding: 20, alignItems: "center", gap: 8 }}>
              <Text style={{ color: t.colors.textMuted }}>
                {q ? "No resources found" : "No resources yet"}
              </Text>
              {!q && (
                <Pressable
                  onPress={() => {
                    onCancel();
                    navigation.navigate("ResourcesList");
                  }}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: 8,
                    backgroundColor: t.colors.primary,
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700" }}>Go to Resources</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <FlatList
              data={resources}
              keyExtractor={(item) => item.id}
              scrollEnabled
              style={{ maxHeight: "70%" }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => handleSelect(item.id)}
                  style={{
                    padding: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: t.colors.border,
                  }}
                >
                  <Text
                    style={{
                      fontWeight: "600",
                      color: t.colors.text,
                      marginBottom: 4,
                    }}
                  >
                    {item.name || item.id}
                  </Text>
                  <Text style={{ fontSize: 13, color: t.colors.textMuted }}>
                    Status: {(item as any).status || "unknown"}
                  </Text>
                </Pressable>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}
