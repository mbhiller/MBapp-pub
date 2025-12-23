import React, { useEffect, useMemo, useState } from "react";
import { View, TextInput, Text, Pressable, ScrollView, ActivityIndicator, Keyboard } from "react-native";
import { useColors } from "../_shared/useColors";
import { findParties, Party, partyLabel } from "./api";
import { copyText } from "../_shared/copy";
import { useToast } from "../_shared/Toast";

type Props = {
  role?: string;                    // filter by role (customer/vendor/employee/...)
  onSelect: (p: Party) => void;
  autoFocus?: boolean;
  placeholder?: string;
};

export default function PartyPicker({ role, onSelect, autoFocus, placeholder }: Props) {
  const t = useColors();
  const toast = (useToast?.() as any) ?? ((msg: string) => console.log("TOAST:", msg));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Party[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let keep = true;
    if (!open && q.length === 0) { setRows([]); return; }
    setBusy(true);
    findParties({ role, q }).then(r => { if (keep) setRows(r); }).finally(()=> setBusy(false));
    return () => { keep = false; };
  }, [q, role, open]);

  return (
    <View style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: 8 }}>
      <TextInput
        autoFocus={autoFocus}
        value={q}
        onChangeText={(v) => { setQ(v); setOpen(true); }}
        placeholder={placeholder ?? "Search parties..."}
        placeholderTextColor={t.colors.textMuted}
        style={{ padding: 10, color: t.colors.text }}
      />
      {busy && <ActivityIndicator style={{ padding: 8 }} />}
      {open && rows.length > 0 && (
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 220, borderTopWidth: 1, borderColor: t.colors.border }}>
          {rows.map(p => (
            <Pressable
              key={p.id}
              onPress={() => {
                onSelect(p);
                // Close the list and freeze input until user types again
                setOpen(false);
                Keyboard.dismiss();
              }}
              style={{ padding: 10 }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.colors.text, fontWeight: "600" }}>{partyLabel(p)}</Text>
                  <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>{p.id}</Text>
                </View>
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation?.();
                    void copyText(String(p.id));
                    toast("Copied", "success");
                  }}
                  style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: t.colors.border }}
                >
                  <Text style={{ color: t.colors.text, fontSize: 12, fontWeight: "600" }}>Copy</Text>
                </Pressable>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
