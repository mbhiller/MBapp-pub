import React from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Modal,
  Switch,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useTheme } from "../providers/ThemeProvider";
import { useToast } from "../features/_shared/Toast";
import { useWorkspacesApi } from "../features/workspaces/hooks";
import type { WorkspaceItem, CreateWorkspacePayload } from "../features/workspaces/api";
import { buildWorkspacePutPayload } from "../features/workspaces/api";
import type { RootStackParamList } from "../navigation/types";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

const ENTITY_OPTIONS: Array<{ label: string; value?: string }> = [
  { label: "All" },
  { label: "PO", value: "purchaseOrder" },
  { label: "SO", value: "salesOrder" },
];

export default function WorkspacesManageScreen({ route }: any) {
  const t = useTheme();
  const toast = useToast();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { list, create, patch, put, del } = useWorkspacesApi();

  const initialEntityType = route?.params?.initialEntityType as string | undefined;
  const [entityType, setEntityType] = React.useState<string | undefined>(initialEntityType);
  const [q, setQ] = React.useState("");
  const [items, setItems] = React.useState<WorkspaceItem[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null | undefined>(undefined);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);

  const [renameTarget, setRenameTarget] = React.useState<WorkspaceItem | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [renaming, setRenaming] = React.useState(false);

  const [createVisible, setCreateVisible] = React.useState(false);
  const [createPayload, setCreatePayload] = React.useState<CreateWorkspacePayload>(() => ({
    name: "",
    entityType: initialEntityType ?? "purchaseOrder",
    shared: false,
    views: [],
  }));
  const [creating, setCreating] = React.useState(false);

  const fetchPage = React.useCallback(
    async (cursor?: string, append = false) => {
      const trimmedQ = q.trim();
      const params = {
        entityType,
        q: trimmedQ.length > 0 ? trimmedQ : undefined,
        limit: 25,
        next: cursor,
      } as { entityType?: string; q?: string; limit: number; next?: string };
      const setLoad = append ? setLoadingMore : setLoading;
      setLoad(true);
      try {
        const res = await list(params);
        const pageItems = res.items ?? [];
        const cursorNext = (res as any).next ?? res.pageInfo?.nextCursor ?? null;
        setItems((prev) => (append ? [...prev, ...pageItems] : pageItems));
        setNextCursor(cursorNext ?? null);
      } catch (e: any) {
        toast(`✗ Failed to load workspaces: ${e?.message ?? String(e)}`, "error");
      } finally {
        setLoad(false);
      }
    },
    [entityType, list, q, toast]
  );

  React.useEffect(() => {
    fetchPage(undefined, false);
  }, [entityType, q, fetchPage]);

  useFocusEffect(
    React.useCallback(() => {
      if (route?.params?.didEdit) {
        fetchPage(undefined, false);
        navigation.setParams?.({ ...(route.params || {}), didEdit: undefined });
      }
    }, [fetchPage, navigation, route?.params])
  );

  const onLoadMore = React.useCallback(() => {
    if (!nextCursor) return;
    fetchPage(nextCursor, true);
  }, [fetchPage, nextCursor]);

  const openRename = React.useCallback((workspace: WorkspaceItem) => {
    setRenameTarget(workspace);
    setRenameValue(workspace.name ?? "");
  }, []);

  const closeRename = React.useCallback(() => {
    setRenameTarget(null);
    setRenameValue("");
    setRenaming(false);
  }, []);

  const handleRename = React.useCallback(async () => {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      toast("Name is required", "warning");
      return;
    }
    if (trimmed.length > 200) {
      toast("Name must be 200 characters or fewer", "warning");
      return;
    }
    setRenaming(true);
    try {
      const payload = buildWorkspacePutPayload(renameTarget, { name: trimmed });
      await (put ?? patch)(renameTarget.id, payload);
      toast("✓ Renamed workspace", "success");
      closeRename();
      fetchPage(undefined, false);
    } catch (e: any) {
      toast(`✗ Rename failed: ${e?.message ?? String(e)}` , "error");
    } finally {
      setRenaming(false);
    }
  }, [closeRename, fetchPage, patch, renameTarget, renameValue, toast]);

  const handleDelete = React.useCallback(
    (workspace: WorkspaceItem) => {
      Alert.alert("Delete workspace", `Delete “${workspace.name ?? workspace.id}”?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await del(workspace.id);
              toast("✓ Deleted workspace", "success");
              fetchPage(undefined, false);
            } catch (e: any) {
              toast(`✗ Delete failed: ${e?.message ?? String(e)}`, "error");
            }
          },
        },
      ]);
    },
    [del, fetchPage, toast]
  );

  const openCreate = React.useCallback(() => {
    setCreatePayload({
      name: "",
      entityType: entityType ?? "purchaseOrder",
      shared: false,
      views: [],
    });
    setCreateVisible(true);
  }, [entityType]);

  const closeCreate = React.useCallback(() => {
    setCreateVisible(false);
    setCreating(false);
  }, []);

  const handleCreate = React.useCallback(async () => {
    const trimmed = createPayload.name.trim();
    if (!trimmed) {
      toast("Name is required", "warning");
      return;
    }
    if (trimmed.length > 200) {
      toast("Name must be 200 characters or fewer", "warning");
      return;
    }
    if (!createPayload.entityType) {
      toast("Entity type is required", "warning");
      return;
    }
    setCreating(true);
    try {
      await create({
        name: trimmed,
        entityType: createPayload.entityType,
        shared: createPayload.shared ?? false,
        filters: createPayload.filters ?? [],
        columns: createPayload.columns ?? [],
        views: createPayload.views ?? [],
      });
      toast("✓ Created workspace", "success");
      closeCreate();
      fetchPage(undefined, false);
    } catch (e: any) {
      toast(`✗ Create failed: ${e?.message ?? String(e)}`, "error");
    } finally {
      setCreating(false);
    }
  }, [closeCreate, create, createPayload, fetchPage, toast]);

  const renderChips = ENTITY_OPTIONS.map((opt) => {
    const selected = entityType === opt.value || (!opt.value && !entityType);
    return (
      <Pressable
        key={opt.label}
        onPress={() => setEntityType(opt.value)}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 16,
          backgroundColor: selected ? t.colors.primary : t.colors.card,
          borderWidth: 1,
          borderColor: selected ? t.colors.primary : t.colors.border,
          marginRight: 8,
        }}
      >
        <Text style={{ color: selected ? t.colors.primaryText ?? "#fff" : t.colors.text, fontWeight: selected ? "700" : "500" }}>
          {opt.label}
        </Text>
      </Pressable>
    );
  });

  const renderRow = (workspace: WorkspaceItem) => {
    const viewCount = Array.isArray((workspace as any).views) ? (workspace as any).views.length : 0;
    return (
      <Pressable
        key={workspace.id}
        onPress={() => navigation.navigate("WorkspaceDetail", { workspaceId: workspace.id })}
        style={{
          padding: 12,
          backgroundColor: t.colors.card,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: t.colors.border,
          marginBottom: 8,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <Text style={{ color: t.colors.text, fontWeight: "700", flex: 1, marginRight: 8 }} numberOfLines={1}>
            {workspace.name || workspace.id}
          </Text>
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 12,
              backgroundColor: t.colors.primary,
            }}
          >
            <Text style={{ color: t.colors.primaryText ?? "#fff", fontSize: 12, fontWeight: "700" }}>
              {workspace.entityType}
            </Text>
          </View>
        </View>
        <Text style={{ color: t.colors.textMuted, fontSize: 12, marginBottom: 8 }}>
          Views: {viewCount}
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={() => navigation.navigate("WorkspaceEditMembership", { workspaceId: workspace.id })}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: t.colors.primary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: t.colors.primary, fontWeight: "700" }}>Edit views</Text>
          </Pressable>
          <Pressable
            onPress={() => openRename(workspace)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: t.colors.primary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: t.colors.primary, fontWeight: "700" }}>Rename</Text>
          </Pressable>
          <Pressable
            onPress={() => handleDelete(workspace)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: t.colors.danger ?? "#c33",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: t.colors.danger ?? "#c33", fontWeight: "700" }}>Delete</Text>
          </Pressable>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 32 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: "700" }}>Workspaces</Text>
          <Pressable
            onPress={openCreate}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 8,
              backgroundColor: t.colors.primary,
            }}
          >
            <Text style={{ color: t.colors.primaryText ?? "#fff", fontWeight: "700" }}>Create</Text>
          </Pressable>
        </View>

        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search by name"
          placeholderTextColor={t.colors.textMuted}
          style={{
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: 8,
            padding: 10,
            color: t.colors.text,
            backgroundColor: t.colors.card,
            marginBottom: 10,
          }}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: "row", marginBottom: 12 }}>
          {renderChips}
        </ScrollView>

        {loading && items.length === 0 ? <ActivityIndicator /> : null}

        {!loading && items.length === 0 ? (
          <View style={{ padding: 16 }}>
            <Text style={{ color: t.colors.textMuted, textAlign: "center" }}>No workspaces match your filters.</Text>
          </View>
        ) : (
          items.map(renderRow)
        )}

        {nextCursor ? (
          <Pressable
            onPress={onLoadMore}
            disabled={loadingMore}
            style={{
              paddingVertical: 12,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: t.colors.primary,
              alignItems: "center",
              justifyContent: "center",
              marginTop: 8,
            }}
          >
            {loadingMore ? (
              <ActivityIndicator color={t.colors.primary} />
            ) : (
              <Text style={{ color: t.colors.primary, fontWeight: "700" }}>Load more</Text>
            )}
          </Pressable>
        ) : null}
      </ScrollView>

      <Modal visible={!!renameTarget} transparent animationType="fade" onRequestClose={closeRename}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <View style={{ width: "100%", maxWidth: 420, backgroundColor: t.colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: t.colors.border }}>
            <Text style={{ color: t.colors.text, fontSize: 16, fontWeight: "700", marginBottom: 12 }}>Rename Workspace</Text>
            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="Workspace name"
              placeholderTextColor={t.colors.textMuted}
              style={{
                borderWidth: 1,
                borderColor: t.colors.border,
                borderRadius: 8,
                padding: 10,
                color: t.colors.text,
                backgroundColor: t.colors.bg,
                marginBottom: 16,
              }}
            />
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
              <Pressable onPress={closeRename} style={{ paddingHorizontal: 12, paddingVertical: 10 }} disabled={renaming}>
                <Text style={{ color: t.colors.text }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleRename}
                disabled={renaming}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 8,
                  backgroundColor: t.colors.primary,
                  opacity: renaming ? 0.7 : 1,
                }}
              >
                {renaming ? (
                  <ActivityIndicator color={t.colors.primaryText ?? "#fff"} />
                ) : (
                  <Text style={{ color: t.colors.primaryText ?? "#fff", fontWeight: "700" }}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={createVisible} transparent animationType="fade" onRequestClose={closeCreate}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <View style={{ width: "100%", maxWidth: 460, backgroundColor: t.colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: t.colors.border }}>
            <Text style={{ color: t.colors.text, fontSize: 16, fontWeight: "700", marginBottom: 12 }}>Create Workspace</Text>
            <TextInput
              value={createPayload.name}
              onChangeText={(v) => setCreatePayload((p) => ({ ...p, name: v }))}
              placeholder="Workspace name"
              placeholderTextColor={t.colors.textMuted}
              style={{
                borderWidth: 1,
                borderColor: t.colors.border,
                borderRadius: 8,
                padding: 10,
                color: t.colors.text,
                backgroundColor: t.colors.bg,
                marginBottom: 12,
              }}
            />
            <Text style={{ color: t.colors.text, marginBottom: 6 }}>Entity type</Text>
            <View style={{ flexDirection: "row", marginBottom: 12 }}>
              {ENTITY_OPTIONS.filter((o) => o.value).map((opt) => {
                const selected = createPayload.entityType === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setCreatePayload((p) => ({ ...p, entityType: opt.value || "" }))}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 16,
                      backgroundColor: selected ? t.colors.primary : t.colors.card,
                      borderWidth: 1,
                      borderColor: selected ? t.colors.primary : t.colors.border,
                      marginRight: 8,
                    }}
                  >
                    <Text style={{ color: selected ? t.colors.primaryText ?? "#fff" : t.colors.text, fontWeight: selected ? "700" : "500" }}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
              <Switch
                value={!!createPayload.shared}
                onValueChange={(v) => setCreatePayload((p) => ({ ...p, shared: v }))}
                trackColor={{ false: t.colors.border, true: t.colors.primary }}
                thumbColor={t.colors.card}
              />
              <Text style={{ color: t.colors.text, marginLeft: 8 }}>Shared</Text>
            </View>

            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
              <Pressable onPress={closeCreate} style={{ paddingHorizontal: 12, paddingVertical: 10 }} disabled={creating}>
                <Text style={{ color: t.colors.text }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleCreate}
                disabled={creating}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 8,
                  backgroundColor: t.colors.primary,
                  opacity: creating ? 0.7 : 1,
                }}
              >
                {creating ? (
                  <ActivityIndicator color={t.colors.primaryText ?? "#fff"} />
                ) : (
                  <Text style={{ color: t.colors.primaryText ?? "#fff", fontWeight: "700" }}>Create</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
