import * as React from "react";
import { View, Text, Modal, TextInput, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useTheme } from "../../providers/ThemeProvider";
import { useToast } from "../_shared/Toast";
import { useViewsApi } from "./hooks";
import { buildViewFromState, type MobileState } from "./buildViewFromState";
import type { SavedView } from "./applyView";

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved: (view: SavedView) => void;
  entityType: string;
  currentState: MobileState;
  appliedView: SavedView | null;
};

export default function SaveViewModal({
  visible,
  onClose,
  onSaved,
  entityType,
  currentState,
  appliedView,
}: Props) {
  const t = useTheme();
  const toast = useToast();
  const { create, patch } = useViewsApi();

  const isUpdate = Boolean(appliedView?.id);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (visible) {
      // Pre-populate name if updating
      if (isUpdate && appliedView?.name) {
        setName(appliedView.name);
        setDescription(appliedView.description ?? "");
      } else {
        setName("");
        setDescription("");
      }
    }
  }, [visible, isUpdate, appliedView]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast("View name is required", "error");
      return;
    }

    setLoading(true);
    try {
      // Build filters/sort from current state
      const { filters, sort } = buildViewFromState(entityType, currentState);

      const payload = {
        name: name.trim(),
        entityType,
        filters,
        sort,
        ...(description.trim() ? { description: description.trim() } : {}),
      };

      let savedView: any;
      if (isUpdate && appliedView?.id) {
        // Update: use PATCH
        savedView = await patch(appliedView.id, payload);
        toast(`✓ Updated view "${payload.name}"`, "success");
      } else {
        // Create: use POST
        savedView = await create(payload);
        toast(`✓ Saved view "${payload.name}"`, "success");
      }

      if (savedView?.id) {
        onSaved(savedView);
        setName("");
        setDescription("");
        onClose();
      } else {
        toast("Failed to save view (no ID returned)", "error");
      }
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      if (__DEV__) console.warn("[SaveViewModal] error:", errorMsg);
      toast(`✗ Save failed: ${errorMsg.slice(0, 50)}`, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}>
        <View
          style={{
            marginTop: "auto",
            backgroundColor: t.colors.card,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 20,
            maxHeight: "80%",
          }}
        >
          <ScrollView>
            {/* Header */}
            <View style={{ marginBottom: 16 }}>
              <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: "700" }}>
                {isUpdate ? `Update "${appliedView?.name}"` : "Save View"}
              </Text>
              <Text style={{ color: t.colors.textMuted, fontSize: 12, marginTop: 4 }}>
                {isUpdate
                  ? "Update filters and name"
                  : "Save current filters as a reusable view"}
              </Text>
            </View>

            {/* Name field */}
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: t.colors.text, fontSize: 12, fontWeight: "600", marginBottom: 6 }}>
                Name (required)
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g., Draft POs for Vendor X"
                placeholderTextColor={t.colors.textMuted}
                editable={!loading}
                style={{
                  borderWidth: 1,
                  borderColor: t.colors.border,
                  borderRadius: 8,
                  padding: 10,
                  color: t.colors.text,
                  backgroundColor: t.colors.bg,
                }}
              />
            </View>

            {/* Description field */}
            <View style={{ marginBottom: 16 }}>
              <Text style={{ color: t.colors.text, fontSize: 12, fontWeight: "600", marginBottom: 6 }}>
                Description (optional)
              </Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="What does this view capture?"
                placeholderTextColor={t.colors.textMuted}
                editable={!loading}
                multiline
                numberOfLines={2}
                style={{
                  borderWidth: 1,
                  borderColor: t.colors.border,
                  borderRadius: 8,
                  padding: 10,
                  color: t.colors.text,
                  backgroundColor: t.colors.bg,
                  textAlignVertical: "top",
                }}
              />
            </View>

            {/* Action buttons */}
            <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
              <Pressable
                onPress={onClose}
                disabled={loading}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: t.colors.border,
                }}
              >
                <Text style={{ color: t.colors.text, fontWeight: "600" }}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={handleSave}
                disabled={loading || !name.trim()}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 8,
                  backgroundColor: loading || !name.trim() ? t.colors.border : t.colors.primary,
                }}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ color: "#fff", fontWeight: "700" }}>
                    {isUpdate ? "Update View" : "Save View"}
                  </Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
