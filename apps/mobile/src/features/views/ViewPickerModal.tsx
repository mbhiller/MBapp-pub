import * as React from "react";
import {
  View,
  Text,
  Modal,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useTheme } from "../../providers/ThemeProvider";
import { useViewsPaged } from "./hooks";
import type { SavedView } from "./applyView";

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelect: (view: SavedView) => void;
  entityType: string;
};

export default function ViewPickerModal({
  visible,
  onClose,
  onSelect,
  entityType,
}: Props) {
  const t = useTheme();
  const { items, q, setQ, loading, loadMore, refresh } = useViewsPaged(
    visible ? entityType : undefined
  );

  React.useEffect(() => {
    if (visible) {
      void refresh();
    }
  }, [visible, refresh]);

  const handleSelectView = (view: SavedView) => {
    onSelect(view);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}>
        <View
          style={{
            marginTop: "auto",
            backgroundColor: t.colors.card,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 20,
            maxHeight: "90%",
          }}
        >
          {/* Header */}
          <View style={{ marginBottom: 16 }}>
            <Text
              style={{
                color: t.colors.text,
                fontSize: 18,
                fontWeight: "700",
              }}
            >
              Select View
            </Text>
            <Text style={{ color: t.colors.textMuted, fontSize: 12, marginTop: 4 }}>
              {entityType}
            </Text>
          </View>

          {/* Search Input */}
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search views..."
            placeholderTextColor={t.colors.textMuted}
            style={{
              borderWidth: 1,
              borderColor: t.colors.border,
              borderRadius: 8,
              padding: 10,
              marginBottom: 12,
              color: t.colors.text,
              backgroundColor: t.colors.bg,
            }}
          />

          {/* Views List */}
          {loading && items.length === 0 ? (
            <ActivityIndicator size="large" color={t.colors.primary} />
          ) : items.length === 0 ? (
            <View style={{ padding: 20, alignItems: "center" }}>
              <Text style={{ color: t.colors.textMuted }}>
                No views found for {entityType}
              </Text>
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => item.id || ""}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => handleSelectView(item)}
                  style={{
                    padding: 12,
                    borderWidth: 1,
                    borderColor: t.colors.border,
                    borderRadius: 8,
                    marginBottom: 8,
                    backgroundColor: t.colors.bg,
                  }}
                >
                  <Text
                    style={{
                      color: t.colors.text,
                      fontWeight: "600",
                      marginBottom: 4,
                    }}
                  >
                    {item.name || item.id || "(no name)"}
                  </Text>
                  {item.description && (
                    <Text
                      style={{
                        color: t.colors.textMuted,
                        fontSize: 12,
                      }}
                    >
                      {item.description}
                    </Text>
                  )}
                </Pressable>
              )}
              onEndReached={loadMore}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                loading ? (
                  <ActivityIndicator
                    size="small"
                    color={t.colors.primary}
                    style={{ marginTop: 8 }}
                  />
                ) : null
              }
              scrollEnabled={false}
            />
          )}

          {/* Footer Buttons */}
          <View
            style={{
              flexDirection: "row",
              gap: 12,
              marginTop: 16,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: t.colors.border,
            }}
          >
            <Pressable
              onPress={onClose}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: t.colors.border,
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: t.colors.text,
                  fontWeight: "600",
                }}
              >
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
