import * as React from "react";
import { View, TextInput, Text, Pressable, ScrollView, ActivityIndicator, Keyboard } from "react-native";
import { useColors } from "./useColors";
import { searchObjects } from "../../api/client";
import { findParties } from "../parties/api";

type ResultItem = { id: string; label: string; type?: string };

function mapToResultItems(type: string, rows: any[]): ResultItem[] {
  return rows
    .map((r) => {
      const id = String(r?.id ?? r?.itemId ?? r?.productId ?? r?.sku ?? r?.code ?? "");
      const label = String(r?.name ?? r?.label ?? r?.sku ?? r?.code ?? r?.id ?? "");
      return id ? { id, label, type } : null;
    })
    .filter(Boolean) as ResultItem[];
}
async function searchPerType(type: string, q: string, limit: number) {
  // Special-case role-aware party searches encoded as strings
  if (type === "party:vendor" || type === "party:customer") {
    try {
      const role = type.split(":")[1];
      const items = await findParties({ q, role });
      return mapToResultItems("party", items).slice(0, limit);
    } catch (err) {
      console.warn?.("AutoCompleteField: party search failed", { type, q }, err);
      return [];
    }
  }

  const attempts: Array<Record<string, any>> = [{ q }, { query: q }];
  for (const body of attempts) {
    try {
      const page = await searchObjects<any>(type, body, { limit });
      if (Array.isArray(page?.items) && page.items.length) return mapToResultItems(type, page.items);
    } catch (err) {
      console.warn?.("AutoCompleteField: search failed", { type, body }, err);
    }
  }
  return [];
}
async function searchAcrossTypes(q: string, searchTypes: string[], limit: number) {
  const perTypeLimit = Math.max(3, Math.floor(limit / Math.max(1, searchTypes.length)));
  const results = await Promise.all(searchTypes.map((ty) => searchPerType(ty, q, perTypeLimit)));
  const merged: ResultItem[] = [];
  const seen = new Set<string>();
  for (const arr of results) {
    for (const it of arr) {
      const key = `${it.type ?? ""}:${it.id}`;
      if (!seen.has(key)) { seen.add(key); merged.push(it); }
    }
  }
  merged.sort((a, b) => a.label.localeCompare(b.label));
  return merged.slice(0, limit);
}

export function AutoCompleteField({
  placeholder,
  initialText = "",
  searchTypes = ["product", "inventory"],
  debounceMs = 220,
  minChars = 1,
  onSelect,
  inputRef,
  lockAfterPick = true,
}: {
  placeholder?: string;
  initialText?: string;
  searchTypes?: string[];
  debounceMs?: number;
  minChars?: number;
  onSelect: (item: ResultItem) => void;
  inputRef?: React.RefObject<TextInput>;
  lockAfterPick?: boolean;
}) {
  const t = useColors();

  const tiRef = React.useRef<TextInput>(null);
  const mergedRef = (inputRef as any) ?? tiRef;

  const [q, setQ] = React.useState(initialText);
  const [loading, setLoading] = React.useState(false);
  const [results, setResults] = React.useState<ResultItem[]>([]);
  const [open, setOpen] = React.useState(false);

  const locked = React.useRef(false);
  const internalSet = React.useRef(false);
  const lastPickedLabel = React.useRef<string | null>(null);
  const justPickedAt = React.useRef<number>(0);
  const ignoreNextInitialHydrate = React.useRef(false);
  const PICK_COOLDOWN_MS = 250;

  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Sync to external initialText (e.g., when opening an edit modal)
  React.useEffect(() => {
    if (ignoreNextInitialHydrate.current) { ignoreNextInitialHydrate.current = false; return; }
    internalSet.current = true;
    setQ(initialText ?? "");
    setOpen(false);
    setResults([]);
    if (lockAfterPick) {
      lastPickedLabel.current = initialText ?? "";
      locked.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText]);

  // Debounced search (skip when locked / programmatic / right after a pick)
  React.useEffect(() => {
    const query = q.trim();

    if (internalSet.current) { internalSet.current = false; return; }

    const now = Date.now();
    if (now - justPickedAt.current < PICK_COOLDOWN_MS) { setOpen(false); setResults([]); return; }

    if (lockAfterPick && locked.current) {
      if (lastPickedLabel.current !== null && query !== lastPickedLabel.current) {
        locked.current = false;
      } else {
        setOpen(false); setResults([]); return;
      }
    }

    if (query.length < minChars) { setResults([]); setOpen(false); return; }

    const h = setTimeout(async () => {
      if (!mounted.current) return;
      setLoading(true);
      try {
        const mapped = await searchAcrossTypes(query, searchTypes, 12);
        if (!mounted.current) return;
        setResults(mapped);
        setOpen(mapped.length > 0);
      } finally {
        if (mounted.current) setLoading(false);
      }
    }, debounceMs);

    return () => clearTimeout(h);
  }, [q, searchTypes, minChars, debounceMs, lockAfterPick]);

  function pick(it: ResultItem) {
    lastPickedLabel.current = it.label;
    if (lockAfterPick) locked.current = true;
    internalSet.current = true;

    try { (mergedRef?.current as TextInput | null)?.setNativeProps?.({ text: it.label }); } catch {}
    setQ(it.label);
    setOpen(false);
    setResults([]);
    justPickedAt.current = Date.now();
    ignoreNextInitialHydrate.current = true;
    Keyboard.dismiss();
    try { (mergedRef?.current as TextInput | null)?.blur?.(); } catch {}

    onSelect(it);
  }

  function commitFirst() {
    if (!open || !results.length) return;
    pick(results[0]);
  }

  return (
    <View style={{ position: "relative" }}>
      <TextInput
        ref={mergedRef as any}
        value={q}
        onChangeText={(text) => {
          setQ(text);
          if (lockAfterPick && locked.current && lastPickedLabel.current !== null && text.trim() !== lastPickedLabel.current) {
            locked.current = false;
          }
        }}
        placeholder={placeholder ?? "Search…"}
        autoCorrect={false}
        autoCapitalize="none"
        onSubmitEditing={commitFirst}
        style={{
          height: 44,
          borderWidth: 1, borderColor: t.colors.border, borderRadius: 8,
          paddingHorizontal: 10, paddingVertical: 10,
          backgroundColor: (t.colors as any).inputBg ?? t.colors.card,
          color: t.colors.text,
        }}
      />

      {open ? (
        <View
          style={{
            position: "absolute", left: 0, right: 0, top: 44,
            backgroundColor: t.colors.card,
            borderWidth: 1, borderColor: t.colors.border, borderTopWidth: 0,
            borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
            maxHeight: 220, zIndex: 30,
            elevation: 10,
          }}
        >
          {loading ? (
            <View style={{ padding: 10 }}><ActivityIndicator /></View>
          ) : results.length === 0 ? (
            <View style={{ padding: 10 }}><Text style={{ color: t.colors.textMuted }}>No results</Text></View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled">
              {results.map((it) => (
                <Pressable
                  key={`${it.type ?? "x"}:${it.id}`}
                  onPress={() => pick(it)}
                  style={{ paddingHorizontal: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: t.colors.border }}
                >
                  <Text style={{ color: t.colors.text, fontWeight: "600" }}>{it.label}</Text>
                  <Text style={{ color: t.colors.textMuted, fontSize: 12 }}>{it.id}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
  );
}
