import React from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../providers/ThemeProvider";
import { useToast } from "../features/_shared/Toast";
import { useWorkspacesApi } from "../features/workspaces/hooks";
import type { WorkspaceItem } from "../features/workspaces/api";
import { buildWorkspacePutPayload } from "../features/workspaces/api";
import { useViewsApi, type View as ViewModel } from "../features/views/hooks";
import type { RootStackParamList } from "../navigation/types";

const PAGE_SIZE = 20;

type RouteParams = { workspaceId: string };

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export default function WorkspaceEditMembershipScreen() {
  const t = useTheme();
  const toast = useToast();
  const navigation = useNavigation<Navigation>();
  const route = useRoute();
  const { workspaceId } = (route.params ?? {}) as RouteParams;

  const { get, patch, put } = useWorkspacesApi();
  const { list } = useViewsApi();

  const [workspace, setWorkspace] = React.useState<WorkspaceItem | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  const [q, setQ] = React.useState("");
  const [views, setViews] = React.useState<ViewModel[]>([]);
  const [nextToken, setNextToken] = React.useState<string | null>(null);
  const [loadingViews, setLoadingViews] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [knownNames, setKnownNames] = React.useState<Record<string, string>>({});

  const entityType = workspace?.entityType;

  const loadWorkspace = React.useCallback(async () => {
    if (!workspaceId) return;
    setLoadingWorkspace(true);
    try {
      const ws = await get(workspaceId);
      setWorkspace(ws);
      const ids = Array.isArray((ws as any).views) ? (ws as any).views.filter(Boolean) : [];
      setSelectedIds(ids);
    } catch (e: any) {
      toast(`✗ Failed to load workspace: ${e?.message ?? String(e)}`, "error");
    } finally {
      setLoadingWorkspace(false);
    }
  }, [get, toast, workspaceId]);

  useFocusEffect(
    React.useCallback(() => {
      loadWorkspace();
    }, [loadWorkspace])
  );

  const loadViews = React.useCallback(
    async (cursor?: string, append = false) => {
      if (!entityType) return;
      const trimmedQ = q.trim();
      const setLoad = append ? setLoadingMore : setLoadingViews;
      setLoad(true);
      try {
        const res = await list({ entityType, q: trimmedQ || undefined, limit: PAGE_SIZE, nextToken: cursor ?? undefined });
        const items = Array.isArray(res?.items) ? res.items : [];
        setViews((prev) => (append ? [...prev, ...items] : items));
        setNextToken((res as any)?.next ?? (res as any)?.nextToken ?? (res as any)?.pageInfo?.nextCursor ?? null);
        setKnownNames((prev) => {
          const updated = { ...prev };
          items.forEach((v) => {
            if (v?.id && v?.name) updated[v.id] = v.name;
          });
          return updated;
        });
      } catch (e: any) {
        toast(`✗ Failed to load views: ${e?.message ?? String(e)}`, "error");
      } finally {
        setLoad(false);
      }
    },
    [entityType, list, q, toast]
  );

  React.useEffect(() => {
    setViews([]);
    setNextToken(null);
    if (entityType) {
      loadViews();
    }
  }, [entityType, q, loadViews]);

  const toggleSelection = React.useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const nameFor = React.useCallback(
    (id: string) => {
      if (knownNames[id]) return knownNames[id];
      const found = views.find((v) => v.id === id);
      return found?.name ?? id;
    },
    [knownNames, views]
  );

  const handleSave = React.useCallback(async () => {
    if (!workspace) return;
    setSaving(true);
    try {
      const payload = buildWorkspacePutPayload(workspace, { views: selectedIds });
      await (put ?? patch)(workspaceId, payload);
      toast("✓ Workspace updated", "success");
      navigation.navigate({ name: "WorkspacesManage", params: { didEdit: true, initialEntityType: workspace.entityType }, merge: true } as any);
      navigation.goBack();
    } catch (e: any) {
      const status = e?.status ? ` (${e.status}${e?.code ? ` ${e.code}` : ""})` : "";
      const msg = e?.body?.message ?? e?.message ?? "Request failed";
      toast(`✗ Update failed: ${msg}${status}`, "error");
    } finally {
      setSaving(false);
    }
  }, [navigation, patch, selectedIds, toast, workspace, workspaceId]);

  const header = (
    <View style={{ padding: 12, borderBottomWidth: 1, borderColor: t.colors.border }}>
      <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: "700" }}>{workspace?.name ?? "Workspace"}</Text>
      {workspace?.entityType ? (
        <Text style={{ color: t.colors.textMuted, marginTop: 4 }}>Entity: {workspace.entityType}</Text>
      ) : null}
    </View>
  );

  const renderSelected = selectedIds.length ? (
    <View style={{ padding: 12, gap: 8 }}>
      <Text style={{ color: t.colors.text, fontWeight: "700" }}>Selected views</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {selectedIds.map((id) => (
          <Pressable
            key={id}
            onPress={() => toggleSelection(id)}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 16,
              backgroundColor: t.colors.primary,
            }}
          >
            <Text style={{ color: t.colors.primaryText ?? "#fff", fontWeight: "700" }}>{nameFor(id)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  ) : (
    <View style={{ padding: 12 }}>
      <Text style={{ color: t.colors.textMuted }}>No views selected yet.</Text>
    </View>
  );

  const renderViewRow = (v: ViewModel) => {
    const selected = selectedIds.includes(v.id);
    return (
      <Pressable
        key={v.id}
        onPress={() => toggleSelection(v.id)}
        style={{
          padding: 12,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: selected ? t.colors.primary : t.colors.border,
          backgroundColor: selected ? t.colors.card : t.colors.bg,
          marginBottom: 8,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={{ color: t.colors.text, fontWeight: "700" }} numberOfLines={1}>
              {v.name ?? v.id}
            </Text>
            <Text style={{ color: t.colors.textMuted, fontSize: 12 }} numberOfLines={1}>
              {v.entityType}
            </Text>
          </View>
          <Text style={{ color: selected ? t.colors.primary : t.colors.text }}>{selected ? "Remove" : "Add"}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      {header}
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 80 }}>
        {loadingWorkspace ? (
          <ActivityIndicator color={t.colors.primary} />
        ) : (
          <>
            {renderSelected}

            <View style={{ marginTop: 8, marginBottom: 8 }}>
              <Text style={{ color: t.colors.text, fontWeight: "700", marginBottom: 8 }}>Add or remove views</Text>
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Search views by name"
                placeholderTextColor={t.colors.textMuted}
                style={{
                  borderWidth: 1,
                  borderColor: t.colors.border,
                  borderRadius: 8,
                  padding: 10,
                  color: t.colors.text,
                  backgroundColor: t.colors.card,
                  marginBottom: 12,
                }}
              />
              {loadingViews && views.length === 0 ? <ActivityIndicator color={t.colors.primary} /> : null}
              {views.map(renderViewRow)}
              {nextToken ? (
                <Pressable
                  onPress={() => loadViews(nextToken, true)}
                  disabled={loadingMore}
                  style={{
                    paddingVertical: 12,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: t.colors.primary,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {loadingMore ? (
                    <ActivityIndicator color={t.colors.primary} />
                  ) : (
                    <Text style={{ color: t.colors.primary, fontWeight: "700" }}>Load more</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
      <View style={{ flexDirection: "row", padding: 12, borderTopWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.card }}>
        <Pressable
          onPress={() => navigation.goBack()}
          disabled={saving}
          style={{ paddingHorizontal: 14, paddingVertical: 10 }}
        >
          <Text style={{ color: t.colors.text }}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={saving || !workspace}
          style={{
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: 8,
            backgroundColor: t.colors.primary,
            marginLeft: "auto",
            opacity: saving || !workspace ? 0.6 : 1,
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
  );
}
