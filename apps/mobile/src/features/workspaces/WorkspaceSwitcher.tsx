// apps/mobile/src/features/workspaces/WorkspaceSwitcher.tsx
import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { useWorkspace } from "./WorkspaceContext";
import { workspacesApi } from "./api";
import { useColors } from "../_shared/useColors";

export function WorkspaceSwitcher() {
  const t = useColors();
  const { workspaceId, setWorkspaceId } = useWorkspace();
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<Array<{ id: string; name: string }>>([]);

  React.useEffect(() => {
    workspacesApi
      .list()
      .then((ws) => setItems((ws?.items ?? []).map((item) => ({ id: item.id, name: item.name }))))
      .catch(() => {});
  }, []);

  const current = items.find((w) => w.id === workspaceId);

  return (
    <View style={{ position: "relative" }}>
      <Pressable
        onPress={() => setOpen(o => !o)}
        style={{ borderWidth: 1, borderColor: t.colors.border, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: t.colors.card }}
      >
        <Text style={{ color: t.colors.text, fontWeight: "700" }}>
          {current ? current.name : "Select workspace"} ▾
        </Text>
      </Pressable>
      {open ? (
        <View style={{ position: "absolute", top: 40, zIndex: 10, right: 0, backgroundColor: t.colors.card, borderWidth: 1, borderColor: t.colors.border, borderRadius: 10, padding: 8, minWidth: 220 }}>
          {items.map((w) => (
            <Pressable key={w.id} onPress={() => { setWorkspaceId(w.id); setOpen(false); }}>
              <Text style={{ color: t.colors.text, padding: 8 }}>{w.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
