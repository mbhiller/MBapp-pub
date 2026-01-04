import React from "react";
import { View, Text, TextInput, ScrollView, Pressable, ActivityIndicator, Alert, Modal } from "react-native";
import { useTheme } from "../providers/ThemeProvider";
import { useToast } from "../features/_shared/Toast";
import { useViewsApi, type View as SavedView } from "../features/views/hooks";
import { usePolicy } from "../providers/PolicyProvider";
import { hasPerm } from "../lib/permissions";
import { PERM_VIEW_WRITE } from "../generated/permissions";

const ENTITY_OPTIONS: Array<{ label: string; value?: string }> = [
  { label: "All" },
  { label: "PO", value: "purchaseOrder" },
  { label: "SO", value: "salesOrder" },
];

export default function ViewsManageScreen({ route }: any) {
  const t = useTheme();
  const toast = useToast();
  const { list, patch, del } = useViewsApi();
  const { policy, policyLoading } = usePolicy();

  const canWriteViews = !policyLoading && hasPerm(policy, PERM_VIEW_WRITE);

  const initialEntityType = route?.params?.initialEntityType as string | undefined;
  const [entityType, setEntityType] = React.useState<string | undefined>(initialEntityType);
  const [q, setQ] = React.useState("");
  const [items, setItems] = React.useState<SavedView[]>([]);
  const [nextToken, setNextToken] = React.useState<string | null | undefined>(undefined);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);

  const [renameTarget, setRenameTarget] = React.useState<SavedView | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [renaming, setRenaming] = React.useState(false);

  const fetchPage = React.useCallback(
    async (cursor?: string, append = false) => {
      const trimmedQ = q.trim();
      const params = {
        entityType,
        q: trimmedQ.length > 0 ? trimmedQ : undefined,
        limit: 25,
        nextToken: cursor,
      } as { entityType?: string; q?: string; limit: number; nextToken?: string };
      const setLoad = append ? setLoadingMore : setLoading;
      setLoad(true);
      try {
        const res = await list(params);
        setItems((prev) => (append ? [...prev, ...(res.items ?? [])] : res.items ?? []));
        setNextToken(res.next ?? null);
      } catch (e: any) {
        toast(`✗ Failed to load views: ${e?.message ?? String(e)}`, "error");
      } finally {
        setLoad(false);
      }
    },
    [entityType, list, q, toast]
  );

  React.useEffect(() => {
    fetchPage(undefined, false);
  }, [entityType, q, fetchPage]);

  const onLoadMore = React.useCallback(() => {
    if (!nextToken) return;
    fetchPage(nextToken, true);
  }, [fetchPage, nextToken]);

  const openRename = React.useCallback((view: SavedView) => {
    setRenameTarget(view);
    setRenameValue(view.name ?? "");
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
    setRenaming(true);
    try {
      await patch(renameTarget.id, { name: trimmed });
      toast("✓ Renamed view", "success");
      closeRename();
      fetchPage(undefined, false);
    } catch (e: any) {
      if (e?.status === 403) {
        toast("Access denied — required: view:write", "error");
      } else {
        toast(`✗ Rename failed: ${e?.message ?? String(e)}`, "error");
      }
    } finally {
      setRenaming(false);
    }
  }, [closeRename, fetchPage, patch, renameTarget, renameValue, toast]);

  const handleDelete = React.useCallback(
    (view: SavedView) => {
      Alert.alert("Delete view", `Delete “${view.name ?? view.id}”?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await del(view.id);
              toast("✓ Deleted view", "success");
              fetchPage(undefined, false);
            } catch (e: any) {
              if (e?.status === 403) {
                toast("Access denied — required: view:write", "error");
              } else {
                toast(`✗ Delete failed: ${e?.message ?? String(e)}`, "error");
              }
            }
          },
        },
      ]);
    },
    [del, fetchPage, toast]
  );

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

  const renderRow = (view: SavedView) => {
    return (
      <View
        key={view.id}
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
            {view.name || view.id}
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
              {view.entityType}
            </Text>
          </View>
        </View>
        {view.updatedAt ? (
          <Text style={{ color: t.colors.textMuted, fontSize: 12, marginBottom: 8 }}>
            Updated {new Date(view.updatedAt).toLocaleString()}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={() => {
              if (!canWriteViews) {
                toast("Access denied — required: view:write", "warning");
                return;
              }
              openRename(view);
            }}
            disabled={!canWriteViews}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: t.colors.primary,
              alignItems: "center",
              justifyContent: "center",
              opacity: canWriteViews ? 1 : 0.5,
            }}
          >
            <Text style={{ color: t.colors.primary, fontWeight: "700" }}>Rename</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (!canWriteViews) {
                toast("Access denied — required: view:write", "warning");
                return;
              }
              handleDelete(view);
            }}
            disabled={!canWriteViews}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: t.colors.danger ?? "#c33",
              alignItems: "center",
              justifyContent: "center",
              opacity: canWriteViews ? 1 : 0.5,
            }}
          >
            <Text style={{ color: t.colors.danger ?? "#c33", fontWeight: "700" }}>Delete</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 32 }}>
        <Text style={{ color: t.colors.text, fontSize: 18, fontWeight: "700", marginBottom: 12 }}>Views</Text>

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
            <Text style={{ color: t.colors.textMuted, textAlign: "center" }}>No views match your filters.</Text>
          </View>
        ) : (
          items.map(renderRow)
        )}

        {nextToken ? (
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
            <Text style={{ color: t.colors.text, fontSize: 16, fontWeight: "700", marginBottom: 12 }}>Rename View</Text>
            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="View name"
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
    </View>
  );
}
