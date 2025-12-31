import React from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../providers/ThemeProvider";
import { useToast } from "../features/_shared/Toast";
import { useWorkspaceItem, useWorkspacesApi } from "../features/workspaces/hooks";
import { useViewsApi, type View as SavedView } from "../features/views/hooks";
import type { RootStackParamList } from "../navigation/types";

const ROUTE_BY_ENTITY: Record<string, keyof RootStackParamList> = {
  purchaseOrder: "PurchaseOrdersList",
  salesOrder: "SalesOrdersList",
  inventoryItem: "InventoryList",
  party: "PartyList",
  product: "ProductsList",
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

type RouteParams = { workspaceId: string };

export default function WorkspaceDetailScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute();
  const { workspaceId } = (route.params as RouteParams) ?? { workspaceId: undefined };
  const t = useTheme();
  const toast = useToast();

  const { data: workspace, isLoading, error, refetch } = useWorkspaceItem(workspaceId);
  const { patch } = useWorkspacesApi();
  const { list: listViews } = useViewsApi();

  const [views, setViews] = React.useState<SavedView[]>([]);
  const [loadingViews, setLoadingViews] = React.useState(false);

  const [editVisible, setEditVisible] = React.useState(false);
  const [selectedViews, setSelectedViews] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);

  // Load available views for this workspace entity type
  React.useEffect(() => {
    const entityType = workspace?.entityType;
    if (!entityType) return;
    let cancelled = false;
    async function loadViews() {
      setLoadingViews(true);
      try {
        const res = await listViews({ entityType, limit: 200 });
        if (!cancelled) setViews(res.items ?? []);
      } catch (e: any) {
        if (!cancelled) toast(`✗ Failed to load views: ${e?.message ?? String(e)}`, "error");
      } finally {
        if (!cancelled) setLoadingViews(false);
      }
    }
    loadViews();
    return () => {
      cancelled = true;
    };
  }, [listViews, toast, workspace?.entityType]);

  // Sync selected views when workspace changes
  React.useEffect(() => {
    if (workspace?.views) {
      setSelectedViews(workspace.views);
    }
  }, [workspace]);

  const toggleView = React.useCallback((id: string) => {
    setSelectedViews((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }, []);

  const openView = React.useCallback(
    (viewId: string) => {
      const entityType = workspace?.entityType;
      if (!entityType) return;
      const routeName = ROUTE_BY_ENTITY[entityType];
      if (!routeName) {
        toast("Unsupported entity type for navigation", "warning");
        return;
      }
      navigation.navigate(routeName as any, { viewId } as any);
    },
    [navigation, toast, workspace?.entityType]
  );

  const openEdit = React.useCallback(() => {
    if (!workspace?.entityType) {
      toast("Workspace entity type missing", "warning");
      return;
    }
    setSelectedViews(workspace.views ?? []);
    setEditVisible(true);
  }, [toast, workspace]);

  const closeEdit = React.useCallback(() => {
    setEditVisible(false);
    setSaving(false);
  }, []);

  const handleSave = React.useCallback(async () => {
    if (!workspace?.id || !workspace.entityType) return;
    setSaving(true);
    try {
      await patch(workspace.id, {
        views: selectedViews,
      });
      toast("✓ Updated workspace", "success");
      closeEdit();
      refetch();
    } catch (e: any) {
      toast(`✗ Update failed: ${e?.message ?? String(e)}`, "error");
    } finally {
      setSaving(false);
    }
  }, [closeEdit, patch, refetch, selectedViews, toast, workspace?.id]);

  const renderMember = (viewId: string) => {
    const v = views.find((vv) => vv.id === viewId);
    const name = v?.name || viewId;
    return (
      <Pressable
        key={viewId}
        onPress={() => openView(viewId)}
        style={{
          padding: 12,
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: 8,
          backgroundColor: t.colors.card,
          marginBottom: 8,
        }}
      >
        <Text style={{ color: t.colors.text, fontWeight: "600" }}>{name}</Text>
        <Text style={{ color: t.colors.textMuted, fontSize: 12, marginTop: 4 }}>Tap to open</Text>
      </Pressable>
    );
  };

  const renderCheckboxRow = (view: SavedView) => {
    const checked = selectedViews.includes(view.id);
    return (
      <Pressable
        key={view.id}
        onPress={() => toggleView(view.id)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderColor: t.colors.border,
        }}
      >
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: checked ? t.colors.primary : t.colors.border,
            backgroundColor: checked ? t.colors.primary : "transparent",
            marginRight: 12,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {checked ? <Text style={{ color: t.colors.primaryText ?? "#fff", fontWeight: "700" }}>✓</Text> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.colors.text, fontWeight: "600" }}>{view.name || view.id}</Text>
          {view.description ? (
            <Text style={{ color: t.colors.textMuted, fontSize: 12 }} numberOfLines={1}>
              {view.description}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
      >
        {error ? (
          <View style={{ padding: 16, backgroundColor: t.colors.card, borderRadius: 8, marginBottom: 12 }}>
            <Text style={{ color: t.colors.textMuted }}>Error loading workspace: {String(error)}</Text>
          </View>
        ) : null}

        {isLoading && !workspace ? <ActivityIndicator /> : null}

        {workspace ? (
          <>
            <View
              style={{
                padding: 12,
                borderWidth: 1,
                borderColor: t.colors.border,
                borderRadius: 8,
                backgroundColor: t.colors.card,
                marginBottom: 12,
              }}
            >
              <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: "700" }}>{workspace.name || workspace.id}</Text>
              <View
                style={{
                  alignSelf: "flex-start",
                  marginTop: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 12,
                  backgroundColor: t.colors.primary,
                }}
              >
                <Text style={{ color: t.colors.primaryText ?? "#fff", fontWeight: "700", fontSize: 12 }}>
                  {workspace.entityType}
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text style={{ color: t.colors.text, fontSize: 16, fontWeight: "700" }}>Views</Text>
              <Pressable
                onPress={openEdit}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: t.colors.primary,
                  backgroundColor: t.colors.card,
                }}
              >
                <Text style={{ color: t.colors.primary, fontWeight: "700" }}>Edit views</Text>
              </Pressable>
            </View>

            {loadingViews ? <ActivityIndicator /> : null}

            {(!workspace.views || workspace.views.length === 0) && !loadingViews ? (
              <View style={{ padding: 16, backgroundColor: t.colors.card, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border }}>
                <Text style={{ color: t.colors.textMuted, marginBottom: 8 }}>No views in this workspace yet.</Text>
                <Pressable
                  onPress={() => navigation.navigate("ViewsManage", { initialEntityType: workspace.entityType } as any)}
                  style={{
                    alignSelf: "flex-start",
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: t.colors.primary,
                  }}
                >
                  <Text style={{ color: t.colors.primary, fontWeight: "700" }}>Manage Views</Text>
                </Pressable>
              </View>
            ) : null}

            {workspace.views?.map(renderMember)}
          </>
        ) : null}
      </ScrollView>

      <Modal visible={editVisible} transparent animationType="fade" onRequestClose={closeEdit}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <View style={{ width: "100%", maxWidth: 520, backgroundColor: t.colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: t.colors.border }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Text style={{ color: t.colors.text, fontSize: 16, fontWeight: "700" }}>Select Views</Text>
              <Pressable onPress={closeEdit}>
                <Text style={{ color: t.colors.text }}>Close</Text>
              </Pressable>
            </View>

            {loadingViews ? (
              <ActivityIndicator />
            ) : views.length === 0 ? (
              <View style={{ paddingVertical: 16 }}>
                <Text style={{ color: t.colors.textMuted, marginBottom: 8 }}>No views available for this entity type.</Text>
                <Pressable
                  onPress={() => {
                    closeEdit();
                    navigation.navigate("ViewsManage", { initialEntityType: workspace?.entityType } as any);
                  }}
                  style={{
                    alignSelf: "flex-start",
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: t.colors.primary,
                  }}
                >
                  <Text style={{ color: t.colors.primary, fontWeight: "700" }}>Manage Views</Text>
                </Pressable>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 360 }}>
                {views.map(renderCheckboxRow)}
              </ScrollView>
            )}

            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <Pressable onPress={closeEdit} style={{ paddingHorizontal: 12, paddingVertical: 10 }} disabled={saving}>
                <Text style={{ color: t.colors.text }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
                disabled={saving || loadingViews}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 8,
                  backgroundColor: t.colors.primary,
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? (
                  <ActivityIndicator color={t.colors.primaryText ?? "#fff"} />
                ) : (
                  <Text style={{ color: t.colors.primaryText ?? "#fff", fontWeight: "700" }}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
