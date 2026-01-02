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
  const { list: listViews, get: getView } = useViewsApi();

  const [views, setViews] = React.useState<SavedView[]>([]);
  const [loadingViews, setLoadingViews] = React.useState(false);
  const [viewMetadata, setViewMetadata] = React.useState<Record<string, SavedView | null>>({});
  const [viewErrors, setViewErrors] = React.useState<Record<string, string>>({});

  const [editVisible, setEditVisible] = React.useState(false);
  const [selectedViews, setSelectedViews] = React.useState<string[]>([]);
  const [selectedDefault, setSelectedDefault] = React.useState<string | null>(null);
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

  // Hydrate metadata for workspace.views[] (independent of workspace.entityType)
  React.useEffect(() => {
    const ids = (workspace?.views ?? []).filter((v): v is string => typeof v === "string");
    const missing = ids.filter((id) => !(id in viewMetadata));
    if (missing.length === 0) return;

    let cancelled = false;
    async function load() {
      const results = await Promise.allSettled(
        missing.map((id) => getView(id).then((data) => ({ id, data })))
      );
      if (cancelled) return;
      setViewMetadata((prev) => {
        const next = { ...prev } as Record<string, SavedView | null>;
        results.forEach((res, idx) => {
          const id = res.status === "fulfilled" ? res.value.id : missing[idx];
          next[id] = res.status === "fulfilled" ? res.value.data : null;
        });
        return next;
      });
      setViewErrors((prev) => {
        const next = { ...prev } as Record<string, string>;
        results.forEach((res, idx) => {
          const id = res.status === "fulfilled" ? res.value.id : missing[idx];
          if (res.status === "rejected") {
            next[id] = String(res.reason?.message || res.reason || "Failed to load view");
          }
        });
        return next;
      });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [getView, viewMetadata, workspace?.views]);

  // Sync selected views when workspace changes
  React.useEffect(() => {
    if (workspace?.views) {
      setSelectedViews(workspace.views);
      setSelectedDefault(workspace.defaultViewId ?? null);
    }
  }, [workspace]);

  const toggleView = React.useCallback((id: string) => {
    setSelectedViews((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }, []);

  const toggleDefault = React.useCallback((id: string) => {
    setSelectedDefault((prev) => (prev === id ? null : id));
  }, []);

  const openView = React.useCallback(
    (viewId: string) => {
      const meta = viewMetadata[viewId] || views.find((v) => v.id === viewId) || null;
      const resolvedEntity = meta?.entityType || workspace?.entityType;
      if (resolvedEntity) {
        const routeName = ROUTE_BY_ENTITY[resolvedEntity];
        if (routeName) {
          navigation.navigate(routeName as any, { viewId } as any);
          return;
        }
      }
      if (meta?.id) {
        toast("No list screen for this view entity type", "warning");
        return;
      }
      toast("Unable to open view: missing entity type", "warning");
    },
    [navigation, toast, viewMetadata, views, workspace?.entityType]
  );

  const openEdit = React.useCallback(() => {
    if (!workspace?.entityType) {
      toast("Workspace entity type missing", "warning");
      return;
    }
    setSelectedViews(workspace.views ?? []);
    setSelectedDefault(workspace.defaultViewId ?? null);
    setEditVisible(true);
  }, [toast, workspace]);

  const closeEdit = React.useCallback(() => {
    setEditVisible(false);
    setSaving(false);
  }, []);

  const handleSave = React.useCallback(async () => {
    if (!workspace?.id) return;
    setSaving(true);

    // Check for entityType mismatches if workspace.entityType is set
    if (workspace.entityType) {
      const mismatches: string[] = [];
      for (const viewId of selectedViews) {
        const meta = viewMetadata[viewId] || views.find((v) => v.id === viewId) || null;
        if (meta?.entityType && meta.entityType !== workspace.entityType) {
          mismatches.push(`${meta.name || viewId} (${meta.entityType})`);
        }
      }
      if (mismatches.length > 0) {
        toast(
          `✗ Cannot save: ${mismatches.length} view(s) have mismatched entity types: ${mismatches.join(", ")}`,
          "error"
        );
        setSaving(false);
        return;
      }
    }

    // If defaultViewId is set but not in selectedViews, clear it
    const finalDefaultViewId = selectedDefault && selectedViews.includes(selectedDefault) ? selectedDefault : null;

    try {
      await patch(workspace.id, {
        views: selectedViews,
        defaultViewId: finalDefaultViewId,
      });
      toast("✓ Updated workspace", "success");
      closeEdit();
      refetch();
    } catch (e: any) {
      toast(`✗ Update failed: ${e?.message ?? String(e)}`, "error");
    } finally {
      setSaving(false);
    }
  }, [closeEdit, patch, refetch, selectedViews, selectedDefault, toast, workspace?.id, workspace?.entityType, viewMetadata, views]);

  const renderMember = (viewId: string) => {
    const meta = viewMetadata[viewId] || views.find((vv) => vv.id === viewId) || null;
    const name = meta?.name || viewId;
    const description = meta?.description;
    const entityType = meta?.entityType || workspace?.entityType;
    const err = viewErrors[viewId];
    const isDefault = workspace?.defaultViewId === viewId;
    return (
      <Pressable
        key={viewId}
        onPress={() => openView(viewId)}
        style={{
          padding: 12,
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: 8,
          backgroundColor: isDefault ? "#e0f0ff" : t.colors.card,
          marginBottom: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
          <Text style={{ color: t.colors.text, fontWeight: "600", flex: 1 }}>{name}</Text>
          {isDefault && (
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 4,
                backgroundColor: t.colors.primary,
              }}
            >
              <Text style={{ color: t.colors.primaryText ?? "#fff", fontSize: 10, fontWeight: "700" }}>
                DEFAULT
              </Text>
            </View>
          )}
        </View>
        {description ? (
          <Text style={{ color: t.colors.textMuted, fontSize: 12, marginTop: 4 }} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
        <Text style={{ color: t.colors.textMuted, fontSize: 12, marginTop: 4 }}>
          {entityType ? `Entity: ${entityType}` : "Entity: (unknown)"}
        </Text>
        {err ? (
          <Text style={{ color: t.colors.danger ?? "#c00", fontSize: 12, marginTop: 4 }}>
            {err}
          </Text>
        ) : (
          <Text style={{ color: t.colors.textMuted, fontSize: 12, marginTop: 4 }}>Tap to open</Text>
        )}
      </Pressable>
    );
  };

  const renderCheckboxRow = (view: SavedView) => {
    const checked = selectedViews.includes(view.id);
    const isDefault = selectedDefault === view.id;
    const isMismatched = workspace?.entityType && view.entityType && view.entityType !== workspace.entityType;
    const canSelect = !isMismatched;
    const canBeDefault = checked && !isMismatched;

    return (
      <View
        key={view.id}
        style={{
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderColor: t.colors.border,
          opacity: canSelect ? 1 : 0.5,
        }}
      >
        <Pressable
          onPress={() => canSelect && toggleView(view.id)}
          disabled={!canSelect}
          style={{
            flexDirection: "row",
            alignItems: "center",
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <Text style={{ color: t.colors.text, fontWeight: "600" }}>{view.name || view.id}</Text>
              {isMismatched && (
                <View
                  style={{
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                    borderRadius: 4,
                    backgroundColor: t.colors.danger ?? "crimson",
                  }}
                >
                  <Text style={{ color: t.colors.primaryText ?? "#fff", fontSize: 10, fontWeight: "700" }}>
                    Mismatch
                  </Text>
                </View>
              )}
              {isDefault && (
                <View
                  style={{
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                    borderRadius: 4,
                    backgroundColor: t.colors.primary,
                  }}
                >
                  <Text style={{ color: t.colors.primaryText ?? "#fff", fontSize: 10, fontWeight: "700" }}>
                    DEFAULT
                  </Text>
                </View>
              )}
            </View>
            {view.description ? (
              <Text style={{ color: t.colors.textMuted, fontSize: 12 }} numberOfLines={1}>
                {view.description}
              </Text>
            ) : null}
            <Text style={{ color: t.colors.textMuted, fontSize: 11, marginTop: 2 }}>
              Entity: {view.entityType || "(unknown)"}
            </Text>
          </View>
        </Pressable>
        {canBeDefault && (
          <Pressable
            onPress={() => toggleDefault(view.id)}
            style={{
              marginTop: 8,
              marginLeft: 32,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: isDefault ? t.colors.border : t.colors.primary,
              backgroundColor: isDefault ? t.colors.card : "transparent",
              alignSelf: "flex-start",
            }}
          >
            <Text
              style={{
                color: isDefault ? t.colors.textMuted : t.colors.primary,
                fontSize: 12,
                fontWeight: "600",
              }}
            >
              {isDefault ? "Unset Default" : "Set as Default"}
            </Text>
          </Pressable>
        )}
      </View>
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
