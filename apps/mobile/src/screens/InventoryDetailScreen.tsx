import React from "react";
import { View, Alert } from "react-native";
import { TextInput, Button, Text } from "react-native-paper";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";

import { getInventory, createInventory, updateInventory } from "../features/inventory/api";
import type { InventoryItem } from "../features/inventory/types";
import { useTheme } from "../providers/ThemeProvider";

type Params = { id?: string; mode?: "new" | "edit" };

export default function InventoryDetailScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<RouteProp<Record<string, Params>, string>>();
  const t = useTheme();
  const qc = useQueryClient();

  const id = route.params?.id;
  const mode: "new" | "edit" = route.params?.mode ?? (id ? "edit" : "new");

  const q = useQuery({
    queryKey: ["inventory", id],
    queryFn: () => getInventory(id!),
    enabled: Boolean(id),
  });

  const [sku, setSku] = React.useState("");
  const [name, setName] = React.useState("");
  const [qtyOnHand, setQty] = React.useState<string>("0");
  const [uom, setUom] = React.useState("each");
  const [location, setLocation] = React.useState("");
  const [cost, setCost] = React.useState<string>("");

  React.useEffect(() => {
    if (q.data) {
      const it = q.data;
      setSku(it.sku ?? "");
      setName(it.name ?? "");
      setQty(String(it.qtyOnHand ?? 0));
      setUom(it.uom ?? "each");
      setLocation(it.location ?? "");
      setCost(it.cost != null ? String(it.cost) : "");
    }
  }, [q.data]);

  const mCreate = useMutation({
    mutationFn: (input: Partial<InventoryItem>) => createInventory(input),
    onSuccess: (item) => {
      // Invalidate all inventory list keys (with or without filters)
      qc.invalidateQueries({ queryKey: ["inventory"] });
      Alert.alert("Created", `Inventory ${item.id}`);
      nav.goBack();
    },
  });

  const mUpdate = useMutation({
    mutationFn: (patch: Partial<InventoryItem>) => updateInventory(id!, patch),
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      Alert.alert("Saved", `Inventory ${item.id}`);
      nav.goBack();
    },
  });

  const save = () => {
    const qty = Number(qtyOnHand);
    if (Number.isNaN(qty)) {
      Alert.alert("Invalid quantity", "Qty must be a number");
      return;
    }
    const costNum = cost === "" ? undefined : Number(cost);
    if (costNum != null && Number.isNaN(costNum)) {
      Alert.alert("Invalid cost", "Cost must be a number");
      return;
    }

    const payload: Partial<InventoryItem> = {
      sku: sku || undefined,
      name: name || undefined,
      qtyOnHand: qty,
      uom: uom || undefined,
      location: location || undefined,
      cost: costNum,
      type: "inventory",
    };

    if (mode === "new") mCreate.mutate(payload);
    else mUpdate.mutate(payload);
  };

  const busy = mCreate.isPending || mUpdate.isPending;

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: t.colors.bg, gap: 12 }}>
      <Text variant="titleLarge">
        {mode === "new" ? "New Inventory Item" : (q.data?.name ?? q.data?.sku ?? "Inventory")}
      </Text>

      <TextInput label="SKU" value={sku} onChangeText={setSku} mode="outlined" />
      <TextInput label="Name" value={name} onChangeText={setName} mode="outlined" />
      <TextInput
        label="Quantity on hand"
        value={qtyOnHand}
        onChangeText={setQty}
        keyboardType="numeric"
        mode="outlined"
      />
      <TextInput label="UOM" value={uom} onChangeText={setUom} mode="outlined" />
      <TextInput label="Location" value={location} onChangeText={setLocation} mode="outlined" />
      <TextInput
        label="Unit cost"
        value={cost}
        onChangeText={setCost}
        keyboardType="decimal-pad"
        mode="outlined"
      />

      <Button mode="contained" onPress={save} loading={busy} disabled={busy} style={{ marginTop: 8 }}>
        {mode === "new" ? "Create" : "Save"}
      </Button>

      {mode === "edit" && q.isFetching ? <Text>Loading…</Text> : null}
    </View>
  );
}
